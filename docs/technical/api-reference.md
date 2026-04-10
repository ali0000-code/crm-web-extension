# API Reference

All API endpoints are prefixed with `/api`. All protected routes require:

```
Authorization: Bearer {sanctum_token}
Content-Type: application/json
Accept: application/json
```

Rate limiting applies to all endpoints:
- **`throttle:auth`** — stricter limit on authentication routes
- **`throttle:api`** — standard limit on data routes

---

## Health Check

### GET /api/health

Public. No authentication required.

**Response 200:**
```json
{
  "status": "ok",
  "timestamp": "2026-04-10T12:00:00+00:00",
  "version": "2.0.0"
}
```

---

## Authentication

### POST /api/auth/register

Register a new user account.

**Public** — `throttle:auth`

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass1!",
  "password_confirmation": "SecurePass1!"
}
```

**Validation:**
- `password` — min 8 characters, must contain uppercase, lowercase, and a number

**Response 201:**
```json
{
  "user": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "token": "sanctum_token_string"
}
```

---

### POST /api/auth/login

Authenticate with email and password. Issues a `web-token`.

**Public** — `throttle:auth`

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "SecurePass1!"
}
```

**Response 200:**
```json
{
  "user": { "id": "uuid", "name": "John Doe", "email": "john@example.com" },
  "token": "sanctum_token_string"
}
```

**Response 422** — Invalid credentials.

---

### POST /api/auth/extension-login

Authenticate the browser extension using the user's Auth Key. Issues a device-specific token. Enforces device limit.

**Public** — `throttle:auth`

**Request Body:**
```json
{
  "auth_key": "48-character-random-string",
  "device_fingerprint": "unique-device-hash",
  "browser_info": "Chrome 124",
  "os_info": "macOS 14",
  "ip_address": "192.168.1.1",
  "screen_resolution": "1920x1080",
  "language": "en-US"
}
```

**Response 200:**
```json
{
  "token": "sanctum_token_string",
  "device_id": "uuid",
  "user": { "id": "uuid", "name": "John Doe", "email": "john@example.com" }
}
```

**Response 403** — Device limit reached (max 4 active devices).  
**Response 401** — Invalid auth key.

---

### POST /api/auth/logout

Revoke the current token.

**Protected**

**Response 200:**
```json
{ "message": "Logged out successfully" }
```

---

### GET /api/auth/me

Get the currently authenticated user's profile.

**Protected**

**Response 200:**
```json
{
  "id": "uuid",
  "name": "John Doe",
  "email": "john@example.com",
  "created_at": "2026-01-01T00:00:00Z"
}
```

---

### PUT /api/auth/profile

Update name and/or email.

**Protected**

