#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL: ${name}`);
        console.log(`    Error: ${e.message}`);
        failed++;
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(actual, expected, msg) {
    if (actual !== expected) throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertDeepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
}

// ============================================================
// Section 1: System Info
// ============================================================
console.log("=== System Info ===");
try {
    const swVers = execSync("sw_vers", { encoding: "utf-8" }).trim();
    console.log(swVers);
} catch (e) {
    console.log("  Could not run sw_vers: " + e.message);
}
console.log(`Node version: ${process.version}`);

let macMajor = 0;
try {
    const productVersion = execSync("sw_vers -productVersion", { encoding: "utf-8" }).trim();
    macMajor = parseInt(productVersion.split(".")[0], 10);
    console.log(`macOS major version: ${macMajor}`);
    if (macMajor >= 15) {
        console.log("Code path: macOS Sequoia+ (isMinSequoia=true, getDevices returns null)");
    } else if (macMajor >= 14) {
        console.log("Code path: macOS Sonoma+ (isMinSonoma=true)");
    } else if (macMajor >= 11) {
        console.log("Code path: macOS Big Sur+ (isMinBigSur=true)");
    } else {
        console.log("Code path: Pre-Big Sur");
    }
} catch (e) {
    console.log("  Could not determine macOS version: " + e.message);
}

// ============================================================
// Section 2: Find My Directory Survey
// ============================================================
console.log("\n=== Find My Directories ===");

const homeDir = os.homedir();
const findMyDir = path.join(homeDir, "Library", "Caches", "com.apple.findmy.fmipcore");
const findMyFriendsDir = path.join(homeDir, "Library", "Caches", "com.apple.icloud.fmfd");
const findMyContainer = path.join(homeDir, "Library", "Containers", "com.apple.findmy");

function listDirSafe(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) {
            console.log(`  ${dirPath}: DOES NOT EXIST`);
            return [];
        }
        const files = fs.readdirSync(dirPath);
        console.log(`  ${dirPath}: ${files.length} file(s)`);
        for (const f of files) {
            const stat = fs.statSync(path.join(dirPath, f));
            console.log(`    - ${f} (${stat.isDirectory() ? "dir" : stat.size + " bytes"})`);
        }
        return files;
    } catch (e) {
        console.log(`  ${dirPath}: ERROR - ${e.message}`);
        return [];
    }
}

console.log("\nFind My fmipcore cache:");
listDirSafe(findMyDir);

console.log("\nFind My fmfd cache (friends):");
listDirSafe(findMyFriendsDir);

console.log("\nFind My container:");
if (fs.existsSync(findMyContainer)) {
    console.log(`  ${findMyContainer}: EXISTS`);
} else {
    console.log(`  ${findMyContainer}: DOES NOT EXIST`);
}

// ============================================================
// Section 3: Cache File Format Detection
// ============================================================
console.log("\n=== Cache File Format Detection ===");

const dataFiles = ["Devices.data", "Items.data", "ItemGroups.data"];
for (const fileName of dataFiles) {
    const filePath = path.join(findMyDir, fileName);

    test(`${fileName} - existence check`, () => {
        if (fs.existsSync(filePath)) {
            console.log(`    File exists: ${filePath}`);
        } else {
            console.log(`    File NOT found: ${filePath} (this may be expected)`);
        }
        // This test always passes - it's informational
        assert(true);
    });

    if (fs.existsSync(filePath)) {
        test(`${fileName} - format detection`, () => {
            const buf = fs.readFileSync(filePath);
            const first20 = buf.slice(0, 20);
            const hexDump = first20.toString("hex");
            const headerStr = buf.slice(0, 8).toString("ascii");

            if (headerStr === "bplist00") {
                console.log(`    Format: Binary Plist`);
                console.log(`    First 20 bytes (hex): ${hexDump}`);
                assert(true, "Binary plist detected");
            } else {
                // Try JSON
                try {
                    const text = fs.readFileSync(filePath, { encoding: "utf-8" });
                    const parsed = JSON.parse(text);
                    assert(Array.isArray(parsed), `${fileName} parsed as JSON but is not an array`);
                    console.log(`    Format: JSON array with ${parsed.length} entries`);
                } catch (jsonErr) {
                    console.log(`    Format: UNKNOWN (not bplist, not valid JSON)`);
                    console.log(`    First 20 bytes (hex): ${hexDump}`);
                    throw new Error(`Unknown format for ${fileName}: ${jsonErr.message}`);
                }
            }
        });

        test(`${fileName} - JSON parse succeeds and is array`, () => {
            const headerStr = fs.readFileSync(filePath).slice(0, 8).toString("ascii");
            if (headerStr === "bplist00") {
                console.log(`    SKIPPED (binary plist, not JSON)`);
                return;
            }
            const text = fs.readFileSync(filePath, { encoding: "utf-8" });
            const parsed = JSON.parse(text);
            assert(Array.isArray(parsed), `Expected array, got ${typeof parsed}`);
            console.log(`    Valid JSON array with ${parsed.length} item(s)`);
        });
    }
}

