import { getFindMyItemModelDisplayName, transformFindMyItemToDevice } from "../../server/api/lib/findmy/utils";

const makeItem = (overrides: Partial<any> = {}): any => ({
    identifier: "item-123",
    name: "My AirTag",
    productType: {
        type: "b389",
        productInformation: null
    },
    address: {
        formattedAddressLines: ["123 Main St", "San Francisco, CA"],
        locality: "San Francisco"
    },
    location: {
        latitude: 37.7749,
        longitude: -122.4194,
        timeStamp: 1700000000000
    },
    crowdSourcedLocation: {
        latitude: 37.775,
        longitude: -122.42
    },
    batteryStatus: 1,
    serialNumber: "SN12345",
    productIdentifier: "prod-123",
    role: {
        name: "Keys",
        emoji: "\uD83D\uDD11",
        identifier: 1
    },
    lostModeMetadata: null,
    groupIdentifier: "group-abc",
    groupName: "My Group",
    isAppleAudioAccessory: false,
    capabilities: 255,
    safeLocations: [],
    ...overrides
});

describe("getFindMyItemModelDisplayName", () => {
    test("type 'b389' returns 'AirTag'", () => {
        const item = makeItem({ productType: { type: "b389", productInformation: null } });
        expect(getFindMyItemModelDisplayName(item)).toBe("AirTag");
    });

    test("has modelName returns modelName", () => {
        const item = makeItem({
            productType: {
                type: "some-type",
                productInformation: {
                    manufacturerName: "Apple",
                    modelName: "AirPods Pro",
                    productIdentifier: 1,
                    vendorIdentifier: 1,
                    antennaPower: 1
                }
            }
        });
        expect(getFindMyItemModelDisplayName(item)).toBe("AirPods Pro");
    });

    test("no productInformation returns type string", () => {
        const item = makeItem({
            productType: { type: "custom-tracker", productInformation: null }
        });
        expect(getFindMyItemModelDisplayName(item)).toBe("custom-tracker");
    });

    test("null item returns 'Unknown'", () => {
        expect(getFindMyItemModelDisplayName(null as any)).toBe("Unknown");
    });
});

describe("transformFindMyItemToDevice", () => {
    test("maps identifier to id", () => {
        const item = makeItem();
        const device = transformFindMyItemToDevice(item);
        expect(device.id).toBe("item-123");
    });

    test("maps name, address, location", () => {
        const item = makeItem();
        const device = transformFindMyItemToDevice(item);
        expect(device.name).toBe("My AirTag");
        expect(device.address).toEqual(item.address);
        expect(device.location).toEqual(item.location);
    });

    test("sets isConsideredAccessory to true", () => {
        const item = makeItem();
        const device = transformFindMyItemToDevice(item);
        expect(device.isConsideredAccessory).toBe(true);
    });

    test("maps groupIdentifier and groupName", () => {
        const item = makeItem();
        const device = transformFindMyItemToDevice(item);
        expect(device.groupIdentifier).toBe("group-abc");
        expect(device.groupName).toBe("My Group");
    });

    test("maps crowdSourcedLocation", () => {
        const item = makeItem();
        const device = transformFindMyItemToDevice(item);
        expect(device.crowdSourcedLocation).toEqual(item.crowdSourcedLocation);
    });

    test("maps serialNumber", () => {
        const item = makeItem();
        const device = transformFindMyItemToDevice(item);
        expect(device.serialNumber).toBe("SN12345");
    });

    test("maps role and deviceDisplayName from role emoji", () => {
        const item = makeItem();
        const device = transformFindMyItemToDevice(item);
        expect(device.role).toEqual(item.role);
        expect(device.deviceDisplayName).toBe("\uD83D\uDD11");
    });

    test("sets modelDisplayName via getFindMyItemModelDisplayName", () => {
        const item = makeItem({ productType: { type: "b389", productInformation: null } });
        const device = transformFindMyItemToDevice(item);
        expect(device.modelDisplayName).toBe("AirTag");
    });

    test("maps lostModeEnabled from lostModeMetadata", () => {
        const itemNoLost = makeItem({ lostModeMetadata: null });
        expect(transformFindMyItemToDevice(itemNoLost).lostModeEnabled).toBe(false);

        const itemLost = makeItem({
            lostModeMetadata: {
                email: "test@example.com",
                message: "Lost!",
                ownerNumber: "555-1234",
                timestamp: 1700000000000
            }
        });
        expect(transformFindMyItemToDevice(itemLost).lostModeEnabled).toBe(true);
    });

    test("sets static fields correctly", () => {
        const item = makeItem();
        const device = transformFindMyItemToDevice(item);
        expect(device.batteryStatus).toBe("Unknown");
        expect(device.audioChannels).toEqual([]);
        expect(device.lostModeCapable).toBe(true);
        expect(device.locationEnabled).toBe(true);
        expect(device.fmlyShare).toBe(false);
        expect(device.thisDevice).toBe(false);
        expect(device.isMac).toBe(false);
        expect(device.prsId).toBe("owner");
        expect(device.locationCapable).toBe(true);
    });
});
