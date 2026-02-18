# BlueBubbles Contact Private API Reference

> LLM-optimized API reference. All response examples are verified against a live server.

## Quick Reference

| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 1 | GET | `/api/v1/contact/papi/handles` | List all known handles with contact metadata |
| 2 | GET | `/api/v1/contact/papi/handle/:address` | Get detailed contact info for one address |
| 3 | GET | `/api/v1/contact/papi/handle/:address/photo` | Get contact photo as base64 |
| 4 | POST | `/api/v1/contact/papi/imessage-status` | Batch check iMessage availability |
| 5 | GET | `/api/v1/contact/papi/handle/:address/siblings` | Get all addresses for the same person |
| 6 | GET | `/api/v1/contact/papi/suggested-names` | Get Siri-suggested names for non-contacts |
| 7 | GET | `/api/v1/contact/papi/handle/:address/availability` | Get Focus/DND status |
| 8 | GET | `/api/v1/contact/papi/handle/:address/business` | Detect business/Apple Business Chat |
| 9 | POST | `/api/v1/contact/papi/create` | Create a new contact |
| 10 | POST | `/api/v1/contact/papi/update` | Update an existing contact |
| 11 | POST | `/api/v1/contact/papi/delete` | Delete an existing contact |

## Authentication

Every request requires the server password via query parameter:

```
?password=YOUR_SERVER_PASSWORD
```

## Prerequisites

Both feature flags must be enabled:
- `enable_private_api` = `1` (checked by middleware)
- `enable_contacts_private_api` = `1` (checked by interface)

Enable via sqlite3:
```sql
sqlite3 ~/Library/Application\ Support/bluebubbles-server/config.db \
  "INSERT OR REPLACE INTO config (name, value) VALUES ('enable_contacts_private_api', '1');"
```

## Response Envelope

Every response uses this wrapper:

```typescript
// Success (HTTP 200)
{ status: 200, message: string, data: T }

// Error (HTTP 4xx/5xx)
{ status: number, message: string, error: { type: string, message: string } }
```

## Address Format

The `:address` URL parameter must be the exact address string stored by iMessage:
- Phone: `+11234567890` (E.164 with country code)
- Email: `user@example.com`
- Business URN: `urn:biz:b15ed773-9eed-11e7-baa2-7b88b04daa8e`

URL-encode special characters (`:`, `@`, `+`) when needed.

---

## Endpoint 1: List All Handles

```
GET /api/v1/contact/papi/handles?password=...
```

### Query Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `includePhotos` | `"true"` \| `"false"` | `"false"` | Include base64 photo per handle (expensive) |

### Response Schema

```typescript
{
    status: 200,
    message: "Successfully fetched handle contact info!",
    data: Array<{
        handleId: string,           // "+11234567890" or "user@example.com"
        service: string,            // "iMessage" or "SMS"
        fullName: string | null,    // resolved display name
        isContact: boolean,         // true if in address book
        isBusiness: boolean,        // true if business chat
        personCentricID: string | null,  // Apple cross-device person ID
        cnContactID: string | null,      // CNContact identifier
        suggestedName: string | null,    // Siri-suggested name
        photoBase64?: string | null,     // only if includePhotos=true
        siblings: Array<{
            handleId: string,
            service: string
        }>
    }>
}
```

### Verified Response (empty handles list)

```json
{
    "status": 200,
    "message": "Successfully fetched handle contact info!",
    "data": []
}
```

### Notes
- Each handle processed in isolated try/catch; one failure does not abort the list
- `includePhotos=true` can produce multi-MB responses; prefer endpoint 3 for individual photos

---

## Endpoint 2: Get Contact for Handle

```
GET /api/v1/contact/papi/handle/:address?password=...
```

### Response Schema

```typescript
{
    status: 200,
    message: "Successfully fetched contact details!",
    data: {
        fullName: string | null,
        firstName: string | null,
        lastName: string | null,
        nickname: string | null,
        isContact: boolean,          // IMHandle.isContact
        isBusiness: boolean | number, // may return 0/1 instead of bool
        personCentricID: string | null,
        cnContactID: string | null,
        isInAddressBook: boolean | number, // IMPerson.isInAddressBook
        allAddresses: string[]       // all phone numbers + emails from IMPerson
    }
}
```

### Verified Response (business handle)