// ============================================================
// Section 4: Binary Plist Detection Logic
// ============================================================
console.log("\n=== Binary Plist Detection Logic ===");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "findmy-test-"));

function detectFormat(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        if (buf.length >= 8 && buf.slice(0, 8).toString("ascii") === "bplist00") {
            return "bplist";
        }
        // Try JSON
        try {
            const text = buf.toString("utf-8");
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                return "json-array";
            }
            return "json-other";
        } catch {
            return "unknown";
        }
    } catch (e) {
        return null; // file doesn't exist or can't be read
    }
}

test("bplist00 header detected as binary plist", () => {
    const tmpFile = path.join(tmpDir, "test-bplist.data");
    const buf = Buffer.alloc(64);
    buf.write("bplist00", 0, "ascii");
    // Fill rest with some binary data
    for (let i = 8; i < 64; i++) buf[i] = i;
    fs.writeFileSync(tmpFile, buf);
    assertEqual(detectFormat(tmpFile), "bplist", "Should detect bplist format");
});

test("valid JSON array detected correctly", () => {
    const tmpFile = path.join(tmpDir, "test-json.data");
    fs.writeFileSync(tmpFile, JSON.stringify([{ id: 1 }, { id: 2 }]));
    assertEqual(detectFormat(tmpFile), "json-array", "Should detect JSON array format");
});

test("missing file returns null", () => {
    const tmpFile = path.join(tmpDir, "nonexistent.data");
    assertEqual(detectFormat(tmpFile), null, "Should return null for missing file");
});

test("empty file is not detected as bplist", () => {
    const tmpFile = path.join(tmpDir, "test-empty.data");
    fs.writeFileSync(tmpFile, "");
    const result = detectFormat(tmpFile);
    assert(result !== "bplist", `Empty file should not be bplist, got: ${result}`);
});

test("random binary data without bplist header is not detected as bplist", () => {
    const tmpFile = path.join(tmpDir, "test-random.data");
    const buf = Buffer.alloc(64);
    for (let i = 0; i < 64; i++) buf[i] = Math.floor(Math.random() * 256);
    // Make sure it doesn't accidentally start with bplist00
    buf.write("NOTBPLS", 0, "ascii");
    fs.writeFileSync(tmpFile, buf);
    const result = detectFormat(tmpFile);
    assert(result !== "bplist", `Random binary should not be bplist, got: ${result}`);
});

// Cleanup temp files
try {
    fs.rmSync(tmpDir, { recursive: true });
} catch (e) {
    // ignore cleanup errors
}

// ============================================================
// Section 5: FindMyFriendsCache Logic
// ============================================================
console.log("\n=== FindMyFriendsCache Logic ===");

// Reimplement isEmpty from the server code
function isEmpty(value, trim = true) {
    return !isNotEmpty(value, trim);
}

function isNotEmpty(value, trimEmpty = true) {
    if (!value) return false;
    if (typeof value === "string" && (trimEmpty ? value.trim() : value).length > 0) return true;
    if (typeof value === "object" && Array.isArray(value)) {
        if (trimEmpty) return value.filter(i => isNotEmpty(i)).length > 0;
        return value.length > 0;
    }
    if (typeof value === "object" && !Array.isArray(value)) return Object.keys(value).length > 0;
    return true;
}