**Request Body:**
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com"
}
```

**Response 200:**
```json
{
  "user": { "id": "uuid", "name": "Jane Doe", "email": "jane@example.com" }
}
```

---

### POST /api/auth/change-password

Change the user's password.

**Protected** — `throttle:auth`

**Request Body:**
```json
{
  "current_password": "OldPass1!",
  "password": "NewPass1!",
  "password_confirmation": "NewPass1!"
}
```

**Response 200:**
```json
{ "message": "Password changed successfully" }
```

---

### POST /api/auth/regenerate-token

Revoke all current tokens and issue a new one.

**Protected** — `throttle:auth`

**Response 200:**
```json
{ "token": "new_sanctum_token_string" }
```

---

### POST /api/auth/regenerate-auth-key

Generate a new 48-character Auth Key (invalidates the old one).

**Protected** — `throttle:auth`

**Response 200:**
```json
{ "message": "Auth key regenerated successfully" }
```

---

### GET /api/auth/token-info

Get information about the current token.

**Protected**

**Response 200:**
```json
{
  "name": "extension-uuid",
  "created_at": "2026-04-01T10:00:00Z",
  "last_used_at": "2026-04-10T08:00:00Z"
}
```

---

### POST /api/auth/reveal-auth-key

Return the user's plaintext Auth Key. Requires password confirmation.

**Protected** — `throttle:auth`

**Request Body:**
```json
{ "password": "SecurePass1!" }
```

**Response 200:**
```json
{ "auth_key": "48-character-random-string" }
```

---

### POST /api/auth/register-device

Register a new device and issue a device-specific token. Enforces device limit.

**Protected** — `throttle:auth`

**Request Body:**
```json
{
  "device_fingerprint": "unique-device-hash",
  "browser_info": "Chrome 124",
  "os_info": "macOS 14"
}
```

**Response 201:**
```json
{
  "token": "sanctum_token_string",
  "device_id": "uuid"
}
```

---

## Devices

### GET /api/devices

List all devices registered by the current user.

**Protected** — `throttle:api`

**Response 200:**
```json
[
  {
    "id": "uuid",
    "device_fingerprint": "hash",
    "browser_info": "Chrome 124",
    "os_info": "macOS 14",
    "ip_address": "192.168.1.1",
    "is_active": true,
    "last_active": "2026-04-10T08:00:00Z",
    "created_at": "2026-01-01T00:00:00Z"
  }
]
```

---

### GET /api/devices/stats

Get device statistics for the current user.

**Protected** — `throttle:api`

**Response 200:**
```json
{
  "total": 3,
  "active": 2,
  "revoked": 1,
  "limit": 4
}
```

---

### POST /api/devices/validate

Check if a device fingerprint is registered and active.

**Protected** — `throttle:api`

**Request Body:**
```json
{ "device_fingerprint": "unique-device-hash" }
```

**Response 200:**
```json
{ "valid": true, "device_id": "uuid" }
```

---

### POST /api/devices/revoke-multiple

Revoke multiple devices by ID.

**Protected** — `throttle:api`

**Request Body:**
```json
{ "device_ids": ["uuid1", "uuid2"] }
```

**Response 200:**
```json
{ "revoked": 2 }
```

---

### DELETE /api/devices/{deviceId}

Revoke a single device. The device's associated token is also invalidated.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "message": "Device revoked" }
```

---

## Facebook Accounts

### GET /api/facebook-accounts

List all Facebook accounts linked to the current user.

**Protected** — `throttle:api`

**Response 200:**
```json
[
  {
    "id": "uuid",
    "facebook_user_id": "123456789",
    "account_name": "John Doe",
    "profile_url": "https://facebook.com/johndoe",
    "profile_picture": "https://...",
    "last_used": "2026-04-10T08:00:00Z"
  }
]
```

---

### GET /api/facebook-accounts/stats

Get account statistics.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "total": 2 }
```

---

### POST /api/facebook-accounts

Link a Facebook account to the current user.

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "facebook_user_id": "123456789",
  "account_name": "John Doe",
  "profile_url": "https://facebook.com/johndoe",
  "profile_picture": "https://..."
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "facebook_user_id": "123456789",
  "account_name": "John Doe"
}
```

---

### POST /api/facebook-accounts/validate

Validate a Facebook account is properly linked.

**Protected** — `throttle:api`

**Request Body:**
```json
{ "facebook_user_id": "123456789" }
```

**Response 200:**
```json
{ "valid": true, "account": { ... } }
```

---

### DELETE /api/facebook-accounts/{accountId}