```json
{
    "status": 200,
    "message": "Successfully fetched contact details!",
    "data": {
        "allAddresses": [],
        "firstName": null,
        "nickname": null,
        "isContact": false,
        "isBusiness": 1,
        "fullName": "Apple",
        "personCentricID": null,
        "cnContactID": null,
        "isInAddressBook": 0,
        "lastName": null
    }
}
```

### Error: Handle Not Found

```json
{
    "status": 500,
    "message": "Failed to fetch contact details!",
    "error": { "type": "Server Error", "message": "Handle not found" }
}
```

### Notes
- Tries iMessage account first, then SMS account
- Business/URN handles may not have an IMPerson (fields default to null)

---

## Endpoint 3: Get Contact Photo

```
GET /api/v1/contact/papi/handle/:address/photo?password=...
```

### Query Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `quality` | `"full"` \| `"thumbnail"` | `"full"` | `"thumbnail"` resizes to 150x150 PNG |

### Response Schema

```typescript
{
    status: 200,
    message: "Successfully fetched contact photo!",
    data: {
        address: string,
        photoData: string | null,    // base64-encoded image data, null if no photo
        quality: "full" | "thumbnail"
    }
}
```

### Verified Response (no photo available)

```json
{
    "status": 200,
    "message": "Successfully fetched contact photo!",
    "data": {
        "address": "urn:biz:b15ed773-9eed-11e7-baa2-7b88b04daa8e",
        "quality": "full",
        "photoData": null
    }
}
```

### Photo Resolution Order
1. `IMHandle.pictureData` (system contact photo)
2. `IMHandle.customPictureData` (shared/custom photo)
3. `IMPerson.imageData` (CNContact image)

### Notes
- Thumbnail: resized via NSImage + NSBitmapImageRep to 150x150 PNG
- `photoData` is null when no photo exists at any level
- To decode: `Buffer.from(photoData, 'base64')` or equivalent

---

## Endpoint 4: Batch Check iMessage Availability

```
POST /api/v1/contact/papi/imessage-status?password=...
Content-Type: application/json
```

### Request Body

```typescript
{
    addresses: string[]   // array of phone numbers or emails
}
```

### Response Schema

```typescript
{
    status: 200,
    message: "Successfully checked iMessage availability!",
    data: Record<string, number>  // { address: status }
}
```

### Status Values

| Value | Meaning |
|-------|---------|
| `1` | Available on iMessage |
| `0` | Not available on iMessage |

### Verified Response

Request:
```json
{"addresses": ["+11234567890"]}
```

Response:
```json
{
    "status": 200,
    "message": "Successfully checked iMessage availability!",
    "data": {
        "+11234567890": 1
    }
}
```

