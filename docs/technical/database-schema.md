# Database Schema

All tables use either UUID or string primary keys. All user-owned tables have a `user_id` foreign key referencing `users.id` with `CASCADE ON DELETE`, meaning all user data is automatically removed when a user is deleted.

---

## users

Stores registered user accounts.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | No | — | Primary key |
| `name` | varchar(255) | No | — | Display name |
| `email` | varchar(255) | No | — | Unique |
| `password` | varchar(255) | No | — | Bcrypt hashed |
| `auth_key` | varchar(255) | Yes | null | 48-char random key for extension authentication |
| `email_verified_at` | timestamp | Yes | null | — |
| `remember_token` | varchar(100) | Yes | null | Session remember token |
| `created_at` | timestamp | Yes | null | — |
| `updated_at` | timestamp | Yes | null | — |

**Indexes:**
- `PRIMARY KEY (id)`
- `UNIQUE (email)`

---

## devices

Each registered browser extension instance. Tokens are tied to devices.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | No | — | Primary key |
| `user_id` | uuid | No | — | FK → users.id |
| `device_fingerprint` | varchar(255) | No | — | Unique hash identifying the browser |
| `device_info` | text | Yes | null | JSON: screen resolution, language, etc. |
| `browser_info` | varchar(255) | Yes | null | Browser name and version |
| `os_info` | varchar(255) | Yes | null | Operating system |
| `ip_address` | varchar(45) | Yes | null | IPv4 or IPv6 |
| `last_active` | timestamp | No | CURRENT_TIMESTAMP | Updated on each API call |
| `created_at` | timestamp | No | CURRENT_TIMESTAMP | — |
| `revoked_at` | timestamp | Yes | null | Set when device is revoked |
| `is_active` | boolean | No | true | false after revocation |

**Indexes:**
- `PRIMARY KEY (id)`
- `UNIQUE (user_id, device_fingerprint)`
- `INDEX (device_fingerprint)`
- `INDEX (user_id, is_active)`
- `INDEX (last_active)`

---

## facebook_accounts

Facebook accounts linked to CRM users.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | No | — | Primary key |
| `user_id` | uuid | No | — | FK → users.id |
| `facebook_user_id` | varchar(255) | No | — | Facebook numeric user ID |
| `account_name` | varchar(255) | No | — | Facebook display name |
| `profile_url` | varchar(255) | Yes | null | Full Facebook profile URL |
| `profile_picture` | varchar(255) | Yes | null | Profile picture URL |
| `last_used` | timestamp | Yes | null | Last time this account was used |
| `created_at` | timestamp | Yes | null | — |
| `updated_at` | timestamp | Yes | null | — |

**Indexes:**
- `PRIMARY KEY (id)`
- `UNIQUE (user_id, facebook_user_id)`
- `INDEX (facebook_user_id)`
- `INDEX (user_id)`

---

## tags

User-defined colored labels for organizing contacts.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | varchar(100) | No | — | Primary key (client-generated string ID) |
| `user_id` | uuid | No | — | FK → users.id |
| `name` | varchar(200) | No | — | Tag display name |
| `color` | varchar(20) | No | `#3f51b5` | Hex color code |
| `created_at` | timestamp | Yes | null | — |
| `updated_at` | timestamp | Yes | null | — |

**Indexes:**
- `PRIMARY KEY (id)`
- `UNIQUE (user_id, name)` — tag names are unique per user
- `INDEX (user_id)`

---

## contacts

CRM contacts, typically sourced from Facebook Messenger or Groups.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | varchar(100) | No | — | Primary key (client-generated string ID) |
| `user_id` | uuid | No | — | FK → users.id |
| `name` | varchar(200) | No | — | Contact display name |
| `profile_picture` | varchar(500) | Yes | null | Profile picture URL (text on some versions) |
| `facebook_user_id` | varchar(200) | Yes | null | Facebook numeric user ID |
| `source` | varchar(50) | Yes | null | Where contact was added: `messenger`, `groups`, etc. |
| `group_id` | varchar(200) | Yes | null | Facebook Group ID if sourced from a group |
| `created_at` | timestamp | Yes | null | — |
| `updated_at` | timestamp | Yes | null | — |

**Indexes:**
- `PRIMARY KEY (id)`
- `INDEX (user_id)`

---

## contact_tag

Pivot table for the many-to-many relationship between contacts and tags.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `contact_id` | varchar(100) | No | FK → contacts.id, CASCADE DELETE |
| `tag_id` | varchar(100) | No | FK → tags.id, CASCADE DELETE |

**Indexes:**
- `PRIMARY KEY (contact_id, tag_id)`

---

## templates

Reusable message templates for bulk campaigns.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | varchar(100) | No | — | Primary key (client-generated string ID) |
| `user_id` | uuid | No | — | FK → users.id |
| `name` | varchar(200) | No | — | Template display name |
| `body` | text | No | — | Template message content |
| `created_at` | timestamp | Yes | null | — |
| `updated_at` | timestamp | Yes | null | — |

**Indexes:**
- `PRIMARY KEY (id)`
- `INDEX (user_id)`

---

## campaigns