// Reimplement FindMyFriendsCache
class FindMyFriendsCache {
    constructor() {
        this.cache = {};
    }

    addAll(locationData) {
        const output = [];
        for (const i of locationData) {
            const success = this.add(i);
            if (success) {
                output.push(i);
            }
        }
        return output;
    }

    add(locationData) {
        const handle = locationData?.handle;
        if (isEmpty(handle)) return false;

        const updateCache = () => {
            this.cache[handle] = locationData;
            return true;
        };

        const currentData = this.cache[handle];
        if (!currentData) {
            return updateCache();
        }

        // If the update is a "legacy" update, and the current location isn't, ignore it
        if (locationData?.status === "legacy" && currentData?.status !== "legacy") return false;

        const currentCoords = currentData?.coordinates ?? [0, 0];
        const updatedCoords = locationData?.coordinates ?? [0, 0];
        const noLocationType = currentData?.status === "legacy" && locationData?.status === "legacy";
        const updateTimestamp = locationData?.last_updated ?? 0;
        const currentTimestamp = currentData?.last_updated ?? 0;

        if (
            (
                noLocationType &&
                currentCoords[0] !== 0 &&
                currentCoords[1] !== 0 &&
                updatedCoords[0] === 0 &&
                updatedCoords[1] === 0
            ) ||
            (
                currentData?.status === locationData?.status &&
                currentCoords[0] === updatedCoords[0] &&
                currentCoords[1] === updatedCoords[1] &&
                updateTimestamp === currentTimestamp
            ) || (
                updateTimestamp < currentTimestamp
            )
        ) {
            return false;
        }

        return updateCache();
    }

    get(handle) {
        return this.cache[handle] ?? null;
    }

    getAll() {
        return Object.values(this.cache);
    }
}

function makeLocation(handle, coords, status, timestamp) {
    return {
        handle,
        coordinates: coords,
        long_address: null,
        short_address: null,
        subtitle: null,
        title: null,
        last_updated: timestamp,
        is_locating_in_progress: 0,
        status
    };
}

test("add new location - stored correctly", () => {
    const cache = new FindMyFriendsCache();
    const loc = makeLocation("test@example.com", [40.7128, -74.006], "live", 1000);
    const result = cache.add(loc);
    assert(result === true, "add() should return true for new entry");
    const stored = cache.get("test@example.com");
    assert(stored !== null, "Should be able to retrieve stored location");
    assertEqual(stored.handle, "test@example.com");
    assertDeepEqual(stored.coordinates, [40.7128, -74.006]);
});

test("add with null handle - rejected", () => {
    const cache = new FindMyFriendsCache();
    const loc = makeLocation(null, [40.7128, -74.006], "live", 1000);
    const result = cache.add(loc);
    assert(result === false, "add() should return false for null handle");
    assertEqual(cache.getAll().length, 0, "Cache should be empty");
});

test("legacy doesn't overwrite live", () => {
    const cache = new FindMyFriendsCache();
    const live = makeLocation("user@test.com", [40.7128, -74.006], "live", 1000);
    const legacy = makeLocation("user@test.com", [41.0, -75.0], "legacy", 2000);
    cache.add(live);
    const result = cache.add(legacy);
    assert(result === false, "Legacy should not overwrite live");
    const stored = cache.get("user@test.com");
    assertEqual(stored.status, "live", "Status should remain live");
    assertDeepEqual(stored.coordinates, [40.7128, -74.006], "Coordinates should not change");
});

test("[0,0] doesn't overwrite real coords when both legacy", () => {
    const cache = new FindMyFriendsCache();
    const real = makeLocation("user@test.com", [40.7128, -74.006], "legacy", 1000);
    const zero = makeLocation("user@test.com", [0, 0], "legacy", 2000);
    cache.add(real);
    const result = cache.add(zero);
    assert(result === false, "[0,0] should not overwrite real coordinates when both legacy");
    const stored = cache.get("user@test.com");
    assertDeepEqual(stored.coordinates, [40.7128, -74.006], "Coordinates should remain real");
});

