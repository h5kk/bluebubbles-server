# Find My Integration -- Client API Reference

This document is for client app developers integrating BlueBubbles' Find My features. It covers all HTTP endpoints, WebSocket events, data types, and important behavioral notes.

**Server version:** 1.9.9+
**Requires:** Private API enabled + helper connected (for friend locations)

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [HTTP Endpoints](#http-endpoints)
  - [Get Friend Locations](#get-friend-locations)
  - [Refresh Friend Locations](#refresh-friend-locations)
  - [Get Device/Item Locations](#get-deviceitem-locations)
  - [Refresh Device/Item Locations](#refresh-deviceitem-locations)
- [WebSocket Events](#websocket-events)
  - [new-findmy-location](#new-findmy-location)
- [Data Types](#data-types)
  - [FindMyLocationItem (Friends)](#findmylocationitem-friends)
  - [FindMyDevice (Devices & Items)](#findmydevice-devices--items)
  - [FindMyLocation](#findmylocation)
  - [FindMyAddress](#findmyaddress)
- [Server Capability Detection](#server-capability-detection)
- [Recommended Client Flow](#recommended-client-flow)
- [Edge Cases & Caveats](#edge-cases--caveats)

---

## Prerequisites

Before calling Find My endpoints, check the server info response:

```
GET /api/v1/server/info
```

```json
{
  "status": 200,
  "data": {
    "os_version": "26.1.0",
    "private_api": true,
    "helper_connected": true
  }
}
```

| Field | Meaning |
|---|---|
| `private_api` | Whether the Private API setting is enabled in the server config |
| `helper_connected` | Whether the helper bundle is injected into Messages.app and connected |

**Friend locations** require both `private_api: true` AND `helper_connected: true`. Without the helper, the friends endpoints will return a 500 error.

**Device/item locations** work independently of the Private API. They read Apple's local cache files and don't require the helper. However, on **macOS 14.4+** these cache files are encrypted and will return `null`.

---

## HTTP Endpoints

All endpoints are under `/api/v1/icloud/findmy/`. All require the server password via query param (`?password=YOUR_PASSWORD`) or authorization header.

### Get Friend Locations

```
GET /api/v1/icloud/findmy/friends
```

Returns cached friend locations from memory. Fast, no network call. Requires Private API.

**Response:**

```json
{
  "status": 200,
  "message": "Successfully fetched Find My friends locations!",
  "data": [
    {
      "handle": "+15127914501",
      "status": "shallow",
      "subtitle": null,
      "short_address": "Denver, CO",
      "title": null,
      "last_updated": 1771361372000,
      "coordinates": [39.86301974445538, -104.66970036772223],
      "long_address": "locality: Denver, country: United States, stateCode: CO, streetAddress: , streetName: .",
      "is_locating_in_progress": 0
    },
    {
      "handle": "rana.noueilaty@gmail.com",
      "status": "shallow",
      "subtitle": null,
      "short_address": "Denver, CO",
      "title": null,
      "last_updated": 1771361372000,
      "coordinates": [39.86301974445538, -104.66970036772223],
      "long_address": "locality: Denver, country: United States, stateCode: CO, streetAddress: , streetName: .",
      "is_locating_in_progress": 0
    }
  ]
}
```

**Error (helper not connected):**

```json
{
  "status": 500,
  "message": "Please make sure you have completed the setup for the Private API, and your helper is connected!",
  "error": {
    "type": "iMessage Error",
    "message": "iMessage Private API Helper is not connected!"
  }
}
```

**Notes:**
- Returns the in-memory cache, which may be empty on first call after server start
- The `handle` field is the iMessage identifier (phone number or email)
- The same person may appear with multiple handles (e.g. phone + email)
- `data` is always an array, empty `[]` if no friends are sharing location

---

### Refresh Friend Locations

```
POST /api/v1/icloud/findmy/friends/refresh
```

Triggers an active refresh via the Private API helper bundle. The server asks Messages.app to query Apple's Find My service for updated locations. Also opens the Find My app in the background to trigger additional updates.

**Response:** Same shape as `GET /friends`. Returns the full cache contents after refresh.

**Timing:**
- The Private API helper has a **15-second timeout** for the refresh
- Some friends may not respond within the timeout -- partial results are returned
- Real-time updates continue arriving via WebSocket after the HTTP response

---

### Get Device/Item Locations

```
GET /api/v1/icloud/findmy/devices
```

Returns devices (iPhones, Macs, etc.) and items (AirTags, third-party Find My accessories) from Apple's local cache files.

**Response (devices available):**

```json
{
  "status": 200,
  "message": "Successfully fetched Find My device locations!",
  "data": [
    {
      "id": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
      "name": "Hanny's iPhone",
      "deviceModel": "iPhone15,3",
      "modelDisplayName": "iPhone 15 Pro Max",
      "deviceDisplayName": "iPhone",
      "deviceClass": "iPhone",
      "batteryLevel": 0.85,
      "batteryStatus": "NotCharging",
      "location": {
        "latitude": 39.8630,
        "longitude": -104.6697,
        "altitude": 1609.0,
        "horizontalAccuracy": 10.0,
        "verticalAccuracy": 6.0,
        "timeStamp": 1771361372,
        "positionType": "GPS",
        "isOld": false,
        "isInaccurate": false,
        "locationFinished": true
      },
      "address": {
        "formattedAddressLines": ["123 Main St", "Denver, CO 80202"],
        "locality": "Denver",
        "administrativeArea": "Colorado",
        "stateCode": "CO",
        "country": "United States",
        "countryCode": "US"
      },
      "isMac": false,
      "isConsideredAccessory": false,
      "lostModeEnabled": false
    }
  ]
}
```

**Response (cache encrypted, macOS 14.4+):**

```json
{
  "status": 200,
  "message": "Successfully fetched Find My device locations!",
  "data": null
}
```

**AirTags / Items:** Items are transformed to match the `FindMyDevice` shape. You can distinguish them by:
- `isConsideredAccessory: true` -- always true for items/AirTags
- `identifier` -- present on items (the item's unique ID)
- `groupIdentifier` / `groupName` -- item group info
- `role.name` -- "AirTag" for AirTags
- `role.emoji` -- display emoji for the item type
- `serialNumber` -- present on items

**Notes:**
- `data` is `null` when cache files are encrypted (macOS 14.4+) or missing
- `data` is an array when available, combining both devices and items
- Device `location.timeStamp` is in **seconds** (not milliseconds like friend `last_updated`)

---

### Refresh Device/Item Locations

```
POST /api/v1/icloud/findmy/devices/refresh
```

Opens the Find My app to trigger Apple to refresh device locations, then reads the updated cache files.

**Response:** Same shape as `GET /devices`.

**Timing:** This is slow (~25 seconds) because it:
1. Quits Find My app (waits 3s)
2. Opens Find My app (waits 5s)
3. Shows Find My app (waits 15s for refresh)
4. Hides Find My app
5. Reads updated cache files

---

## WebSocket Events

### new-findmy-location

**Event name:** `new-findmy-location`

Emitted in real-time when a friend's location updates. These arrive asynchronously from the Private API helper -- you don't need to call any HTTP endpoint to receive them.

**Payload:**

```json
{
  "handle": "+15127914501",
  "status": "live",
  "subtitle": null,
  "short_address": "Denver, CO",
  "title": null,
  "last_updated": 1771361372000,
  "coordinates": [39.86301974445538, -104.66970036772223],
  "long_address": "locality: Denver, country: United States, stateCode: CO, streetAddress: , streetName: .",
  "is_locating_in_progress": 0
}
```

**Behavior:**
- Each event is a single `FindMyLocationItem`
- Events are **rate-limited** to 250ms between emissions
- **Deduplicated** -- only emitted when the cache actually changes (same coordinates + timestamp + status are filtered)
- Status downgrades are filtered -- a `"legacy"` update won't overwrite a `"live"` or `"shallow"` entry
- Coordinate downgrades are filtered -- `[0, 0]` won't overwrite real coordinates

**When events fire:**
- After calling `POST /friends/refresh` -- updates arrive as each friend responds
- Passively when the Find My app or Messages.app receives location updates in the background
- The swizzle hook on Messages.app intercepts location updates in real-time

---

## Data Types

### FindMyLocationItem (Friends)

```typescript
type FindMyLocationItem = {
    handle: string | null;            // iMessage handle: phone (+1XXXXXXXXXX) or email
    coordinates: [number, number];    // [latitude, longitude]
    long_address: string | null;      // Full address text
    short_address: string | null;     // "City, State" abbreviation
    subtitle: string | null;          // Location subtitle
    title: string | null;             // Location label (e.g. "_$!<home>!$_" for home)
    last_updated: number;             // Unix timestamp in MILLISECONDS
    is_locating_in_progress: 0 | 1;   // 1 if location is actively being fetched
    status: "legacy" | "live" | "shallow";
};
```

**Status values:**
| Status | Meaning | Client guidance |
|---|---|---|
| `"live"` | Real-time active sharing | Show as current, use green indicator |
| `"shallow"` | Approximate or recent location | Show as recent, use yellow indicator |
| `"legacy"` | Older format or stale data | Show as stale, use gray indicator |

**Handle format:** The `handle` is the iMessage identifier. A single person may have multiple handles (e.g. `"+15127914501"` and `"user@email.com"`). To associate handles with contacts, use the BlueBubbles contacts/handles API.

**Title special values:** Apple uses tagged strings for named locations:
- `"_$!<home>!$_"` -- Home
- `"_$!<work>!$_"` -- Work
- Regular string -- Custom label

---

### FindMyDevice (Devices & Items)

```typescript
interface FindMyDevice {
    // Identity
    id?: string;                       // Device UUID
    name?: string;                     // User-assigned name ("Hanny's iPhone")
    deviceModel?: string;              // Model identifier ("iPhone15,3")
    modelDisplayName?: string;         // Human name ("iPhone 15 Pro Max")
    deviceDisplayName?: string;        // Short name ("iPhone")
    deviceClass?: string;              // "iPhone", "Mac", "iPad", etc.
    rawDeviceModel?: string;           // Raw model string

    // Location
    location?: FindMyLocation;         // Current GPS location
    crowdSourcedLocation?: FindMyLocation; // Crowd-sourced (Bluetooth) location
    address?: FindMyAddress;           // Reverse-geocoded address
    safeLocations?: FindMySafeLocation[]; // Saved locations (Home, Work, etc.)

    // Status
    batteryLevel?: number;             // 0.0 to 1.0
    batteryStatus?: string;            // "NotCharging", "Charging", "Charged"
    lostModeEnabled?: unknown;         // true if in Lost Mode
    deviceStatus?: string;             // Device status string
    locationEnabled?: unknown;         // Whether location is enabled

    // Flags
    isMac?: unknown;
    thisDevice?: unknown;              // true if this is the server Mac
    isConsideredAccessory?: unknown;    // true for AirTags/items
    fmlyShare?: unknown;               // Family Sharing device

    // Item-specific (AirTags, accessories)
    identifier?: string;               // Item unique identifier
    productIdentifier?: string;        // Product ID
    serialNumber?: string;             // Serial number
    role?: {                           // Item type info
        name: string;                  // "AirTag", "Accessory", etc.
        emoji: string;                 // Display emoji
        identifier: number;
    };
    groupIdentifier?: string | null;   // Item group UUID
    groupName?: string | null;         // Item group name (e.g. "Keys")
    lostModeMetadata?: {               // Lost mode details (items)
        email: string;
        message: string;
        ownerNumber: string;
        timestamp: number;
    } | null;
    isAppleAudioAccessory?: boolean;   // AirPods, etc.
    capabilities?: number;
}
```

---

### FindMyLocation

```typescript
interface FindMyLocation {
    latitude?: number;
    longitude?: number;
    altitude?: number;                 // Meters above sea level
    horizontalAccuracy?: number;       // Meters
    verticalAccuracy?: number;         // Meters
    timeStamp?: number;                // Unix timestamp in SECONDS
    positionType?: string;             // "GPS", "WiFi", "Cellular", etc.
    floorLevel?: number;               // Indoor floor level
    isInaccurate?: boolean;            // Apple's inaccuracy flag
    isOld?: boolean;                   // Apple considers this stale
    locationFinished?: boolean;        // Location resolution complete
}
```

### FindMyAddress

```typescript
interface FindMyAddress {
    formattedAddressLines: string[];   // Full address lines
    fullThroroughfare?: string;        // Street address (note: Apple's typo)
    streetAddress?: string;
    streetName?: string;
    locality?: string;                 // City
    administrativeArea?: string;       // State/Province
    subAdministrativeArea?: string;    // County
    stateCode?: string;                // "CO", "TX", etc.
    country?: string;                  // "United States"
    countryCode?: string;              // "US"
    mapItemFullAddress?: string;       // Apple Maps formatted address
    label?: string;                    // Location label
    areaOfInterest?: unknown[];
}
```

---

## Server Capability Detection

Use `GET /api/v1/server/info` to determine what's available:

```
private_api: true  + helper_connected: true  --> Friends + Devices available
private_api: true  + helper_connected: false --> Only Devices available (no friends)
private_api: false + helper_connected: false --> Only Devices available (no friends)
```

**macOS version impact** (from `os_version` field):

| macOS | Friends | Devices/Items |
|---|---|---|
| < 11.0 | Not available | JSON cache (works) |
| 11.0 -- 14.3 | Available (Private API) | JSON cache (works) |
| 14.4+ | Available (Private API) | Encrypted cache (`data: null`) |

On macOS 14.4+, `GET /devices` returns `data: null`. Friends via Private API are **unaffected** by the encryption since they use live framework calls.

---

## Recommended Client Flow

### Initial Load

```
1. GET /api/v1/server/info
   --> Check private_api + helper_connected + os_version

2. If helper_connected:
   GET /api/v1/icloud/findmy/friends
   --> Display cached friend locations (may be empty on cold start)

3. GET /api/v1/icloud/findmy/devices
   --> Display device/item locations (null on macOS 14.4+)

4. Subscribe to WebSocket event "new-findmy-location"
   --> Real-time friend location updates
```

### Refresh

```
1. POST /api/v1/icloud/findmy/friends/refresh
   --> Returns updated cache (may take up to 15 seconds)
   --> Additional updates continue arriving via WebSocket

2. POST /api/v1/icloud/findmy/devices/refresh
   --> Returns updated cache (takes ~25 seconds)
   --> Only useful on macOS < 14.4
```

### Real-Time Updates

```
WebSocket: listen for "new-findmy-location"
--> Update the specific friend by matching on "handle" field
--> Each event is one friend's updated location
--> Events are pre-deduplicated (only fires on actual changes)
```

---

## Edge Cases & Caveats

1. **`coordinates: [0, 0]`** -- May appear when Apple returns a valid address but no GPS fix. The server attempts geocoding but may still return `[0, 0]`. Treat as "location unknown."

2. **`data: null` on devices** -- Normal on macOS 14.4+. Apple encrypts cache files with a system entitlement not available to third-party apps. Show appropriate UI message.

3. **`handle: null`** -- Rare. The cache silently drops entries with null handles. You shouldn't receive these.

4. **Multiple handles per person** -- One person may appear as both `"+15127914501"` and `"user@email.com"`. Use the contacts/handles API to resolve these to a single contact if needed.

5. **`title` field with Apple tags** -- Values like `"_$!<home>!$_"` should be parsed to extract the location type ("home", "work") and displayed as a friendly label.

6. **Timestamp units differ** -- Friend `last_updated` is in **milliseconds**. Device `location.timeStamp` is in **seconds**. Be careful when comparing.

7. **Empty cache after server restart** -- The friends cache is in-memory only. After a server restart, `GET /friends` returns `[]` until a refresh is triggered or real-time updates arrive.

8. **Partial refresh results** -- The 15-second timeout on friend refresh means not all friends may be included in the HTTP response. Subscribe to the WebSocket to catch late arrivals.

9. **Rate limiting** -- WebSocket events are throttled to 250ms apart. If many friends update simultaneously, events arrive in rapid succession but not instantly.

10. **`isConsideredAccessory`** -- Use this to distinguish Apple devices (iPhones, Macs) from accessories (AirTags, third-party items) in the devices response. Items always have `isConsideredAccessory: true`.