### Notes
- Addresses containing `@` are treated as email; all others as phone numbers
- Uses non-force-refresh IDS query; results may be slightly stale
- No per-address rate limit (single batch query to Apple's IDS service)

---

## Endpoint 5: Get Handle Siblings

```
GET /api/v1/contact/papi/handle/:address/siblings?password=...
```

### Response Schema

```typescript
{
    status: 200,
    message: "Successfully fetched handle siblings!",
    data: {
        personCentricID: string | null,  // Apple's cross-device person identifier
        siblings: Array<{
            handleId: string,
            service: string              // "iMessage" or "SMS"
        }>
    }
}
```

### Verified Response

```json
{
    "status": 200,
    "message": "Successfully fetched handle siblings!",
    "data": {
        "personCentricID": null,
        "siblings": [
            { "service": "iMessage", "handleId": "urn:biz:b15ed773-9eed-11e7-baa2-7b88b04daa8e" },
            { "service": "SMS", "handleId": "urn:biz:b15ed773-9eed-11e7-baa2-7b88b04daa8e" }
        ]
    }
}
```

### Notes
- Siblings = all handles (phone, email) belonging to the same person
- Uses `IMHandle.siblingsArray`
- A person with phone + email on iMessage + SMS could have 4 siblings

---

## Endpoint 6: Get Suggested Names

```
GET /api/v1/contact/papi/suggested-names?password=...
```

### Query Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `address` | `string` | _(none)_ | Optional: filter to one specific handle |

### Response Schema

```typescript
{
    status: 200,
    message: "Successfully fetched suggested names!",
    data: Array<{
        handleId: string,
        suggestedName: string
    }>
}
```

### Verified Response

```json
{
    "status": 200,
    "message": "Successfully fetched suggested names!",
    "data": [
        {
            "suggestedName": "Apple",
            "handleId": "urn:biz:b15ed773-9eed-11e7-baa2-7b88b04daa8e"
        }
    ]
}
```

### Notes
- Only returns handles where `IMHandle.hasSuggestedName == YES`
- Suggested names come from Siri intelligence (email signatures, message content)
- Without `address` filter, iterates ALL known handles (can be slow)

---

## Endpoint 7: Get Contact Availability

```
GET /api/v1/contact/papi/handle/:address/availability?password=...
```

### Response Schema

```typescript
{
    status: 200,
    message: "Successfully fetched contact availability!",
    data: {
        availability: number,
        availabilityDescription: string
    }
}
```

### Availability Values

| Value | Description | String |
|-------|-------------|--------|
| `0` | Available | `"available"` |
| `1` | Idle | `"idle"` |
| `2` | Do Not Disturb / Focus | `"do_not_disturb"` |
| `-1` | Manager not loaded | `"unavailable"` |
| other | Unknown status | `"unknown"` |

### Verified Response

```json
{
    "status": 200,
    "message": "Successfully fetched contact availability!",
    "data": {
        "availabilityDescription": "available",
        "availability": 0
    }
}
```

### Notes
- Uses `IMHandleAvailabilityManager.availabilityForHandle:`
- Falls back to `{availability: -1, availabilityDescription: "unavailable"}` if class not loaded
- May not reflect real-time Focus changes immediately

---

## Endpoint 8: Detect Business Contact

```
GET /api/v1/contact/papi/handle/:address/business?password=...
```

### Response Schema

```typescript
{
    status: 200,
    message: "Successfully detected business contact!",
    data: {
        address: string,
        isBusiness: boolean,      // flagged as business in iMessage
        isMako: boolean,          // Apple Business Chat (Mako) contact
        isApple: boolean,         // Apple corporate account
        businessName: string | null  // name from MapKit (if available)
    }
}
```

### Verified Response

```json
{
    "status": 200,
    "message": "Successfully detected business contact!",
    "data": {
        "isBusiness": true,
        "isMako": false,
        "isApple": true,
        "businessName": null,
        "address": "urn:biz:b15ed773-9eed-11e7-baa2-7b88b04daa8e"
    }
}
```

### Notes
- `isMako`, `isApple`, `mapItem` selectors may not exist on all macOS versions
- Falls back to `false` / `null` when selectors are missing

---

## Endpoint 9: Create Contact

```
POST /api/v1/contact/papi/create?password=...
Content-Type: application/json
```

### Request Body

```typescript
{
    firstName: string,       // required
    lastName?: string,       // optional
    phones?: string[],       // optional array of phone numbers
    emails?: string[]        // optional array of email addresses
}
```

### Response Schema

```typescript
{
    status: 200,
    message: "Successfully created contact!",
    data: {
        success: boolean,
        cnContactID: string | null,  // CNContact identifier for the new contact
        firstName: string,
        lastName: string | null
    }
}
```

### Verified Response

Request:
```json
{"firstName": "John", "lastName": "Doe", "phones": ["+11234567890"], "emails": ["john@example.com"]}
```

Response:
```json
{
    "status": 200,
    "message": "Successfully created contact!",
    "data": {
        "success": true,
        "cnContactID": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
        "firstName": "John",
        "lastName": "Doe"
    }
}
```

### Error: Missing firstName (400)

```json
{
    "status": 400,
    "message": "Bad Request",
    "error": { "type": "Validation Error", "message": "firstName is required!" }
}
```

### Notes
- Contact is saved to the default CNContactStore container
- Phones are added with label `CNLabelPhoneNumberMain`
- Emails are added with label `CNLabelHome`
- The returned `cnContactID` can be used for subsequent update/delete operations
- Uses the Contacts.framework via the helper bundle (Messages.app has Contacts TCC permission)

---

## Endpoint 10: Update Contact

```
POST /api/v1/contact/papi/update?password=...
Content-Type: application/json
```

### Request Body

```typescript
{
    cnContactID: string,     // required — the contact identifier from create or get-contact
    firstName?: string,      // optional — update first name
    lastName?: string,       // optional — update last name
    phones?: string[],       // optional — REPLACE all phone numbers
    emails?: string[]        // optional — REPLACE all email addresses
}
```

### Response Schema

```typescript
{
    status: 200,
    message: "Successfully updated contact!",
    data: {
        success: boolean,
        cnContactID: string,
        firstName: string | null,
        lastName: string | null
    }
}
```

### Verified Response

Request:
```json
{"cnContactID": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890", "firstName": "Jane", "lastName": "Smith"}
```

Response:
```json
{
    "status": 200,
    "message": "Successfully updated contact!",
    "data": {
        "success": true,
        "cnContactID": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
        "firstName": "Jane",
        "lastName": "Smith"
    }
}
```

### Error: Missing cnContactID (400)

```json
{
    "status": 400,
    "message": "Bad Request",
    "error": { "type": "Validation Error", "message": "cnContactID is required!" }
}
```

### Error: Contact Not Found (500)

```json
{
    "status": 500,
    "message": "Failed to update contact!",
    "error": { "type": "Server Error", "message": "Contact not found for ID: ..." }
}
```

### Notes
- Only provided fields are updated; omitted fields are left unchanged
- **Exception**: `phones` and `emails` arrays **replace** all existing values when provided (not appended)
- Fetches the existing contact by `cnContactID`, creates a mutable copy, applies changes, saves

---

## Endpoint 11: Delete Contact

```
POST /api/v1/contact/papi/delete?password=...
Content-Type: application/json
```

### Request Body

```typescript
{
    cnContactID: string   // required — the contact identifier
}
```

### Response Schema

```typescript
{
    status: 200,
    message: "Successfully deleted contact!",
    data: {
        success: boolean,
        cnContactID: string
    }
}
```

### Verified Response

Request:
```json
{"cnContactID": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"}
```

Response:
```json
{
    "status": 200,
    "message": "Successfully deleted contact!",
    "data": {
        "success": true,
        "cnContactID": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
    }
}
```

### Error: Missing cnContactID (400)

```json
{
    "status": 400,
    "message": "Bad Request",
    "error": { "type": "Validation Error", "message": "cnContactID is required!" }
}
```

### Error: Contact Not Found (500)

```json
{
    "status": 500,
    "message": "Failed to delete contact!",
    "error": { "type": "Server Error", "message": "Contact not found for ID: ..." }
}
```

### Notes
- Permanently deletes the contact from the system Contacts database
- This action cannot be undone
- The contact is removed from all groups it belongs to

---

## Error Responses

### Feature Flag Disabled (403)

```json
{
    "status": 403,
    "message": "You are forbidden from accessing this resource",
    "error": {
        "type": "Authentication Error",
        "message": "Contact Private API is not enabled! Enable it in the server settings."
    }
}
```

### Private API Helper Not Connected (500)

```json
{
    "status": 500,
    "message": "Failed to ...",
    "error": {
        "type": "Server Error",
        "message": "BlueBubblesHelper is not running! Please make sure you have the Private API enabled."
    }
}
```

### Transaction Timeout (500)

```json
{
    "status": 500,
    "message": "Failed to ...",
    "error": {
        "type": "Server Error",
        "message": "Transaction timeout"
    }
}
```

Timeout is 2 minutes. The `handles` endpoint with `includePhotos=true` on systems with many contacts may approach this limit.

### Wrong Password (401)

```json
{
    "status": 401,
    "message": "You are not authorized to access this resource",
    "error": {
        "type": "Authentication Error",
        "message": "You are not authorized to access this resource"
    }
}
```

---

## Integration Examples

### JavaScript/TypeScript (fetch)

```typescript
const BASE = "http://localhost:1234/api/v1/contact/papi";
const PASSWORD = "YOUR_PASSWORD";

// Check if someone is on iMessage
async function checkIMessage(addresses: string[]): Promise<Record<string, number>> {
    const res = await fetch(`${BASE}/imessage-status?password=${PASSWORD}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses })
    });
    const json = await res.json();
    return json.data;  // { "+11234567890": 1, "user@example.com": 0 }
}