test("older timestamp ignored", () => {
    const cache = new FindMyFriendsCache();
    const newer = makeLocation("user@test.com", [40.7128, -74.006], "live", 2000);
    const older = makeLocation("user@test.com", [41.0, -75.0], "live", 1000);
    cache.add(newer);
    const result = cache.add(older);
    assert(result === false, "Older timestamp should be ignored");
    const stored = cache.get("user@test.com");
    assertEqual(stored.last_updated, 2000, "Timestamp should remain newer");
});

test("newer timestamp accepted", () => {
    const cache = new FindMyFriendsCache();
    const older = makeLocation("user@test.com", [40.7128, -74.006], "live", 1000);
    const newer = makeLocation("user@test.com", [41.0, -75.0], "live", 2000);
    cache.add(older);
    const result = cache.add(newer);
    assert(result === true, "Newer timestamp should be accepted");
    const stored = cache.get("user@test.com");
    assertEqual(stored.last_updated, 2000, "Timestamp should be updated");
    assertDeepEqual(stored.coordinates, [41.0, -75.0], "Coordinates should be updated");
});

test("exact duplicate ignored", () => {
    const cache = new FindMyFriendsCache();
    const loc = makeLocation("user@test.com", [40.7128, -74.006], "live", 1000);
    cache.add(loc);
    const loc2 = makeLocation("user@test.com", [40.7128, -74.006], "live", 1000);
    const result = cache.add(loc2);
    assert(result === false, "Exact duplicate should be ignored");
});

test("addAll returns only changed items", () => {
    const cache = new FindMyFriendsCache();
    const loc1 = makeLocation("user1@test.com", [40.7128, -74.006], "live", 1000);
    const loc2 = makeLocation("user2@test.com", [34.0522, -118.2437], "live", 1000);
    cache.add(loc1);

    // Now addAll with loc1 (dup) and loc2 (new)
    const result = cache.addAll([loc1, loc2]);
    assertEqual(result.length, 1, "addAll should return only new/changed items");
    assertEqual(result[0].handle, "user2@test.com", "Changed item should be user2");
});

test("get unknown handle - null", () => {
    const cache = new FindMyFriendsCache();
    const result = cache.get("nonexistent@test.com");
    assertEqual(result, null, "get() should return null for unknown handle");
});

test("getAll returns all", () => {
    const cache = new FindMyFriendsCache();
    cache.add(makeLocation("a@test.com", [1, 2], "live", 100));
    cache.add(makeLocation("b@test.com", [3, 4], "live", 200));
    cache.add(makeLocation("c@test.com", [5, 6], "live", 300));
    const all = cache.getAll();
    assertEqual(all.length, 3, "getAll should return all 3 items");
    const handles = all.map(i => i.handle).sort();
    assertDeepEqual(handles, ["a@test.com", "b@test.com", "c@test.com"]);
});

// ============================================================
// Section 6: Item-to-Device Transform
// ============================================================
console.log("\n=== Item-to-Device Transform ===");

// Reimplement transform functions from utils.ts
function getFindMyItemModelDisplayName(item) {
    if (item?.productType?.type === "b389") return "AirTag";
    return item?.productType?.productInformation?.modelName ?? item?.productType?.type ?? "Unknown";
}

function transformFindMyItemToDevice(item) {
    return {
        deviceModel: item?.productType?.type,
        id: item?.identifier,
        batteryStatus: "Unknown",
        audioChannels: [],
        lostModeCapable: true,
        batteryLevel: item?.batteryStatus,
        locationEnabled: true,
        isConsideredAccessory: true,
        address: item?.address,
        location: item?.location,
        modelDisplayName: getFindMyItemModelDisplayName(item),
        fmlyShare: false,
        thisDevice: false,
        lostModeEnabled: Boolean(item?.lostModeMetadata ?? false),
        deviceDisplayName: item?.role?.emoji,
        safeLocations: item?.safeLocations,
        name: item?.name,
        isMac: false,
        rawDeviceModel: item?.productType?.type,
        prsId: "owner",
        locationCapable: true,
        deviceClass: item?.productType?.type,
        crowdSourcedLocation: item?.crowdSourcedLocation,
        identifier: item?.identifier,
        productIdentifier: item?.productIdentifier,
        role: item?.role,
        serialNumber: item?.serialNumber,
        lostModeMetadata: item?.lostModeMetadata,
        groupIdentifier: item?.groupIdentifier,
        groupName: item?.groupName,
        isAppleAudioAccessory: item?.isAppleAudioAccessory,
        capabilities: item?.capabilities,
    };
}

