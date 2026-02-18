# Find My Integration

This document covers BlueBubbles' integration with Apple's Find My service, including friend location tracking, device/item tracking, and real-time location updates via the Private API helper bundle.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [macOS Version Compatibility](#macos-version-compatibility)
- [API Endpoints](#api-endpoints)
- [Private API (Helper Bundle)](#private-api-helper-bundle)
  - [Friend Location Refresh](#friend-location-refresh)
  - [Real-Time Location Swizzles](#real-time-location-swizzles)
- [Server-Side Components](#server-side-components)
  - [FindMyInterface](#findmyinterface)
  - [FindMyFriendsCache](#findmyfriendscache)
  - [Device & Item Tracking](#device--item-tracking)
  - [Event Handling](#event-handling)
- [Data Types & Response Format](#data-types--response-format)
- [Binary Plist Detection](#binary-plist-detection)
- [Testing](#testing)
- [Known Limitations](#known-limitations)

---

## Overview

BlueBubbles provides two Find My capabilities:

1. **Friend Locations** -- Track the locations of friends sharing their location with you via iMessage/Find My
2. **Device & Item Tracking** -- Read Apple's Find My cache files to retrieve device and accessory (AirTag, etc.) locations

Friend locations use the **Private API** helper bundle injected into Messages.app for real-time data. Device/item tracking reads Apple's local Find My cache files directly from the filesystem.

## Architecture

```
Client App
    |
    v
REST API (Koa)  <-->  FindMyRouter  <-->  FindMyInterface
    |                                         |
    |                                    +----+----+
    |                                    |         |
    v                                    v         v
WebSocket (Socket.io)          Private API    Cache Files
    ^                          (Helper IPC)   (~/Library/...)
    |                               |
    |                               v
    +--- Event Emitter <--- PrivateApiFindMyEventHandler
                                    ^
                                    |
                            BlueBubblesHelper.m
                            (injected into Messages.app)
```

## macOS Version Compatibility

| macOS Version | Friends (Private API) | Friends (FMF Swizzle) | Devices/Items (Cache) |
|---|---|---|---|
| 10.13-10.15 (High Sierra-Catalina) | Not supported | Not supported | JSON cache files |
| 11.x (Big Sur) | FMFSession | FMFSessionDataManager | JSON cache files |
| 12.x (Monterey) | FMFSession | FMFSessionDataManager | JSON cache files |
| 13.x (Ventura) | FMFSession | FMFSessionDataManager | JSON cache files |
| 14.0-14.3 (Sonoma) | FindMyLocateSession | IMFMFSession | JSON cache files |
| 14.4+ (Sonoma) | FindMyLocateSession | IMFMFSession | Encrypted binary plist |
| 15.x (Sequoia) | FindMyLocateSession | IMFMFSession | Encrypted binary plist |
| 26.x (Tahoe) | FindMyLocateSession | IMFMFSession (via IMFindMyHandle) | Encrypted binary plist |

**Key version boundaries:**
- **macOS 14+ (Sonoma):** Apple replaced `FMFSession` with `FindMyLocateSession`. The async callback pattern changed entirely.
- **macOS 14.4+:** Apple began encrypting Find My cache files (`Devices.data`, `Items.data`, `ItemGroups.data`) with ChaCha20-Poly1305. These appear as binary plists (magic bytes: `bplist`). Decryption requires Apple's internal entitlement `com.apple.icloud.searchpartyuseragent`, which is not available to third-party apps.
- **macOS 26+ (Tahoe):** Apple introduced `IMFindMyHandle` and `IMFindMyLocation` wrapper classes in IMCore. `didReceiveLocationForHandle:` now receives `IMFindMyHandle` instead of `IMHandle`, requiring use of `findMyLocationForFindMyHandle:` instead of `findMyLocationForHandle:`.

Version detection is in `packages/server/src/server/env.ts`:

```typescript
export const isMinSequoia = macosVersion.isGreaterThanOrEqualTo("15.0");
export const isMinSonoma = macosVersion.isGreaterThanOrEqualTo("14.0");
export const isMinBigSur = macosVersion.isGreaterThanOrEqualTo("11.0");
// ... etc
```

---

## API Endpoints

Defined in `packages/server/src/server/api/http/api/v1/routers/findmyRouter.ts`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/findmy/devices` | Get cached device/item locations from Find My cache files |
| `GET` | `/api/v1/findmy/devices/refresh` | Force-refresh device locations (opens Find My app) |
| `GET` | `/api/v1/findmy/friends` | Get cached friend locations from in-memory cache |
| `GET` | `/api/v1/findmy/friends/refresh` | Refresh friend locations via Private API + Find My app |

### Response Format

All endpoints return the standard BlueBubbles response wrapper:

```json
{
    "status": 200,
    "message": "Successfully fetched Find My device locations!",
    "data": [ ... ]
}
```

**Devices** return an array of `FindMyDevice` objects. **Friends** return an array of `FindMyLocationItem` objects.

---

## Private API (Helper Bundle)

The Objective-C helper bundle (`BlueBubblesHelper.m`) handles friend location fetching via Apple's private frameworks. The implementation differs based on macOS version.

### Friend Location Refresh

**Action:** `refresh-findmy-friends`

#### macOS 11-13 (Big Sur - Ventura): FMFSession

Uses the legacy `FMFSession` class:

```
IMFMFSession (sharedInstance)
    -> session (FMFSession)
        -> getHandlesSharingLocationsWithMe
        -> locationForFMFHandle: (FMFLocation)
        -> forceRefresh
```

1. Gets all handles sharing locations via `getHandlesSharingLocationsWithMe`
2. Reads cached `FMFLocation` for each handle immediately
3. Calls `forceRefresh` to trigger background updates (which arrive via the `FMFSessionDataManager` swizzle)

#### macOS 14+ (Sonoma and later): FindMyLocateSession

Uses the newer `FindMyLocateSession` class with an async callback pattern:

```
IMFMFSession (sharedInstance)
    -> fmlSession (FindMyLocateSession)
        -> getFriendsSharingLocationsWithMeWithCompletion:
        -> setLocationUpdateCallback:
        -> startRefreshingLocationForHandles:priority:isFromGroup:reverseGeocode:completion:
        -> cachedLocationForHandle:includeAddress: (fallback)
```

The implementation uses:

1. **Async friend discovery:** `getFriendsSharingLocationsWithMeWithCompletion:` returns friends asynchronously
2. **Callback-based location updates:** Sets `locationUpdateCallback` on the session before triggering refresh. Each location arrives individually via this callback.
3. **Thread safety:** `NSLock` protects the locations array and completed handles set
4. **Completion tracking:** `NSMutableSet` tracks which handles have reported back
5. **15-second timeout:** `dispatch_after` sends whatever results have been collected if not all handles respond
6. **Cache fallback:** After `startRefreshingLocationForHandles:` completes, checks `cachedLocationForHandle:` for any handles that didn't report via the callback
7. **Exception safety:** All code paths are wrapped in `@try/@catch` -- the helper must never throw

### Real-Time Location Swizzles

Two swizzle hooks provide real-time location updates as they arrive:

#### FMFSessionDataManager (macOS 11-13)

**Class:** `BBH_FMFSessionDataManager` swizzles `FMFSessionDataManager`
**Method:** `setLocations:`

Fires when the Find My framework updates its internal location store. Iterates all `FMFLocation` objects in the set and emits `new-findmy-location` events.

#### IMFMFSession (macOS 14+)

**Class:** `BBH_IMFMFSession` swizzles `IMFMFSession`
**Method:** `didReceiveLocationForHandle:`

Fires when a new location is received for a specific handle. Calls the original implementation first, then:

**macOS 14-15 path:**
1. `arg1` is an `IMHandle` — calls `findMyLocationForHandle:` to get the location object (returns `FMFLocation` or `FMLLocation`)
2. Extracts handle identifier via `id` or `identifier` selector

**macOS 26+ (Tahoe) path:**
1. `arg1` is an `IMFindMyHandle` — calls `findMyLocationForFindMyHandle:` to get the location (returns `IMFindMyLocation`)
2. Unwraps `IMFindMyLocation` to get the inner `FMLLocation` via `fmlLocation` property
3. Extracts handle identifier directly from `IMFindMyHandle.identifier`

**Common processing (all versions):**
1. Handles both `FMFLocation` (CLLocationCoordinate2D-based) and `FMLLocation` (lat/lon properties) types
2. Geocodes `[0, 0]` coordinates using `CLGeocoder` when an address string is available
3. Emits `new-findmy-location` event via TCP socket

### Location Response Format

Both macOS code paths produce the same JSON structure:

```json
{
    "handle": "user@example.com",
    "coordinates": [37.7749, -122.4194],
    "long_address": "123 Main St, San Francisco, CA 94102",
    "short_address": "San Francisco, CA",
    "title": "Home",
    "subtitle": "San Francisco",
    "last_updated": 1708200000000,
    "is_locating_in_progress": 0,
    "status": "live"
}
```

**Status values:**
- `"legacy"` -- Location type 0 (older format, or macOS < 13)
- `"live"` -- Location type 2 (real-time sharing)
- `"shallow"` -- Any other location type

**Timestamps** are Unix epoch milliseconds (server time * 1000).

---

## Server-Side Components

### FindMyInterface

**File:** `packages/server/src/server/api/interfaces/findMyInterface.ts`

The main business logic layer for Find My operations.

| Method | Description |
|---|---|
| `getFriends()` | Returns all cached friend locations from `FindMyFriendsCache` |
| `getDevices()` | Reads `Devices.data` and `Items.data` cache files, merges and transforms them |
| `refreshFriends()` | Calls Private API to refresh, then returns cache. Also opens Find My app. |
| `refreshDevices()` | Opens Find My app to trigger refresh, then reads cache files |
| `refreshLocationsAccessibility()` | Opens/shows/hides the Find My app to trigger location refresh |
| `readDataFile(type)` | Generic reader for `Devices.data` or `Items.data` with bplist detection |
| `readItemGroups()` | Reads `ItemGroups.data` for accessory group names |

**Version gate for Private API:** `refreshFriends()` only calls the Private API when `enable_private_api` is enabled AND `isMinBigSur` is true (macOS 11+). There is no upper version limit -- it works on all macOS 11+.

### FindMyFriendsCache

**File:** `packages/server/src/server/api/lib/findmy/FindMyFriendsCache.ts`

In-memory cache for friend locations with smart deduplication rules:

1. **Null/empty handle rejection** -- Entries without a handle are dropped
2. **Status priority** -- `live`/`shallow` locations are never overwritten by `legacy` ones
3. **Coordinate protection** -- Non-zero coordinates are never overwritten by `[0, 0]` when both are legacy
4. **Duplicate detection** -- Identical status + coordinates + timestamp entries are dropped
5. **Timestamp ordering** -- Older updates (lower timestamp) never overwrite newer ones

### Device & Item Tracking

Devices and items are read from Apple's Find My cache directory:

```
~/Library/Caches/com.apple.findmy.fmipcore/
    Devices.data    -- Apple devices (iPhones, iPads, Macs, etc.)
    Items.data      -- Find My accessories (AirTags, third-party items)
    ItemGroups.data -- Accessory group names
```

The path is resolved via `FileSystem.findMyDir`.

**Items** (AirTags, etc.) are transformed to match the `FindMyDevice` shape using `transformFindMyItemToDevice()` in `packages/server/src/server/api/lib/findmy/utils.ts`. Key transformations:

- AirTag detection: `productType.type === "b389"` maps to display name "AirTag"
- `identifier` maps to `id`
- `lostModeMetadata` presence maps to `lostModeEnabled: true`
- `isConsideredAccessory` is always `true` for items
- Group names are looked up from `ItemGroups.data` and attached as `groupName`

### Event Handling

**File:** `packages/server/src/server/api/privateApi/eventHandlers/PrivateApiFindMyEventHandler.ts`

Handles `new-findmy-location` events from the helper bundle:

1. Receives location data array from TCP socket
2. Adds all entries to `FindMyFriendsCache` via `addAll()`
3. Emits `NEW_FINDMY_LOCATION` events via Socket.io for each updated entry
4. Rate-limits emissions to 250ms between events

**PrivateApiFindMy** (`packages/server/src/server/api/privateApi/apis/PrivateApiFindMy.ts`) sends the `refresh-findmy-friends` action to the helper via the transaction manager.

---

## Data Types & Response Format

### FindMyLocationItem (Friend Location)

```typescript
type FindMyLocationItem = {
    handle: string | null;           // iMessage handle (email or phone)
    coordinates: [number, number];   // [latitude, longitude]
    long_address: string | null;     // Full address string
    short_address: string | null;    // City, state abbreviation
    subtitle: string | null;         // Location subtitle
    title: string | null;            // Location title/label
    last_updated: number;            // Unix timestamp (milliseconds)
    is_locating_in_progress: 0 | 1;  // Whether location is being refreshed
    status: "legacy" | "live" | "shallow";
};
```

### FindMyDevice (Device/Item)

See `packages/server/src/server/api/lib/findmy/types.ts` for the full interface. Key fields:

```typescript
interface FindMyDevice {
    id?: string;                    // Device/item identifier
    name?: string;                  // User-assigned name
    deviceModel?: string;           // Model identifier
    modelDisplayName?: string;      // Human-readable model name
    deviceDisplayName?: string;     // Device emoji or display string
    location?: FindMyLocation;      // GPS coordinates + metadata
    address?: FindMyAddress;        // Reverse-geocoded address
    batteryLevel?: number;          // Battery percentage
    batteryStatus?: string;         // Battery state
    lostModeEnabled?: unknown;      // Whether lost mode is on
    isConsideredAccessory?: unknown; // true for AirTags/items
    groupIdentifier?: string;       // Item group ID
    groupName?: string;             // Item group name (from ItemGroups.data)
    // ... many more fields
}
```

---

## Binary Plist Detection

Starting with macOS 14.4, Apple encrypts Find My cache files using ChaCha20-Poly1305. These files appear as binary property lists with the `bplist` magic header.

The server detects this by reading the first 6 bytes of each cache file:

```typescript
if (data.length >= 6 && data.subarray(0, 6).toString("ascii") === "bplist") {
    // Encrypted binary plist -- return null gracefully
    return resolve(null);
}
```

This detection applies to:
- `Devices.data` -- returns `null` (no devices available)
- `Items.data` -- returns `null` (no items available)
- `ItemGroups.data` -- returns `[]` (no groups available)

When both `Devices.data` and `Items.data` are encrypted, `getDevices()` returns `null`. Friend locations via the Private API are unaffected since they use live framework calls, not cache files.

---

## Testing

### Jest Unit Tests

Located in `packages/server/src/__tests__/findmy/`. Run from `packages/server/`:

```bash
# Using the local jest binary (recommended)
./node_modules/.bin/jest --config jest.config.js --verbose

# Or via npm script
npm test
```

| Test Suite | File | Tests |
|---|---|---|
| FindMyFriendsCache | `FindMyFriendsCache.test.ts` | 14 tests -- add/addAll/get/getAll, deduplication, status priority, coordinate protection, timestamp ordering |
| Utilities | `utils.test.ts` | 14 tests -- AirTag detection, model name mapping, item-to-device field mapping |
| Binary Plist Detection | `bplistDetection.test.ts` | 9 tests -- missing files, valid JSON, bplist headers, invalid JSON, empty files |

Jest configuration is in `packages/server/jest.config.js` with `ts-jest` preset and path alias mappings matching `tsconfig.json`.

---

## Known Limitations

1. **Encrypted cache files (macOS 14.4+):** Device and item locations cannot be read from cache files on macOS 14.4+ because Apple encrypts them. Only friend locations via the Private API are available. Decryption requires Apple's internal entitlement `com.apple.icloud.searchpartyuseragent`.

2. **Find My app must be installed:** The `refreshLocationsAccessibility()` method opens, shows, and hides the Find My app to trigger cache file updates. This requires the app to be present on the system.

3. **Helper bundle injection required:** Friend locations require the Private API helper bundle to be injected into Messages.app via MacForge. Without it, only device cache file reading is available.

4. **Geocoding fallback:** When coordinates are `[0, 0]` but an address string is available, the helper uses `CLGeocoder` to resolve coordinates. This requires network access and may fail or return approximate results.

5. **15-second timeout:** The macOS 14+ friend location refresh has a 15-second timeout. If not all friends respond within this window, partial results are returned.

6. **Rate limiting:** Real-time location events are rate-limited to 250ms between emissions to avoid overwhelming connected clients.