// Get contact details
async function getContact(address: string) {
    const res = await fetch(`${BASE}/handle/${encodeURIComponent(address)}?password=${PASSWORD}`);
    const json = await res.json();
    return json.data;  // { fullName, firstName, lastName, ... }
}

// Get contact photo as base64
async function getPhoto(address: string, quality: "full" | "thumbnail" = "thumbnail") {
    const res = await fetch(`${BASE}/handle/${encodeURIComponent(address)}/photo?password=${PASSWORD}&quality=${quality}`);
    const json = await res.json();
    return json.data.photoData;  // base64 string or null
}

// Get all suggested names
async function getSuggestedNames() {
    const res = await fetch(`${BASE}/suggested-names?password=${PASSWORD}`);
    const json = await res.json();
    return json.data;  // [{ handleId, suggestedName }]
}

// Detect if business
async function isBusiness(address: string) {
    const res = await fetch(`${BASE}/handle/${encodeURIComponent(address)}/business?password=${PASSWORD}`);
    const json = await res.json();
    return json.data;  // { isBusiness, isMako, isApple, businessName }
}

// Create a contact
async function createContact(firstName: string, lastName?: string, phones?: string[], emails?: string[]) {
    const res = await fetch(`${BASE}/create?password=${PASSWORD}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, phones, emails })
    });
    const json = await res.json();
    return json.data;  // { success, cnContactID, firstName, lastName }
}

// Update a contact
async function updateContact(cnContactID: string, updates: { firstName?: string, lastName?: string, phones?: string[], emails?: string[] }) {
    const res = await fetch(`${BASE}/update?password=${PASSWORD}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnContactID, ...updates })
    });
    const json = await res.json();
    return json.data;  // { success, cnContactID, firstName, lastName }
}

