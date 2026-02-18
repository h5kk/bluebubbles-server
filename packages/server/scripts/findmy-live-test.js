#!/usr/bin/env node
/**
 * Live Integration Test for BlueBubbles Find My Private API
 *
 * Acts as a lightweight TCP server mimicking the BlueBubbles server.
 * The helper dylib injected into Messages.app connects here, and we
 * send "refresh-findmy-friends" to test the Find My implementation.
 *
 * Usage:
 *   1. Start this script:       node packages/server/scripts/findmy-live-test.js
 *   2. Launch Messages.app with the dylib injected (see instructions printed at startup)
 *   3. Watch the results
 */

const net = require("net");
const os = require("os");
const { execSync } = require("child_process");

// Port calculation matches both server (PrivateApiService.ts) and helper (NetworkController.m)
const MIN_PORT = 45670;
const MAX_PORT = 65535;
const uid = os.userInfo().uid;
const PORT = Math.min(Math.max(MIN_PORT + uid - 501, MIN_PORT), MAX_PORT);

const CONNECTION_TIMEOUT_MS = 60000; // 60s to wait for helper connection
const RESPONSE_WAIT_MS = 25000; // 25s for FindMy response (helper has 15s internal timeout)

let server = null;
let socket = null;
let testsPassed = 0;
let testsFailed = 0;

function log(msg) {
    const ts = new Date().toISOString().substring(11, 23);
    console.log(`[${ts}] ${msg}`);
}

function test(name, passed, detail) {
    if (passed) {
        console.log(`  PASS: ${name}`);
        testsPassed++;
    } else {
        console.log(`  FAIL: ${name}`);
        testsFailed++;
    }
    if (detail) console.log(`    ${detail}`);
}

function cleanup() {
    if (socket) { try { socket.destroy(); } catch (e) {} }
    if (server) { try { server.close(); } catch (e) {} }
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });

// ─── System Info ────────────────────────────────────────────────
const productVersion = execSync("sw_vers -productVersion", { encoding: "utf-8" }).trim();
const macMajor = parseInt(productVersion.split(".")[0], 10);

console.log("=== BlueBubbles Find My Live Integration Test ===");
console.log("");
log(`macOS ${productVersion} (major: ${macMajor})`);
log(`UID: ${uid}, TCP Port: ${PORT}`);
log(`Code path: ${macMajor >= 14 ? "FindMyLocateSession (macOS 14+)" : "FMFSession (macOS <=13)"}`);
console.log("");

const dylib = "/Users/hannynoueilaty/Library/Developer/Xcode/DerivedData/BlueBubblesHelper-gstpfzxdgoegsacfhtibugphnzdc/Build/Products/Debug/BlueBubblesHelper.dylib";

// Check if Messages is running
let messagesRunning = false;
try {
    execSync("pgrep -x Messages", { encoding: "utf-8" });
    messagesRunning = true;
    log("Messages.app is already running.");
} catch (e) {
    log("Messages.app is not running.");
}

console.log("");
console.log("─── Instructions ───────────────────────────────────");
console.log("To inject the dylib into Messages.app (SIP must be disabled):");
console.log("");
console.log(`  DYLD_INSERT_LIBRARIES="${dylib}" /System/Applications/Messages.app/Contents/MacOS/Messages &`);
console.log("");
console.log("If Messages is already running without injection, quit it first.");
console.log("─────────────────────────────────────────────────────");
console.log("");

// ─── TCP Server ─────────────────────────────────────────────────

let dataBuffer = "";
let responseResolve = null;
let receivedMessages = [];

function parseMessages(chunk) {
    dataBuffer += chunk;
    // Helper sends JSON objects separated by \r\n
    const parts = dataBuffer.split(/\r?\n/);
    dataBuffer = parts.pop(); // keep incomplete last part in buffer

    for (const part of parts) {
        if (!part.trim()) continue;
        try {
            const msg = JSON.parse(part);
            handleMessage(msg);
        } catch (e) {
            log(`JSON parse error: ${e.message}`);
            log(`  Raw: ${part.substring(0, 200)}`);
        }
    }
}

