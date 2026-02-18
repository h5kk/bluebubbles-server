# Changelog

## [Unreleased]

### Added
- Contact Private API with 8 new endpoints for rich contact metadata via IMCore
  - `GET /handles/:address` - IMCore handle info for an address
  - `GET /contact/:address` - Full CNContact for a handle
  - `GET /contact/:address/photo` - Contact photo data
  - `POST /batch-check-imessage` - Batch check iMessage registration status
  - `GET /handles/:address/siblings` - Related handles for a contact
  - `GET /suggested-names/:address` - Suggested display names
  - `GET /availability/:address` - Contact availability status
  - `GET /detect-business/:address` - Detect if address is a business
- `enableContactPrivateApi` feature flag in server constants
- Find My documentation: architecture overview, client API reference, changelog
- Jest test infrastructure with unit tests for Find My (FindMyFriendsCache, bplist detection, utilities)
- Find My validation and live-test scripts for TCP integration

### Fixed
- Find My friends refresh now works on macOS Sonoma and later (removed version gate that blocked Sonoma+)
- Find My cache file reading handles encrypted binary plist files (macOS 14.4+) gracefully instead of crashing
- Find My cache files are read as raw buffers before decoding to avoid encoding errors

### Changed
- Find My `getDevices()` no longer returns null on Sequoia; reads cache files on all supported versions
- `devEngines` field in root package.json updated to new npm format