// Delete a contact
async function deleteContact(cnContactID: string) {
    const res = await fetch(`${BASE}/delete?password=${PASSWORD}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnContactID })
    });
    const json = await res.json();
    return json.data;  // { success, cnContactID }
}
```

### Python (requests)

```python
import requests
from urllib.parse import quote

BASE = "http://localhost:1234/api/v1/contact/papi"
PASSWORD = "YOUR_PASSWORD"

def check_imessage(addresses: list[str]) -> dict[str, int]:
    r = requests.post(f"{BASE}/imessage-status", params={"password": PASSWORD},
                      json={"addresses": addresses})
    return r.json()["data"]

def get_contact(address: str) -> dict:
    r = requests.get(f"{BASE}/handle/{quote(address, safe='')}", params={"password": PASSWORD})
    return r.json()["data"]

def get_photo(address: str, quality: str = "thumbnail") -> str | None:
    r = requests.get(f"{BASE}/handle/{quote(address, safe='')}/photo",
                     params={"password": PASSWORD, "quality": quality})
    return r.json()["data"]["photoData"]

def get_siblings(address: str) -> dict:
    r = requests.get(f"{BASE}/handle/{quote(address, safe='')}/siblings",
                     params={"password": PASSWORD})
    return r.json()["data"]

def get_availability(address: str) -> dict:
    r = requests.get(f"{BASE}/handle/{quote(address, safe='')}/availability",
                     params={"password": PASSWORD})
    return r.json()["data"]

def create_contact(first_name: str, last_name: str = None, phones: list[str] = None, emails: list[str] = None) -> dict:
    r = requests.post(f"{BASE}/create", params={"password": PASSWORD},
                      json={"firstName": first_name, "lastName": last_name, "phones": phones, "emails": emails})
    return r.json()["data"]

def update_contact(cn_contact_id: str, **kwargs) -> dict:
    body = {"cnContactID": cn_contact_id, **kwargs}
    r = requests.post(f"{BASE}/update", params={"password": PASSWORD}, json=body)
    return r.json()["data"]

def delete_contact(cn_contact_id: str) -> dict:
    r = requests.post(f"{BASE}/delete", params={"password": PASSWORD},
                      json={"cnContactID": cn_contact_id})
    return r.json()["data"]
```

### Dart (BlueBubbles client pattern)

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class ContactPapiService {
  final String baseUrl;
  final String password;

  ContactPapiService({required this.baseUrl, required this.password});

  String _url(String path) => '$baseUrl/api/v1/contact/papi/$path?password=$password';

  Future<List<dynamic>> getHandles({bool includePhotos = false}) async {
    final res = await http.get(Uri.parse('${_url("handles")}&includePhotos=$includePhotos'));
    return jsonDecode(res.body)['data'] ?? [];
  }

  Future<Map<String, dynamic>?> getContact(String address) async {
    final res = await http.get(Uri.parse(_url('handle/${Uri.encodeComponent(address)}')));
    return jsonDecode(res.body)['data'];
  }

  Future<String?> getPhoto(String address, {String quality = 'thumbnail'}) async {
    final res = await http.get(
      Uri.parse('${_url("handle/${Uri.encodeComponent(address)}/photo")}&quality=$quality'));
    return jsonDecode(res.body)['data']?['photoData'];
  }

  Future<Map<String, int>> checkIMessage(List<String> addresses) async {
    final res = await http.post(
      Uri.parse(_url('imessage-status')),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'addresses': addresses}),
    );
    return Map<String, int>.from(jsonDecode(res.body)['data'] ?? {});
  }

  Future<Map<String, dynamic>?> detectBusiness(String address) async {
    final res = await http.get(
      Uri.parse(_url('handle/${Uri.encodeComponent(address)}/business')));
    return jsonDecode(res.body)['data'];
  }

  Future<Map<String, dynamic>?> createContact(String firstName, {String? lastName, List<String>? phones, List<String>? emails}) async {
    final res = await http.post(
      Uri.parse(_url('create')),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'firstName': firstName, 'lastName': lastName, 'phones': phones, 'emails': emails}),
    );
    return jsonDecode(res.body)['data'];
  }

  Future<Map<String, dynamic>?> updateContact(String cnContactID, {String? firstName, String? lastName, List<String>? phones, List<String>? emails}) async {
    final body = <String, dynamic>{'cnContactID': cnContactID};
    if (firstName != null) body['firstName'] = firstName;
    if (lastName != null) body['lastName'] = lastName;
    if (phones != null) body['phones'] = phones;
    if (emails != null) body['emails'] = emails;
    final res = await http.post(
      Uri.parse(_url('update')),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    return jsonDecode(res.body)['data'];
  }

  Future<Map<String, dynamic>?> deleteContact(String cnContactID) async {
    final res = await http.post(
      Uri.parse(_url('delete')),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'cnContactID': cnContactID}),
    );
    return jsonDecode(res.body)['data'];
  }
}
```

---

## Source Files

| File | Purpose |
|------|---------|
| `packages/server/src/server/api/lib/contacts/types.ts` | TypeScript interfaces for all response types |
| `packages/server/src/server/api/privateApi/apis/PrivateApiContacts.ts` | 11 methods extending PrivateApiAction, creates TransactionPromise(CONTACT) |
| `packages/server/src/server/api/interfaces/contactPrivateApiInterface.ts` | Feature flag check + Private API status check + data extraction |
| `packages/server/src/server/api/http/api/v1/routers/contactPrivateApiRouter.ts` | HTTP route handlers (parse params, call interface, return Success/ServerError) |
| `packages/server/src/server/api/http/api/v1/httpRoutes.ts` | Route registration under prefix `contact/papi` with PrivateApiMiddleware |
| `packages/server/src/server/api/privateApi/PrivateApiService.ts` | `contacts` getter exposes PrivateApiContacts |
| `packages/server/src/server/managers/transactionManager/transactionPromise.ts` | TransactionType.CONTACT enum value |
| `packages/server/src/server/databases/server/constants.ts` | `enable_contacts_private_api` feature flag default |
| `bluebubbles-helper/Messages/MacOS-11+/BlueBubblesHelper/BlueBubblesHelper.m` | 11 Obj-C action handlers (8 read + 3 write using IMCore + Contacts.framework) |

## Limitations

1. **Address format**: Must match exact iMessage format (`+11234567890`, not `(123) 456-7890`)
2. **Transaction timeout**: 2 minutes per request; `handles` with `includePhotos=true` may approach this on large contact lists
3. **Batch iMessage check**: Uses non-force IDS query; results may be slightly stale
4. **Availability**: `IMHandleAvailabilityManager` may not be loaded on all macOS versions; returns `-1`
5. **Business detection**: `isMako`, `isApple`, `mapItem` selectors may not exist on older macOS; defaults to `false`/`null`
6. **Photo size**: Base64 photos can be large; use `quality=thumbnail` (150x150 PNG) when possible
7. **Helper required**: All endpoints fail if the Private API helper bundle is not connected to Messages.app
8. **Contact writes are permanent**: Create/update/delete operate on the system Contacts database (CNContactStore); deletions cannot be undone
9. **Phone/email replacement**: When updating a contact with `phones` or `emails`, all existing values are **replaced**, not appended
10. **Contacts.framework TCC**: The helper bundle inherits Messages.app's Contacts permission; no additional TCC grant needed
