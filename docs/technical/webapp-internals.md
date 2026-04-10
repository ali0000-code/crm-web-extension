# Webapp Internals

## Overview

The CRM web application is built on **Laravel 13** with an **Alpine.js** single-page frontend. It provides the persistent data store, REST API, real-time WebSocket broadcasting, and a management dashboard for all CRM data. This document covers the backend architecture, frontend structure, and key subsystems.

---

## Directory Structure

```
crm-webapp/
├── app/
│   ├── Http/
│   │   ├── Controllers/        # Request handlers
│   │   ├── Middleware/         # Request pipeline filters
│   │   └── Requests/           # Form request validation
│   ├── Models/                 # Eloquent models
│   └── Services/               # Business logic services
├── config/                     # Laravel configuration files
├── database/
│   └── migrations/             # Database schema definitions
├── resources/
│   ├── js/                     # Alpine.js frontend code
│   │   ├── app.js              # Entry point
│   │   ├── api.js              # HTTP client
│   │   ├── extension.js        # Extension message bridge
│   │   ├── echo-setup.js       # WebSocket setup
│   │   ├── theme.js            # Dark/light/system theme
│   │   └── stores/             # Alpine reactive stores
│   └── views/
│       ├── dashboard.blade.php # Main shell layout
│       └── views/              # Per-page Blade templates
├── routes/
│   ├── api.php                 # REST API routes
│   └── web.php                 # Web and auth routes
└── public/                     # Publicly served files
```

---

## Backend Architecture

### Laravel Controllers

Each resource has a dedicated controller following standard REST conventions:

| Controller | Resource | Key Methods |
|---|---|---|
| `AuthController` | User auth, devices, tokens | register, login, extensionLogin, logout, me, updateProfile, changePassword, regenerateToken, regenerateAuthKey, revealAuthKey, registerDevice, tokenInfo |
| `WebAuthController` | Web session auth | showLogin, showRegister, login, register, logout |
| `ContactController` | Contacts | index, store, update, bulkDelete, bulkTag, sync, addTag, removeTag |
| `TagController` | Tags | index, store, destroy, bulkDelete, sync |
| `NoteController` | Notes | contactsWithNotes, index, store, update, destroy |
| `CampaignController` | Campaigns | index, store, update, destroy, bulkDelete, start, pause, resume, complete, updateProgress, stats, active |
| `TemplateController` | Templates | index, store, destroy, bulkDelete, sync |
| `FriendRequestController` | Friend requests | index, sync, update, bulkUpdateStatus |
| `FacebookAccountController` | Facebook accounts | index, stats, store, validateAccount, destroy |
| `DeviceController` | Devices | index, stats, validateDevice, revokeMultiple, destroy |
| `PollController` | Fallback polling | index |

### Services

Business logic is extracted into service classes:

#### `AuthService`

Handles all authentication operations:

- **`register(data)`** — Creates user, hashes password, issues initial token
- **`login(credentials)`** — Validates credentials, creates `web-token`
- **`extensionLogin(authKey, deviceData)`** — Validates auth key, enforces device limit, registers device, issues `extension-{deviceId}` token
- **`registerDevice(user, deviceData)`** — Creates `Device` record, issues device-specific token
- **`regenerateToken(user)`** — Revokes existing token, issues new one
- **`regenerateAuthKey(user)`** — Generates a new 48-character random auth key
- **`revealAuthKey(user, password)`** — Returns plaintext auth key after password verification

#### `DeviceService`

- **`validateDevice(fingerprint)`** — Checks if a device fingerprint is registered and active
- **`getDeviceInfo(request)`** — Extracts browser, OS, IP, screen resolution from request headers

### Middleware

| Middleware | Purpose |
|---|---|
| `auth:sanctum` | Validates Bearer token on all protected routes |
| `InjectApiToken` | Injects the user's API token into Blade views as a JS variable, so the frontend can make authenticated API calls without a separate login step |
| `throttle:auth` | Rate-limits authentication endpoints (prevents brute force) |
| `throttle:api` | Rate-limits data endpoints |

### Broadcasting

After data mutations, controllers dispatch broadcast events on the authenticated user's private channel:

```php
broadcast(new DataUpdated($user->id, $resource, $data))->toOthers();
```

The channel is `user.{userId}`. The event type is `.data.updated`. The Alpine frontend listens on this channel via Laravel Echo and updates the store automatically.

---

## Database Layer

### ORM Models and Relationships

```
User (uuid)
 ├── hasMany → Contact
 ├── hasMany → Tag
 ├── hasMany → Template
 ├── hasMany → Campaign
 ├── hasMany → Device
 ├── hasMany → FacebookAccount
 ├── hasMany → FriendRequest
 ├── hasMany → ContactNote
 └── hasMany → TokenUsageLog

Contact (string id)
 └── belongsToMany → Tag (via contact_tag pivot)

ContactNote (uuid)
 └── hasMany → Note

Tag (string id)
 └── belongsToMany → Contact (via contact_tag pivot)
```

### Eloquent Scopes

Models use query scopes for common filters. Example:
- `Campaign::active()` — where status is `started` or `resumed`
- `Device::active()` — where `is_active = true` and `revoked_at` is null
- `FriendRequest::pending()` — where status is `pending`

---

## Frontend Architecture

### Entry Point: app.js

`resources/js/app.js` is the Vite entry point. It:

1. Imports and registers Alpine.js plugins and stores
2. Sets up the global Alpine store (`appStore`)
3. Initializes `echo-setup.js` for WebSocket
4. Calls `theme.js` to apply saved theme preference
5. Calls `extension.js` to register extension message listeners

### API Client: api.js

A thin wrapper around `fetch()` that:

