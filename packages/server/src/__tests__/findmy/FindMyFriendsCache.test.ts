jest.mock("@server", () => ({}));
jest.mock("@server/helpers/utils", () => ({
    isEmpty: (val: any) => val === null || val === undefined || val === ""
}));

import { FindMyFriendsCache } from "../../server/api/lib/findmy/FindMyFriendsCache";

const makeLoc = (overrides: Partial<any> = {}): any => ({
    handle: "test@icloud.com",
    coordinates: [37.7749, -122.4194] as [number, number],
    long_address: "123 Main St",
    short_address: "Main St",
    title: "Home",
    subtitle: "San Francisco",
    last_updated: 1700000000000,
    is_locating_in_progress: 0,
    status: "live",
    ...overrides
});

describe("FindMyFriendsCache", () => {
    let cache: FindMyFriendsCache;

    beforeEach(() => {
        cache = new FindMyFriendsCache();
    });

    describe("add()", () => {
        test("valid location data returns true and get() returns it", () => {
            const loc = makeLoc();
            expect(cache.add(loc)).toBe(true);
            expect(cache.get("test@icloud.com")).toEqual(loc);
        });

        test("null handle returns false", () => {
            const loc = makeLoc({ handle: null });
            expect(cache.add(loc)).toBe(false);
        });

        test("empty string handle returns false", () => {
            const loc = makeLoc({ handle: "" });
            expect(cache.add(loc)).toBe(false);
        });

        test("new handle adds to cache", () => {
            const loc1 = makeLoc({ handle: "alice@icloud.com" });
            const loc2 = makeLoc({ handle: "bob@icloud.com" });
            expect(cache.add(loc1)).toBe(true);
            expect(cache.add(loc2)).toBe(true);
            expect(cache.get("alice@icloud.com")).toEqual(loc1);
            expect(cache.get("bob@icloud.com")).toEqual(loc2);
        });

        test("legacy status does not overwrite live status", () => {
            const liveLoc = makeLoc({ status: "live" });
            const legacyLoc = makeLoc({ status: "legacy", last_updated: 1700000001000 });
            cache.add(liveLoc);
            expect(cache.add(legacyLoc)).toBe(false);
            expect(cache.get("test@icloud.com")!.status).toBe("live");
        });

        test("legacy status does not overwrite shallow status", () => {
            const shallowLoc = makeLoc({ status: "shallow" });
            const legacyLoc = makeLoc({ status: "legacy", last_updated: 1700000001000 });
            cache.add(shallowLoc);
            expect(cache.add(legacyLoc)).toBe(false);
            expect(cache.get("test@icloud.com")!.status).toBe("shallow");
        });

        test("does not overwrite non-[0,0] coords with [0,0] when both legacy", () => {
            const loc1 = makeLoc({ status: "legacy", coordinates: [37.7749, -122.4194] });
            const loc2 = makeLoc({ status: "legacy", coordinates: [0, 0], last_updated: 1700000001000 });
            cache.add(loc1);
            expect(cache.add(loc2)).toBe(false);
            expect(cache.get("test@icloud.com")!.coordinates).toEqual([37.7749, -122.4194]);
        });

        test("ignores exact duplicate (same status, coords, timestamp)", () => {
            const loc = makeLoc();
            cache.add(loc);
            expect(cache.add(makeLoc())).toBe(false);
        });

        test("ignores older timestamp", () => {
            const loc1 = makeLoc({ last_updated: 1700000002000 });
            const loc2 = makeLoc({ last_updated: 1700000001000 });
            cache.add(loc1);
            expect(cache.add(loc2)).toBe(false);
            expect(cache.get("test@icloud.com")!.last_updated).toBe(1700000002000);
        });

        test("accepts newer timestamp with same status", () => {
            const loc1 = makeLoc({ last_updated: 1700000000000 });
            const loc2 = makeLoc({ last_updated: 1700000001000 });
            cache.add(loc1);
            expect(cache.add(loc2)).toBe(true);
            expect(cache.get("test@icloud.com")!.last_updated).toBe(1700000001000);
        });

        test("live overwrites legacy", () => {
            const legacyLoc = makeLoc({ status: "legacy" });
            const liveLoc = makeLoc({ status: "live", last_updated: 1700000001000 });
            cache.add(legacyLoc);
            expect(cache.add(liveLoc)).toBe(true);
            expect(cache.get("test@icloud.com")!.status).toBe("live");
        });
    });

    describe("addAll()", () => {
        test("returns only changed items", () => {
            const loc1 = makeLoc({ handle: "alice@icloud.com" });
            const loc2 = makeLoc({ handle: "bob@icloud.com" });
            cache.add(loc1);

            // loc1 is a duplicate (same timestamp, coords, status), loc2 is new
            const result = cache.addAll([makeLoc({ handle: "alice@icloud.com" }), loc2]);
            expect(result).toHaveLength(1);
            expect(result[0].handle).toBe("bob@icloud.com");
        });
    });

    describe("get()", () => {
        test("returns null for unknown handle", () => {
            expect(cache.get("unknown@icloud.com")).toBeNull();
        });
    });

    describe("getAll()", () => {
        test("returns all cached values", () => {
            const loc1 = makeLoc({ handle: "alice@icloud.com" });
            const loc2 = makeLoc({ handle: "bob@icloud.com" });
            cache.add(loc1);
            cache.add(loc2);
            const all = cache.getAll();
            expect(all).toHaveLength(2);
            expect(all).toEqual(expect.arrayContaining([loc1, loc2]));
        });
    });
});
