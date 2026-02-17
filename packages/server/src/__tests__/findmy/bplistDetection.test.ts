import fs from "fs";
import path from "path";
import os from "os";

/**
 * Tests the binary plist detection logic used in findMyInterface.ts.
 * The readDataFile method is private, so we replicate the detection
 * pattern here to test it in isolation.
 */
describe("Binary plist detection", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "findmy-test-"));
    });

    afterEach(() => {
        // Use rmdirSync for compatibility with older @types/node
        const files = fs.readdirSync(tmpDir);
        for (const file of files) {
            fs.unlinkSync(path.join(tmpDir, file));
        }
        fs.rmdirSync(tmpDir);
    });

    /**
     * Replicates the file format detection logic from findMyInterface.ts readDataFile.
     * - JSON array files are valid
     * - Files starting with "bplist" magic bytes are binary plists
     * - Everything else is an error
     */
    function detectFileFormat(filePath: string): "json" | "bplist" | "missing" | "error" {
        if (!fs.existsSync(filePath)) return "missing";
        const data = fs.readFileSync(filePath);
        if (data.length >= 6 && data.subarray(0, 6).toString("ascii") === "bplist") return "bplist";
        try {
            const parsed = JSON.parse(data.toString("utf-8"));
            if (Array.isArray(parsed)) return "json";
            return "error";
        } catch {
            return "error";
        }
    }

    test("detects missing file", () => {
        expect(detectFileFormat(path.join(tmpDir, "nonexistent.data"))).toBe("missing");
    });

    test("detects valid JSON array", () => {
        const filePath = path.join(tmpDir, "Devices.data");
        fs.writeFileSync(filePath, JSON.stringify([{ id: "device-1" }, { id: "device-2" }]));
        expect(detectFileFormat(filePath)).toBe("json");
    });

    test("detects bplist magic bytes", () => {
        const filePath = path.join(tmpDir, "Items.data");
        const header = Buffer.from("bplist00", "ascii");
        const fakeData = Buffer.alloc(50);
        header.copy(fakeData);
        fs.writeFileSync(filePath, fakeData);
        expect(detectFileFormat(filePath)).toBe("bplist");
    });

    test("detects invalid JSON", () => {
        const filePath = path.join(tmpDir, "Bad.data");
        fs.writeFileSync(filePath, "not json at all");
        expect(detectFileFormat(filePath)).toBe("error");
    });

    test("detects non-array JSON (object)", () => {
        const filePath = path.join(tmpDir, "Object.data");
        fs.writeFileSync(filePath, JSON.stringify({ a: 1, b: 2 }));
        expect(detectFileFormat(filePath)).toBe("error");
    });

    test("handles empty file", () => {
        const filePath = path.join(tmpDir, "Empty.data");
        fs.writeFileSync(filePath, "");
        expect(detectFileFormat(filePath)).toBe("error");
    });

    test("detects real bplist header from Apple cache (bplist00 v00)", () => {
        const filePath = path.join(tmpDir, "AppleCache.data");
        const header = Buffer.from("bplist00", "ascii");
        const fakeData = Buffer.alloc(100);
        header.copy(fakeData);
        fs.writeFileSync(filePath, fakeData);
        expect(detectFileFormat(filePath)).toBe("bplist");
    });

    test("detects empty JSON array as valid json", () => {
        const filePath = path.join(tmpDir, "EmptyArray.data");
        fs.writeFileSync(filePath, "[]");
        expect(detectFileFormat(filePath)).toBe("json");
    });

    test("file with only whitespace is an error", () => {
        const filePath = path.join(tmpDir, "Whitespace.data");
        fs.writeFileSync(filePath, "   \n  ");
        expect(detectFileFormat(filePath)).toBe("error");
    });
});