function handleMessage(msg) {
    receivedMessages.push(msg);

    if (msg.event === "ping") {
        log(`Helper sent ping: "${msg.message}" (process: ${msg.process})`);
        test("Helper identified itself", true, `process: ${msg.process}`);
        return;
    }

    if (msg.transactionId) {
        log(`Received transaction response: ${msg.transactionId}`);

        if (msg.error) {
            log(`  ERROR: ${msg.error}`);
        }
        if (msg.locations !== undefined) {
            log(`  locations count: ${msg.locations.length}`);
        }

        if (responseResolve) {
            responseResolve(msg);
            responseResolve = null;
        }
    }

    if (msg.event === "new-findmy-location") {
        log(`Received real-time location event!`);
        if (Array.isArray(msg.data)) {
            for (const loc of msg.data) {
                log(`  handle: ${loc.handle}, coords: [${loc.coordinates}], status: ${loc.status}`);
            }
        }
    }
}

server = net.createServer((conn) => {
    socket = conn;
    log("=== BlueBubblesHelper CONNECTED ===");

    conn.setEncoding("utf-8");
    conn.on("data", parseMessages);
    conn.on("close", () => log("Helper disconnected"));
    conn.on("error", (err) => log(`Socket error: ${err.message}`));

    // Wait for ping, then run the test
    setTimeout(() => runFindMyTest(conn), 3000);
});

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        log(`ERROR: Port ${PORT} already in use. Is BlueBubbles server running? Stop it first.`);
        process.exit(1);
    }
    log(`Server error: ${err.message}`);
});

server.listen(PORT, "localhost", () => {
    log(`TCP server listening on localhost:${PORT}`);
    log(`Waiting for BlueBubblesHelper to connect (${CONNECTION_TIMEOUT_MS / 1000}s timeout)...`);
});

// ─── Test Runner ────────────────────────────────────────────────

