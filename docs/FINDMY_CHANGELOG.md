# Find My Integration Changelog

## macOS 26 (Tahoe) Compatibility Fix

### Problem

The macOS 14+ swizzle crashed on macOS 26 with:
```
-[IMFindMyHandle findMyHandle]: unrecognized selector
```

Apple introduced two new IMCore wrapper classes in macOS 26:
- `IMFindMyHandle` — wraps `FMFHandle` and `FMLHandle` with a unified `identifier` property
- `IMFindMyLocation` — wraps `FMFLocation` and `FMLLocation`

The `didReceiveLocationForHandle:` swizzle on `IMFMFSession` now receives `IMFindMyHandle` objects instead of `IMHandle`. Calling `findMyLocationForHandle:` with an `IMFindMyHandle` triggers an internal `findMyHandle` selector that doesn't exist on the new type.

### Changes

#### Helper Bundle (BlueBubblesHelper.m)

**Fixed `didReceiveLocationForHandle:` swizzle for macOS 26+:**
- Detects `IMFindMyHandle` via `NSClassFromString` and `isKindOfClass:`
- Uses `findMyLocationForFindMyHandle:` (which accepts `IMFindMyHandle`) instead of `findMyLocationForHandle:` (which expects `IMHandle`)
- Unwraps `IMFindMyLocation` return type to extract inner `FMLLocation` via `fmlLocation` property
- Extracts handle identifier directly from `IMFindMyHandle.identifier`
- Falls back to macOS 14-15 path (`findMyLocationForHandle:`) when arg is not `IMFindMyHandle`

**Improved `refresh-findmy-friends` handle extraction:**
- Added `identifier` selector check for macOS 26 friend objects that may not have a `handle` property
- Added `fmlHandle` extraction as fallback for `IMFindMyHandle` wrappers
- Added diagnostic logging of friend object class types

**Made `locationUpdateCallback` type-safe across versions:**
- Changed block parameters from `(FMLLocation *, FMLHandle *)` to `(id, id)` for forward compatibility
- Added `respondsToSelector:` checks on both location and handle parameters
- Added `IMFindMyLocation` unwrapping (extracts inner `FMLLocation` if callback receives wrapper types)

#### New Header Files

- `IMFindMyHandle.h` — macOS 26+ handle wrapper with `identifier`, `fmfHandle`, `fmlHandle`
- `IMFindMyLocation.h` — macOS 26+ location wrapper with `fmfLocation`, `fmlLocation`, `shortAddress`

### Verified

Live-tested on macOS 26.1 (Tahoe) with DYLD_INSERT_LIBRARIES injection into Messages.app:
- 18/18 integration tests passed
- Real friend locations returned (2 contacts with valid lat/lon coordinates)
- `new-findmy-location` real-time events emitted correctly
- No crashes or unrecognized selector errors

---

## macOS 14+ (Sonoma/Sequoia) Support

### Problem

BlueBubbles' Find My integration was broken on macOS 14+ due to Apple's API changes:

1. **Friend locations returned empty arrays on macOS 14+.** The helper bundle called `cachedLocationForHandle:` synchronously right after `startRefreshingLocationForHandles:`, which returned `nil` because the new `FindMyLocateSession` API is fully asynchronous.

2. **The real-time swizzle was a non-functional stub on macOS 14+.** The old code swizzled `locationUpdateCallback` on `FindMyLocateSession`, but that's a property getter, not the callback entry point.

3. **Device/item tracking was completely disabled on macOS 15+ (Sequoia).** An `isMinSequoia` early-return blocked all cache file reading.

4. **Friend refresh was blocked on macOS 14+ (Sonoma).** A `!isMinSonoma` condition in `refreshFriends()` prevented the Private API from being called.

### Changes

#### Helper Bundle (BlueBubblesHelper.m)

**Fixed macOS 14+ friend location refresh** (`refresh-findmy-friends` handler):
- Replaced broken synchronous `cachedLocationForHandle:` pattern with proper async flow
- Sets `locationUpdateCallback` on `FindMyLocateSession` before calling `startRefreshingLocationForHandles:`
- Uses `NSLock` to protect shared mutable state (`NSMutableArray` of locations, `NSMutableSet` of completed handles)
- Implements 15-second timeout via `dispatch_after` to send partial results if not all handles respond
- Falls back to `cachedLocationForHandle:includeAddress:YES` in the completion handler for any handles that didn't report via callback
- Full `@try/@catch` wrapping throughout to prevent crashes in Messages.app