Unlink a Facebook account.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "message": "Account unlinked" }
```

---

## Notes

### GET /api/notes/contacts/all

Get all contacts that have at least one note, sorted by most recently noted.

**Protected** — `throttle:api`

**Response 200:**
```json
[
  {
    "id": "uuid",
    "contact_user_id": "fb_user_id",
    "contact_name": "Jane Smith",
    "profile_picture": "https://...",
    "note_count": 3,
    "last_note_at": "2026-04-09T15:00:00Z"
  }
]
```

---

### GET /api/notes/{contactUserId}

Get all notes for a specific contact (identified by their Facebook user ID).

**Protected** — `throttle:api`

**Response 200:**
```json
{
  "contact": {
    "contact_user_id": "fb_user_id",
    "contact_name": "Jane Smith",
    "profile_picture": "https://..."
  },
  "notes": [
    {
      "id": "uuid",
      "text": "Called today, interested in product",
      "created_at": "2026-04-09T15:00:00Z",
      "updated_at": "2026-04-09T15:00:00Z"
    }
  ]
}
```

---

### POST /api/notes

Create a new note for a contact.

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "contact_user_id": "fb_user_id",
  "contact_name": "Jane Smith",
  "profile_picture": "https://...",
  "text": "Called today, very interested"
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "text": "Called today, very interested",
  "created_at": "2026-04-10T10:00:00Z"
}
```

---

### PUT /api/notes/{contactUserId}/{noteId}

Update an existing note.

**Protected** — `throttle:api`

**Request Body:**
```json
{ "text": "Updated note text" }
```

**Response 200:**
```json
{
  "id": "uuid",
  "text": "Updated note text",
  "updated_at": "2026-04-10T10:05:00Z"
}
```

---

### DELETE /api/notes/{contactUserId}/{noteId}

Delete a note.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "message": "Note deleted" }
```

---

## Tags

### GET /api/tags

List all tags for the current user.

**Protected** — `throttle:api`

**Response 200:**
```json
[
  {
    "id": "tag_abc123",
    "name": "Hot Lead",
    "color": "#e53935",
    "created_at": "2026-01-01T00:00:00Z"
  }
]
```

---

### POST /api/tags

Create a new tag.

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "id": "tag_abc123",
  "name": "Hot Lead",
  "color": "#e53935"
}
```

**Response 201:** Returns the created tag object.

**Response 422** — Tag name already exists for this user.

---

### DELETE /api/tags/{id}

Delete a tag. Also removes it from all contacts.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "message": "Tag deleted" }
```

---

### POST /api/tags/bulk-delete

Delete multiple tags.

**Protected** — `throttle:api`

**Request Body:**
```json
{ "ids": ["tag_abc123", "tag_def456"] }
```

**Response 200:**
```json
{ "deleted": 2 }
```

---

### POST /api/tags/sync

Sync tags from the extension. Upserts all provided tags (create or update).

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "tags": [
    { "id": "tag_abc123", "name": "Hot Lead", "color": "#e53935" }
  ]
}
```

**Response 200:**
```json
{ "synced": 1 }
```

---

## Contacts

### GET /api/contacts

List all contacts for the current user, with their assigned tags.

**Protected** — `throttle:api`

**Response 200:**
```json
[
  {
    "id": "contact_xyz789",
    "name": "Jane Smith",
    "facebook_user_id": "987654321",
    "profile_picture": "https://...",
    "source": "messenger",
    "group_id": null,
    "tags": [
      { "id": "tag_abc123", "name": "Hot Lead", "color": "#e53935" }
    ],
    "created_at": "2026-01-15T00:00:00Z"
  }
]
```

---

### POST /api/contacts

Create a single contact.

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "id": "contact_xyz789",
  "name": "Jane Smith",
  "facebook_user_id": "987654321",
  "profile_picture": "https://...",
  "source": "messenger"
}
```

**Response 201:** Returns the created contact object.

---

### PUT /api/contacts/{id}

Update a contact.

**Protected** — `throttle:api`

**Request Body:** Any subset of contact fields.

**Response 200:** Returns the updated contact object.

---

### POST /api/contacts/bulk-delete

Delete multiple contacts.

**Protected** — `throttle:api`

**Request Body:**
```json
{ "ids": ["contact_xyz789", "contact_abc123"] }
```

**Response 200:**
```json
{ "deleted": 2 }
```

---

### POST /api/contacts/bulk-tag

Add one or more tags to multiple contacts.

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "contact_ids": ["contact_xyz789"],
  "tag_ids": ["tag_abc123", "tag_def456"]
}
```