function makeFindMyItem(overrides = {}) {
    return {
        isFirmwareUpdateMandatory: false,
        productType: {
            type: "b389",
            productInformation: null
        },
        safeLocations: [],
        owner: "owner",
        batteryStatus: 100,
        serialNumber: "ABC123",
        lostModeMetadata: null,
        capabilities: 0,
        identifier: "item-001",
        address: { formattedAddressLines: ["123 Main St"] },
        location: { latitude: 40.7128, longitude: -74.006 },
        productIdentifier: "prod-001",
        isAppleAudioAccessory: false,
        crowdSourcedLocation: { latitude: 40.71, longitude: -74.0 },
        groupIdentifier: null,
        groupName: null,
        role: { name: "Keys", emoji: "key-emoji", identifier: 1 },
        systemVersion: "1.0",
        name: "My AirTag",
        ...overrides
    };
}

test('AirTag type "b389" gets display name "AirTag"', () => {
    const item = makeFindMyItem({ productType: { type: "b389", productInformation: null } });
    const device = transformFindMyItemToDevice(item);
    assertEqual(device.modelDisplayName, "AirTag", 'modelDisplayName should be "AirTag"');
});

test("non-AirTag uses modelName from productInformation", () => {
    const item = makeFindMyItem({
        productType: {
            type: "other-type",
            productInformation: {
                manufacturerName: "Apple",
                modelName: "AirPods Pro",
                productIdentifier: 1,
                vendorIdentifier: 1,
                antennaPower: 1
            }
        }
    });
    const device = transformFindMyItemToDevice(item);
    assertEqual(device.modelDisplayName, "AirPods Pro", "Should use productInformation.modelName");
});

test("fallback to type when no productInformation", () => {
    const item = makeFindMyItem({
        productType: { type: "custom-tracker", productInformation: null }
    });
    const device = transformFindMyItemToDevice(item);
    assertEqual(device.modelDisplayName, "custom-tracker", "Should fall back to type");
});

test("identifier maps to id", () => {
    const item = makeFindMyItem({ identifier: "unique-id-999" });
    const device = transformFindMyItemToDevice(item);
    assertEqual(device.id, "unique-id-999", "id should map from identifier");
    assertEqual(device.identifier, "unique-id-999", "identifier should also be present");
});

test("isConsideredAccessory is true", () => {
    const item = makeFindMyItem();
    const device = transformFindMyItemToDevice(item);
    assertEqual(device.isConsideredAccessory, true, "isConsideredAccessory should be true");
});

test("missing fields don't throw", () => {
    // Test with minimal/empty item
    const item = {
        productType: undefined,
        identifier: undefined,
        batteryStatus: undefined,
        address: undefined,
        location: undefined,
        crowdSourcedLocation: undefined,
        role: undefined,
        name: undefined,
        serialNumber: undefined,
        lostModeMetadata: undefined,
        groupIdentifier: undefined,
        groupName: undefined,
        isAppleAudioAccessory: undefined,
        capabilities: undefined,
        productIdentifier: undefined,
        safeLocations: undefined
    };
    // This should not throw
    const device = transformFindMyItemToDevice(item);
    assert(device !== null && device !== undefined, "Transform should return an object");
    assertEqual(device.modelDisplayName, "Unknown", "Should fall back to Unknown");
    assertEqual(device.isConsideredAccessory, true, "isConsideredAccessory should still be true");
    assertEqual(device.lostModeEnabled, false, "lostModeEnabled should be false for null metadata");
});

test("lostModeEnabled is true when lostModeMetadata exists", () => {
    const item = makeFindMyItem({
        lostModeMetadata: {
            email: "test@test.com",
            message: "Lost!",
            ownerNumber: "555-1234",
            timestamp: 12345
        }
    });
    const device = transformFindMyItemToDevice(item);
    assertEqual(device.lostModeEnabled, true, "lostModeEnabled should be true when metadata exists");
});

// ============================================================
// Final Summary
// ============================================================
console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