async function runFindMyTest(conn) {
    console.log("\n=== Sending refresh-findmy-friends ===");

    // Command format matches PrivateApiService.writeData()
    const transactionId = `findmy-test-${Date.now()}`;
    const command = JSON.stringify({
        action: "refresh-findmy-friends",
        data: null,
        transactionId: transactionId
    });

    // Server sends JSON + newline delimiter
    conn.write(command + "\n");
    log(`Sent command (transactionId: ${transactionId})`);
    test("Command sent", true);

    // Wait for response
    log(`Waiting up to ${RESPONSE_WAIT_MS / 1000}s for response...`);

    const response = await Promise.race([
        new Promise((resolve) => { responseResolve = resolve; }),
        new Promise((resolve) => setTimeout(() => resolve(null), RESPONSE_WAIT_MS))
    ]);

    if (!response) {
        test("Received response within timeout", false, "No response received");
        finish();
        return;
    }

    test("Received response within timeout", true);

    // ─── Validate Response ──────────────────────────────────────
    console.log("\n=== Validating Response ===");

    test("Response has transactionId", response.transactionId === transactionId,
        `expected: ${transactionId}, got: ${response.transactionId}`);

    if (response.error) {
        test("No error in response", false, `error: ${response.error}`);
        finish();
        return;
    }
    test("No error in response", true);

    test("Response has locations array", Array.isArray(response.locations),
        `type: ${typeof response.locations}`);

    if (!Array.isArray(response.locations)) {
        finish();
        return;
    }

    const locs = response.locations;
    log(`Received ${locs.length} friend location(s)`);

    if (locs.length === 0) {
        test("Empty array accepted (no friends sharing)", true,
            "No friends sharing locations with this account");
    }

    for (let i = 0; i < locs.length; i++) {
        const loc = locs[i];
        console.log(`\n  --- Friend ${i + 1}: ${loc.handle || "(unknown)"} ---`);

        test(`[${i}] has handle`, loc.handle != null, `handle: ${loc.handle}`);

        test(`[${i}] has coordinates [lat, lon]`,
            Array.isArray(loc.coordinates) && loc.coordinates.length === 2,
            `coordinates: ${JSON.stringify(loc.coordinates)}`);

        if (Array.isArray(loc.coordinates) && loc.coordinates.length === 2) {
            const [lat, lon] = loc.coordinates;
            test(`[${i}] coordinates are numbers`,
                typeof lat === "number" && typeof lon === "number",
                `lat: ${lat} (${typeof lat}), lon: ${lon} (${typeof lon})`);

            if (lat !== 0 || lon !== 0) {
                test(`[${i}] coordinates are non-zero`, true,
                    `lat: ${lat}, lon: ${lon}`);
            } else {
                log(`    WARNING: [0, 0] coordinates - may indicate geocoding pending`);
            }
        }

        test(`[${i}] has last_updated (ms timestamp)`, typeof loc.last_updated === "number",
            `last_updated: ${loc.last_updated}` +
            (typeof loc.last_updated === "number" ? ` (${new Date(loc.last_updated).toISOString()})` : ""));

        test(`[${i}] has valid status`, ["legacy", "live", "shallow"].includes(loc.status),
            `status: ${loc.status}`);

        test(`[${i}] has is_locating_in_progress`,
            loc.is_locating_in_progress === 0 || loc.is_locating_in_progress === 1,
            `is_locating_in_progress: ${loc.is_locating_in_progress}`);

        // Log address fields (informational)
        if (loc.long_address) log(`    long_address: ${loc.long_address}`);
        if (loc.short_address) log(`    short_address: ${loc.short_address}`);
        if (loc.title) log(`    title: ${loc.title}`);
        if (loc.subtitle) log(`    subtitle: ${loc.subtitle}`);
    }

    // Wait for real-time swizzle events
    console.log("\n=== Checking for Real-Time Swizzle Events ===");
    log("Waiting 8s for new-findmy-location events...");
    await new Promise(r => setTimeout(r, 8000));

    const rtEvents = receivedMessages.filter(m => m.event === "new-findmy-location");
    if (rtEvents.length > 0) {
        test("Received real-time events via IMFMFSession swizzle", true,
            `${rtEvents.length} event(s)`);
        for (const evt of rtEvents) {
            if (Array.isArray(evt.data)) {
                for (const loc of evt.data) {
                    test("RT event has valid structure",
                        loc.handle != null && Array.isArray(loc.coordinates) &&
                        ["legacy", "live", "shallow"].includes(loc.status),
                        `handle: ${loc.handle}, coords: [${loc.coordinates}], status: ${loc.status}`);
                }
            }
        }
    } else {
        log("  No real-time events (normal if Find My app not actively refreshing)");
    }

    finish();
}

function finish() {
    console.log(`\n${"=".repeat(55)}`);
    console.log(`  LIVE INTEGRATION TEST: ${testsPassed} passed, ${testsFailed} failed`);
    console.log(`${"=".repeat(55)}`);

    if (testsFailed === 0) {
        console.log("\n  All tests passed!");
    } else {
        console.log("\n  Some tests failed. See output above.");
    }
    console.log("");

    cleanup();
    process.exit(testsFailed > 0 ? 1 : 0);
}

// Connection timeout
setTimeout(() => {
    if (!socket) {
        console.log("");
        log("TIMEOUT: No connection from helper.");
        log("Make sure Messages.app is running with DYLD_INSERT_LIBRARIES set.");
        console.log(`\n  RESULT: 0 passed, 1 failed (no connection)\n`);
        cleanup();
        process.exit(1);
    }
}, CONNECTION_TIMEOUT_MS);