**Response 200:**
```json
{ "updated": 1 }
```

---

### POST /api/contacts/sync

Sync contacts from the extension. Upserts all provided contacts and their tag assignments.

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "contacts": [
    {
      "id": "contact_xyz789",
      "name": "Jane Smith",
      "facebook_user_id": "987654321",
      "profile_picture": "https://...",
      "tags": ["tag_abc123"]
    }
  ]
}
```

**Response 200:**
```json
{ "synced": 1 }
```

---

### POST /api/contacts/{id}/tags/{tagId}

Add a single tag to a contact.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "message": "Tag added" }
```

---

### DELETE /api/contacts/{id}/tags/{tagId}

Remove a single tag from a contact.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "message": "Tag removed" }
```

---

## Templates

### GET /api/templates

List all message templates for the current user.

**Protected** — `throttle:api`

**Response 200:**
```json
[
  {
    "id": "tmpl_abc123",
    "name": "Initial Outreach",
    "body": "Hi {name}, I wanted to reach out about...",
    "created_at": "2026-01-01T00:00:00Z"
  }
]
```

---

### POST /api/templates

Create a new template.

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "id": "tmpl_abc123",
  "name": "Initial Outreach",
  "body": "Hi {name}, I wanted to reach out about..."
}
```

**Response 201:** Returns the created template object.

---

### DELETE /api/templates/{id}

Delete a template.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "message": "Template deleted" }
```

---

### POST /api/templates/bulk-delete

Delete multiple templates.

**Protected** — `throttle:api`

**Request Body:**
```json
{ "ids": ["tmpl_abc123"] }
```

**Response 200:**
```json
{ "deleted": 1 }
```

---

### POST /api/templates/sync

Sync templates from the extension. Upserts all provided templates.

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "templates": [
    { "id": "tmpl_abc123", "name": "Initial Outreach", "body": "Hi..." }
  ]
}
```

**Response 200:**
```json
{ "synced": 1 }
```

---

## Campaigns

### GET /api/campaigns

List all campaigns for the current user.

**Protected** — `throttle:api`

**Response 200:**
```json
[
  {
    "id": "camp_abc123",
    "name": "April Outreach",
    "message": "Hi, wanted to connect...",
    "delay": 15,
    "status": "completed",
    "total_recipients": 50,
    "success_count": 47,
    "failure_count": 3,
    "current_index": 50,
    "started_at": "2026-04-01T10:00:00Z",
    "completed_at": "2026-04-01T12:30:00Z"
  }
]
```

---

### GET /api/campaigns/stats

Get aggregate campaign statistics.

**Protected** — `throttle:api`

**Response 200:**
```json
{
  "total": 10,
  "pending": 2,
  "active": 1,
  "completed": 7,
  "total_sent": 450,
  "total_failed": 12
}
```

---

### GET /api/campaigns/active

Get currently active campaigns (status = `started` or `resumed`).

**Protected** — `throttle:api`

**Response 200:** Array of campaign objects.

---

### POST /api/campaigns

Create a new campaign.

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "id": "camp_abc123",
  "name": "April Outreach",
  "message": "Hi, wanted to connect...",
  "delay": 15,
  "recipient_contact_ids": ["contact_xyz789"],
  "selected_tag_ids": ["tag_abc123"]
}
```

**Response 201:** Returns the created campaign object.

---

### PUT /api/campaigns/{id}

Update campaign details (name, message, delay, recipients).

**Protected** — `throttle:api`

**Request Body:** Any subset of campaign fields.

**Response 200:** Returns the updated campaign object.

---

### DELETE /api/campaigns/{id}

Delete a campaign.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "message": "Campaign deleted" }
```

---