- Reads the injected API token from `window.__API_TOKEN__` (set by InjectApiToken middleware)
- Automatically attaches `Authorization: Bearer {token}` to every request
- Sets `X-XSRF-TOKEN` header for CSRF protection
- Handles 401 responses by redirecting to login
- Provides typed methods: `api.get()`, `api.post()`, `api.put()`, `api.delete()`

### Alpine Stores: stores/

Alpine reactive stores hold global application state:

| Store | Contents |
|---|---|
| `appStore` | Tags, contacts, templates, campaigns, friend requests, current view, loading states |
| `toastStore` | Toast notification queue (success, error, info messages) |

Components read from and write to these stores. WebSocket events and extension sync messages update the stores directly, causing reactive re-renders.

### Extension Bridge: extension.js

Listens for `window.postMessage` events from `webappSync.js` content script. Handles:

| Message | Action |
|---|---|
| `SYNC_TAGS_FROM_EXTENSION` | Merges tags into `appStore.tags` |
| `SYNC_CONTACTS_FROM_EXTENSION` | Merges contacts into `appStore.contacts` |
| `SYNC_TEMPLATES_FROM_EXTENSION` | Merges templates into `appStore.templates` |
| `SYNC_FRIEND_REQUESTS_FROM_EXTENSION` | Updates friend requests |
| `BULK_SEND_PROGRESS_UPDATE` | Updates campaign progress bar |
| `BULK_SEND_COMPLETE` | Marks campaign as done, shows summary |
| `FRIEND_REQUEST_TRACKED` | Adds new request to friend requests view |
| `FRIEND_REQUEST_STATUS_UPDATED` | Updates individual request status |

To send a message to the extension, Alpine calls:

```js
window.postMessage({
  source: 'crm-extension-direct',
  type: 'SOME_MESSAGE',
  payload: { ... }
}, '*');
```

### WebSocket: echo-setup.js

Configures Laravel Echo with Reverb as the broadcaster:

```js
window.Echo = new Echo({
  broadcaster: 'reverb',
  key: import.meta.env.VITE_REVERB_APP_KEY,
  wsHost: import.meta.env.VITE_REVERB_HOST,
  wsPort: import.meta.env.VITE_REVERB_PORT,
  authEndpoint: '/broadcasting/auth',
});

Echo.private(`user.${userId}`)
  .listen('.data.updated', (event) => {
    // Merge event.data into the relevant Alpine store
  });
```

If the WebSocket connection drops, the app falls back to polling `/api/poll` every 30 seconds.

### Theme: theme.js

Supports three themes: `light`, `dark`, `system`. The preference is stored in `localStorage`. On page load, the correct Tailwind dark class is applied before any paint to prevent flashing.

---

## Blade Views

### Layout: dashboard.blade.php

The main shell that wraps all views. Contains:
- Navigation sidebar (links to each section)
- Top bar (user info, sync status, theme toggle)
- Main content area (swaps between views via Alpine's `x-show`)
- The `@vite` directive for JS/CSS assets

### Per-Section Views (resources/views/views/)

| View | Description |
|---|---|
| `dashboard.blade.php` | Summary stats: contact count, tag count, campaign stats, friend request counts |
| `contacts.blade.php` | Contact table, search, bulk select, bulk tag, bulk delete, per-contact tag editing |
| `notes.blade.php` | List of contacts with notes, expand to see individual notes |
| `tags.blade.php` | Tag list with color swatches, create/delete |
| `templates.blade.php` | Template list, create/delete |
| `campaigns.blade.php` | Campaign list, create, start/pause/resume, progress tracking |
| `friend-requests.blade.php` | Friend request table, status badges, last checked time |
| `bulk-send.blade.php` | Configure and run a bulk message campaign |
| `auth-tokens.blade.php` | API token management, device list, revoke devices |
| `facebook-accounts.blade.php` | Linked Facebook accounts, unlink |
| `profile.blade.php` | Update name/email, change password, regenerate auth key, reveal auth key |

---

## Authentication Architecture

Two separate authentication paths exist:

### Web Session (Browser)

- Route: `POST /login` (web, not API)
- Creates a session cookie
- Used for accessing the dashboard in a browser
- CSRF protected

### API Token (Extension + API Calls)

- Route: `POST /api/auth/extension-login`
- Input: 48-char auth key + device fingerprint
- Creates a Sanctum personal access token named `extension-{deviceId}`
- Token is stored in chrome.storage, sent as `Authorization: Bearer ...`
- Each physical device gets its own token
- Maximum 4 active devices enforced server-side

See [Authentication](authentication.md) for full flow diagrams.

---

## Configuration

### Key .env Variables

```ini
APP_URL=http://localhost:8000

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=crm
DB_USERNAME=root
DB_PASSWORD=

REVERB_APP_ID=your-reverb-app-id
REVERB_APP_KEY=your-reverb-app-key
REVERB_APP_SECRET=your-reverb-app-secret
REVERB_HOST=localhost
REVERB_PORT=8080

VITE_REVERB_APP_KEY="${REVERB_APP_KEY}"
VITE_REVERB_HOST="${REVERB_HOST}"
VITE_REVERB_PORT="${REVERB_PORT}"

BROADCAST_CONNECTION=reverb
QUEUE_CONNECTION=database
SESSION_DRIVER=database
```

### config/services.php

```php
'crm' => [
  'device_limit' => env('CRM_DEVICE_LIMIT', 4),
]
```

---

## Queue System

Background jobs (campaign processing, batch syncs) run via Laravel's database queue driver. To process jobs:

```bash
php artisan queue:work
```

For production, use a process manager like Supervisor to keep the queue worker running continuously.