Bulk message campaigns. Tracks execution state and progress.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | varchar(100) | No | — | Primary key (client-generated string ID) |
| `user_id` | uuid | No | — | FK → users.id |
| `name` | varchar(200) | No | — | Campaign name |
| `message` | text | No | — | Message body to send |
| `delay` | integer | No | 10 | Seconds between each message |
| `status` | varchar(20) | No | `pending` | `pending`, `started`, `paused`, `resumed`, `completed` |
| `recipient_contact_ids` | json | Yes | null | Explicit list of contact IDs |
| `selected_tag_ids` | json | Yes | null | Tag IDs — recipients are all contacts with these tags |
| `errors` | json | Yes | null | Array of failed send records |
| `total_recipients` | integer | No | 0 | Total number of targets |
| `success_count` | integer | No | 0 | Successfully sent messages |
| `failure_count` | integer | No | 0 | Failed sends |
| `current_index` | integer | No | 0 | Current position in the recipient list |
| `started_at` | timestamp | Yes | null | When execution started |
| `completed_at` | timestamp | Yes | null | When execution finished |
| `created_at` | timestamp | Yes | null | — |
| `updated_at` | timestamp | Yes | null | — |

**Campaign Status Lifecycle:**
```
pending → started → paused → resumed → completed
                           └──────────────────────→ completed
```

**Indexes:**
- `PRIMARY KEY (id)`
- `INDEX (user_id)`
- `INDEX (status)`

---

## friend_requests

Outgoing Facebook friend requests tracked by the extension.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | varchar(100) | No | — | Primary key (client-generated string ID) |
| `user_id` | uuid | No | — | FK → users.id |
| `facebook_user_id` | varchar(200) | No | — | Facebook user ID of request target |
| `name` | varchar(200) | No | — | Target's name |
| `profile_picture` | varchar(500) | Yes | null | Target's profile picture URL |
| `group_id` | varchar(200) | Yes | null | Group they were found in |
| `status` | varchar(20) | No | `pending` | `pending`, `accepted`, `declined` |
| `sent_at` | timestamp | Yes | null | When the request was sent |
| `responded_at` | timestamp | Yes | null | When they accepted/declined |
| `last_checked` | timestamp | Yes | null | Last time status was checked |
| `verification_method` | varchar(100) | Yes | null | How status was verified |
| `friends_list_name` | varchar(200) | Yes | null | Their position in friends list |
| `created_at` | timestamp | Yes | null | — |
| `updated_at` | timestamp | Yes | null | — |

**Indexes:**
- `PRIMARY KEY (id)`
- `UNIQUE (user_id, facebook_user_id)` — prevents duplicate tracking
- `INDEX (user_id)`

---

## contact_notes

Metadata container for notes per Facebook contact. One row per (user, contact) pair.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | No | — | Primary key |
| `user_id` | uuid | No | — | FK → users.id |
| `contact_user_id` | varchar(200) | No | — | Facebook user ID of the contact |
| `contact_name` | varchar(200) | No | `Unknown` | Contact's display name |
| `profile_picture` | text | Yes | null | Contact's profile picture URL |
| `note_count` | integer (unsigned) | No | 0 | Denormalized count of notes |
| `last_note_at` | timestamp | Yes | null | Timestamp of most recent note |
| `created_at` | timestamp | Yes | null | — |
| `updated_at` | timestamp | Yes | null | — |

**Indexes:**
- `PRIMARY KEY (id)`
- `UNIQUE (user_id, contact_user_id)`
- `INDEX (user_id)`

---

## notes

Individual note entries attached to a contact.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | No | — | Primary key |
| `contact_note_id` | uuid | No | — | FK → contact_notes.id, CASCADE DELETE |
| `user_id` | uuid | No | — | FK → users.id (denormalized for query performance) |
| `text` | text | No | — | Note content |
| `contact_name` | varchar(200) | No | `Unknown` | Denormalized contact name |
| `created_at` | timestamp | Yes | null | — |
| `updated_at` | timestamp | Yes | null | — |

**Indexes:**
- `PRIMARY KEY (id)`
- `INDEX (contact_note_id)`
- `INDEX (user_id)`
- `INDEX (created_at)`

---

## personal_access_tokens

Sanctum's token table. Managed automatically by Laravel Sanctum.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint | Primary key |
| `tokenable_type` | varchar | Polymorphic model type |
| `tokenable_id` | varchar | Model ID (user UUID) |
| `name` | varchar | Token name: `web-token` or `extension-{deviceId}` |
| `token` | varchar(64) | SHA-256 hashed token |
| `abilities` | text | JSON array of abilities |
| `last_used_at` | timestamp | — |
| `expires_at` | timestamp | Optional expiry |
| `created_at` | timestamp | — |
| `updated_at` | timestamp | — |

---

## token_usage_logs

Audit log for API token usage.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK → users.id |
| `token_name` | varchar | Name of the token used |
| `endpoint` | varchar | API endpoint accessed |
| `method` | varchar | HTTP method |
| `ip_address` | varchar | Request IP |
| `created_at` | timestamp | — |

---

## sessions

PHP session storage (used for web dashboard sessions).

| Column | Type | Notes |
|---|---|---|
| `id` | varchar | Primary key |
| `user_id` | varchar(36) | Nullable, indexed |
| `ip_address` | varchar(45) | — |
| `user_agent` | text | — |
| `payload` | longtext | Serialized session data |
| `last_activity` | integer | Unix timestamp, indexed |

---

## Entity Relationship Diagram

```
users (uuid)
  │
  ├──[1:N]──► devices (uuid)
  │
  ├──[1:N]──► facebook_accounts (uuid)
  │
  ├──[1:N]──► tags (string)
  │                │
  │                └──[M:N via contact_tag]──► contacts (string)
  │
  ├──[1:N]──► contacts (string)
  │
  ├──[1:N]──► templates (string)
  │
  ├──[1:N]──► campaigns (string)
  │
  ├──[1:N]──► friend_requests (string)
  │
  ├──[1:N]──► contact_notes (uuid)
  │                │
  │                └──[1:N]──► notes (uuid)
  │
  └──[1:N]──► token_usage_logs (uuid)
```