### POST /api/campaigns/bulk-delete

Delete multiple campaigns.

**Protected** — `throttle:api`

**Request Body:**
```json
{ "ids": ["camp_abc123"] }
```

**Response 200:**
```json
{ "deleted": 1 }
```

---

### POST /api/campaigns/{id}/start

Mark a campaign as started. Sets `started_at` timestamp.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "status": "started", "started_at": "2026-04-10T10:00:00Z" }
```

---

### POST /api/campaigns/{id}/pause

Pause an active campaign.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "status": "paused" }
```

---

### POST /api/campaigns/{id}/resume

Resume a paused campaign.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "status": "resumed" }
```

---

### POST /api/campaigns/{id}/complete

Mark a campaign as completed. Sets `completed_at` timestamp.

**Protected** — `throttle:api`

**Response 200:**
```json
{ "status": "completed", "completed_at": "2026-04-10T12:30:00Z" }
```

---

### PUT /api/campaigns/{id}/progress

Update campaign execution progress (called by extension during bulk send).

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "current_index": 25,
  "success_count": 23,
  "failure_count": 2,
  "errors": [
    { "contact_id": "contact_xyz", "error": "Tab not found" }
  ]
}
```

**Response 200:** Returns updated campaign object.

---

## Friend Requests

### GET /api/friend-requests

List all tracked friend requests for the current user.

**Protected** — `throttle:api`

**Response 200:**
```json
[
  {
    "id": "fr_abc123",
    "facebook_user_id": "987654321",
    "name": "Jane Smith",
    "profile_picture": "https://...",
    "group_id": "group_xyz",
    "status": "pending",
    "sent_at": "2026-04-05T10:00:00Z",
    "responded_at": null,
    "last_checked": "2026-04-10T08:00:00Z"
  }
]
```

---

### POST /api/friend-requests/sync

Sync friend requests from the extension. Upserts all provided requests.

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "friend_requests": [
    {
      "id": "fr_abc123",
      "facebook_user_id": "987654321",
      "name": "Jane Smith",
      "status": "pending",
      "sent_at": "2026-04-05T10:00:00Z"
    }
  ]
}
```

**Response 200:**
```json
{ "synced": 1 }
```

---

### PUT /api/friend-requests/{id}

Update a single friend request (e.g., status change).

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "status": "accepted",
  "responded_at": "2026-04-10T09:00:00Z"
}
```

**Response 200:** Returns updated friend request object.

---

### POST /api/friend-requests/bulk-update-status

Update the status of multiple friend requests at once.

**Protected** — `throttle:api`

**Request Body:**
```json
{
  "updates": [
    { "id": "fr_abc123", "status": "accepted", "responded_at": "2026-04-10T09:00:00Z" },
    { "id": "fr_def456", "status": "pending", "last_checked": "2026-04-10T09:00:00Z" }
  ]
}
```

**Response 200:**
```json
{ "updated": 2 }
```

---

## Polling

### GET /api/poll

Fallback polling endpoint. Returns any pending data updates for the authenticated user. Used when the WebSocket connection is unavailable.

**Protected** — `throttle:api`

**Response 200:**
```json
{
  "tags": [...],
  "contacts": [...],
  "templates": [...],
  "campaigns": [...],
  "friend_requests": [...]
}
```

---

## Error Responses

All endpoints return standard error shapes:

**400 Bad Request:**
```json
{ "message": "Bad request description" }
```

**401 Unauthorized:**
```json
{ "message": "Unauthenticated." }
```

**403 Forbidden:**
```json
{ "message": "This action is unauthorized." }
```

**422 Unprocessable Entity:**
```json
{
  "message": "The name field is required.",
  "errors": {
    "name": ["The name field is required."]
  }
}
```

**429 Too Many Requests:**
```json
{ "message": "Too Many Attempts." }
```

**500 Internal Server Error:**
```json
{ "message": "Server Error" }
```