**Added real-time location swizzle for macOS 14+** (`BBH_IMFMFSession`):
- Swizzles `didReceiveLocationForHandle:` on `IMFMFSession` (the bridging class between Messages.app and Find My frameworks)
- Only fires on macOS 14+ (macOS 13 and below use the existing `FMFSessionDataManager` swizzle)
- Handles both `FMFLocation` (CLLocationCoordinate2D-based) and `FMLLocation` (direct lat/lon properties) response types
- Includes geocoding fallback via `CLGeocoder` when coordinates are `[0, 0]` but an address string exists
- Emits `new-findmy-location` events via the TCP socket connection

#### Server (findMyInterface.ts)

**Removed Sequoia device tracking block:**
- Removed the `isMinSequoia` early-return from `getDevices()` that prevented all cache file reading on macOS 15+
- Devices/items are now attempted on all macOS versions, with graceful handling when files are encrypted

**Removed Sonoma Private API restriction:**
- Changed `if (papiEnabled && isMinBigSur && !isMinSonoma)` to `if (papiEnabled && isMinBigSur)` in `refreshFriends()`
- Private API friend location refresh now works on all macOS 11+

**Added binary plist detection:**
- `readDataFile()` now reads files as raw `Buffer` and checks for `bplist` magic bytes (first 6 bytes)
- Encrypted binary plists return `null` gracefully with a debug log instead of crashing on `JSON.parse()`
- Same detection added to `readItemGroups()`, which returns `[]` for encrypted files

**Cleaned up imports:**
- Removed unused `isMinSequoia` and `isMinSonoma` imports from `@server/env`

### Apple's Private Framework Changes (Reference)

| Framework Class | macOS 11-13 | macOS 14-15 | macOS 26+ |
|---|---|---|---|
| `FMFSession` | Primary session class | Deprecated | Deprecated |
| `FindMyLocateSession` | Not available | Replacement session class | Still used |
| `FMFLocation` | Location with CLLocationCoordinate2D | Still used in some paths | Wrapped by `IMFindMyLocation` |
| `FMLLocation` | Not available | New location type (lat/lon) | Wrapped by `IMFindMyLocation` |
| `FMFHandle` | Friend handle with identifier | Still used | Wrapped by `IMFindMyHandle` |
| `FMLHandle` | Not available | New handle for FindMyLocateSession | Wrapped by `IMFindMyHandle` |
| `IMFMFSession` | Bridge class | Bridge class (wraps FindMyLocateSession) | Bridge class (uses `IMFindMyHandle`/`IMFindMyLocation`) |
| `IMFindMyHandle` | Not available | Not available | Unified handle wrapper (`identifier`, `fmfHandle`, `fmlHandle`) |
| `IMFindMyLocation` | Not available | Not available | Unified location wrapper (`fmfLocation`, `fmlLocation`) |
| `FMFSessionDataManager` | Location store with `setLocations:` | Still exists but not primary path | Still exists |

### Key Header Files

Located in `bluebubbles-helper/Messages/MacOS-11+/BlueBubblesHelper/`:

- `FMLSession.h` -- `FindMyLocateSession` with `locationUpdateCallback`, `startRefreshingLocationForHandles:`, `getFriendsSharingLocationsWithMeWithCompletion:`
- `IMFMFSession.h` -- Bridge between Messages.app and Find My, with `fmlSession`, `findMyLocationForHandle:`, `findMyLocationForFindMyHandle:`, `didReceiveLocationForHandle:`
- `IMFindMyHandle.h` -- macOS 26+ handle wrapper with `identifier`, `fmfHandle`, `fmlHandle` (discovered via runtime introspection)
- `IMFindMyLocation.h` -- macOS 26+ location wrapper with `fmfLocation`, `fmlLocation`, `shortAddress` (discovered via runtime introspection)
- `FMFSession.h` -- Legacy session class with `getHandlesSharingLocationsWithMe`, `forceRefresh`
- `FMFLocation.h` -- Legacy location with `coordinate`, `longAddress`, `shortAddress`, `title`, `subtitle`
- `FMLLocation.h` -- New location with `latitude`, `longitude`, `timestamp`, `locationType`, `address`, `labels`
- `FMLHandle.h` -- New handle with `identifier`

### Files Modified

| File | Lines Changed | Description |
|---|---|---|
| `BlueBubblesHelper.m` | +480/-33 | macOS 14+ async friend refresh + IMFMFSession swizzle + macOS 26 IMFindMyHandle support |
| `IMFindMyHandle.h` | +22 (new) | macOS 26 handle wrapper header |
| `IMFindMyLocation.h` | +22 (new) | macOS 26 location wrapper header |
| `findMyInterface.ts` | +24/-14 | Removed version blocks, added bplist detection |
| `env.ts` | (imports only) | Removed unused version imports from findMyInterface |
