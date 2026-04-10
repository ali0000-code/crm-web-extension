# Extension Internals

## Overview

The Messenger CRM Pro Chrome extension is built to Manifest V3 standards. It injects UI and logic into Facebook pages and communicates with a local Laravel backend. This document covers the extension's internal architecture in detail.

---

## File Structure

```
crm-extension/
├── manifest.json               # Extension configuration
├── background-main.js          # Service worker entry point (imports background.js)
├── background.js               # Service worker logic (bundled)
├── popup.html                  # Extension popup UI
├── popup.js                    # Popup logic (bundled)
├── popup.css                   # Popup styles
├── config.js                   # Shared configuration constants
├── jquery-3.7.1.min.js         # jQuery (used by inject scripts)
├── facebook-account-validator.js  # Guard: check auth before injecting
├── facebookAutoLink.js         # Auto-links Facebook account to CRM user
├── messengerInject.js          # Injects CRM UI into Messenger
├── groupsInject.js             # Injects CRM UI into Facebook Groups
├── notesInject.js              # Notes modal for any Facebook page
├── webappSync.js               # Bridge between extension and webapp tab
├── build.mjs                   # Build script
└── dist/                       # Build output
```

---

## manifest.json

The manifest defines all extension capabilities.

```json
{
  "manifest_version": 3,
  "name": "Messenger CRM Pro",
  "version": "1.0.0",
  "permissions": ["storage", "scripting", "tabs", "cookies"],
  "host_permissions": [
    "*://*.facebook.com/*",
    "http://localhost/*",
    "http://127.0.0.1/*",
    "*://crm.test/*"
  ],
  "background": { "service_worker": "background-main.js" },
  "action": { "default_popup": "popup.html" },
  "externally_connectable": {
    "matches": ["http://localhost/*", "http://localhost:8000/*", ...]
  }
}
```

### Permissions Explained

| Permission | Why It Is Needed |
|---|---|
| `storage` | Read/write tags, contacts, templates, JWT token locally |
| `scripting` | Inject scripts into Messenger tab during bulk send |
| `tabs` | Detect and activate Messenger tabs for bulk campaigns |
| `cookies` | Read Facebook's `c_user` cookie to identify the logged-in account |

### Content Script Bundles

| Bundle | URL Match | Loaded Scripts |
|---|---|---|
| Messenger | `https://www.facebook.com/messages/*` | config.js, jquery, facebook-account-validator.js, messengerInject.js, notesInject.js |
| Facebook General | `https://www.facebook.com/*` | config.js, jquery, facebook-account-validator.js, facebookAutoLink.js, groupsInject.js, notesInject.js |
| Webapp Bridge | `http://localhost/*`, `http://127.0.0.1/*` | config.js, webappSync.js |

All content scripts run at `document_end`.

---

## config.js

Shared configuration available to all scripts via the content script injection order.

```js
const CONFIG = {
  DEBUG: false,
  WEB_APP_URL: 'http://localhost:8000',
  API_BASE_URL: 'http://localhost:8000/api',
  ALLOWED_ORIGINS: ['http://localhost:8000', 'http://127.0.0.1:8000'],
  SUPPORT_URL: '...'
};
```

---

## popup.html / popup.js

The popup is the primary user interface shown when the extension icon is clicked.

### Sections

| Section | Purpose |
|---|---|
| Auth Modal | JWT token entry for first-time setup |
| Tags | Create, view, delete color-coded tags |
| Contacts | Browse linked contacts, bulk select, remove |
| Friend Requests | View tracked requests, status (pending/accepted), refresh |
| Templates | Create and delete reusable message templates |
| Bulk Send Modal | Configure and launch message campaigns |
| Export Modal | Download contacts as CSV/TSV or sync to Google Sheets |
| Profile | Displays current user, sync status, sign out |

### StorageManager Class

The `StorageManager` in `popup.js` is the central data layer for the popup:

- Holds a local in-memory cache of tags, contacts, templates, friend requests
- Reads from `chrome.storage.local` on load
- Writes changes locally first (optimistic update), then syncs to backend
- Cache entries have a 5-minute TTL before forcing a backend refresh
- After syncing, broadcasts updated data to all content scripts via `chrome.runtime.sendMessage`

### Key Methods

| Method | Description |
|---|---|
| `loadState()` | Reads all data from storage, triggers backend sync if stale |
| `syncToBackend()` | POSTs changes to `/api/contacts/sync`, `/api/tags/sync`, etc. |
| `syncToWebApp()` | Sends current state to webapp via background message |
| `validateFacebookAccount()` | Checks if a Facebook account is linked via the backend |
| `startBulkSend(config)` | Sends `BULK_SEND` message to background with campaign parameters |

---

## background-main.js / background.js

The service worker is the extension's backend. It runs in the background and handles all privileged operations.

### Responsibilities

1. **Message Routing** — Receives messages from content scripts and popup, dispatches to handlers
2. **HTTP Calls** — All `fetch()` calls to the Laravel API (content scripts cannot make cross-origin requests)
3. **Bulk Send Engine** — Executes message campaigns with batching, delays, and progress reporting
4. **Keep-alive** — Prevents the MV3 service worker from being suspended during long campaigns
5. **Cookie Access** — Reads Facebook cookies via the `cookies` permission
6. **Contact/Tag Operations** — Saves contacts to tags, handles sync operations

### Message Handlers

| Message Type | Handler |
|---|---|
| `BULK_SEND` | Starts/resumes a bulk message campaign |
| `BULK_SEND_CANCEL` | Cancels an active campaign |
| `SAVE_CONTACTS_TO_TAGS` | Tags a batch of contacts, syncs to backend |
| `SYNC_CONTACTS_TO_BACKEND` | Pushes contacts to `/api/contacts/sync` |
| `SYNC_TO_WEBAPP` | Sends all state to webappSync.js for the dashboard |
| `NOTES_LOAD` | Fetches notes for a contact from backend |
| `NOTES_ADD` | Creates a new note via backend |
| `NOTES_UPDATE` | Updates an existing note |
| `NOTES_DELETE` | Deletes a note |
| `NOTES_GET_ALL_CONTACTS` | Lists all contacts that have notes |
| `TRACK_FRIEND_REQUEST` | Records a new friend request in backend |
| `UPDATE_FRIEND_REQUEST_STATUS` | Updates status of a single request |
| `CHECK_FRIEND_REQUEST_STATUSES` | Polls for status changes on pending requests |
| `GET_FACEBOOK_COOKIES` | Returns Facebook `c_user` cookie value |
| `PING` | Liveness check from webapp/content scripts |

### Bulk Send Algorithm

```
receive BULK_SEND { recipients, message, delaySec, batchSize, batchWaitMinutes }

for each recipient:
  1. Find or open Messenger tab for recipient
  2. Inject message text into composer via chrome.scripting.executeScript
  3. Trigger send
  4. Record result (success or failure)
  5. Wait delaySec before next recipient
  6. If batchSize reached → wait batchWaitMinutes before continuing
  7. Send BULK_SEND_PROGRESS_UPDATE to popup and webappSync
  8. PUT /api/campaigns/{id}/progress with current counts

on completion:
  POST /api/campaigns/{id}/complete
  Send BULK_SEND_COMPLETE to popup and webappSync
```

---

## Content Scripts

### facebook-account-validator.js

A guard that runs before any inject script. It checks:

1. Is a JWT token present in chrome.storage?
2. Is the token still valid (not expired)?

If either check fails, the inject scripts do not run. This prevents UI injection into Facebook for unauthenticated sessions.

---

### facebookAutoLink.js

Runs on all `facebook.com/*` pages. Automatically links the currently logged-in Facebook account to the CRM user.

**Flow:**
1. Check if user is authenticated (JWT present)
2. Check if account already linked and validated within the last 24 hours (skip if so)
3. Extract Facebook user ID using one of three methods:
   - Parse from URL (`profile.php?id=XXXXXX`)
   - Read from `c_user` cookie via background message
   - Parse from page DOM (profile link hrefs)
4. Extract display name from page DOM
5. POST to `/api/facebook-accounts` with account details + JWT
6. Cache result in `chrome.storage.local` with timestamp
7. Show slide-in toast notification on success

---

### messengerInject.js

Runs on `facebook.com/messages/*`. Injects CRM controls directly into Messenger's DOM.

**Injected UI Elements:**

| Element | Location | Purpose |
|---|---|---|
| "Select All" button | Conversation list header | Toggle-select all conversations |
| "Tag" button | Conversation list header | Open tag assignment modal for selected chats |
| Checkboxes | Each conversation row | Individual conversation selection |
| "Template" button | Message composer toolbar | Insert a template into the text field |
| "Notes" button | Conversation header | Open notes modal for current contact |
| Tag assignment modal | Overlay | Pick tags to assign to selected conversations |
| Template picker modal | Overlay | Browse and insert message templates |

**DOM Strategy:**

Facebook uses dynamically generated class names (e.g., `x1abc123`). messengerInject.js targets elements using:
- `role` and `aria-label` attributes (most stable)
- Data attribute selectors
- Structural DOM position relative to known landmarks

A `MutationObserver` watches the conversation list for new messages/conversations and re-injects UI elements as the DOM updates.

**PING/PONG:**

The webapp can detect if the extension is installed by sending a `PING` message. messengerInject.js responds with `PONG` to confirm presence.

---

### groupsInject.js

Runs on `facebook.com/*`. Activates when it detects a Facebook Group member list in the DOM.

**Features:**

| Feature | Description |
|---|---|
| Load All Members | Auto-scrolls the member list to trigger lazy loading |
| Select All | Adds checkboxes and a "Select All" toggle to member rows |
| Bulk Tag | Modal to assign CRM tags to all selected members |
| Send Friend Requests | Sends batch "Add Friend" requests to selected members |
| Request Tracking | Monitors "Add Friend" button clicks and records to backend |
| Status Monitoring | Polls for pending → accepted status changes |

**Friend Request Detection:**

groupsInject.js attaches `click` event listeners to native Facebook "Add Friend" buttons. When clicked:
1. Captures the user's name, profile picture, and Facebook user ID from the DOM
2. Sends `TRACK_FRIEND_REQUEST` to background.js
3. background.js POSTs to `/api/friend-requests/sync`

---

### notesInject.js

Runs on both Messenger and general Facebook pages. Provides a notes modal for any contact.

**Note Operations:**

All operations are proxied through background.js (which has API access):

| Operation | Message Type | API Endpoint |
|---|---|---|
| Load notes | `NOTES_LOAD` | `GET /api/notes/{contactUserId}` |
| Add note | `NOTES_ADD` | `POST /api/notes` |
| Edit note | `NOTES_UPDATE` | `PUT /api/notes/{contactUserId}/{noteId}` |
| Delete note | `NOTES_DELETE` | `DELETE /api/notes/{contactUserId}/{noteId}` |
| List contacts with notes | `NOTES_GET_ALL_CONTACTS` | `GET /api/notes/contacts/all` |

**Retry Logic:**

Service workers can be suspended by Chrome between uses. notesInject.js implements automatic retry with increasing timeouts (100ms → 300ms → 800ms → 2000ms) to handle service worker wake-up latency.

**Integration:**

messengerInject.js exposes `window.openNotesModal(userId, name, picture)` which notesInject.js registers. When the "Notes" button is clicked in Messenger, this function is called.

---

### webappSync.js

Runs on `localhost/*` pages (the CRM web dashboard). Acts as a relay between the extension and the Alpine.js frontend.

**Extension → Webapp (relay in):**

| Extension Message | Relayed As (postMessage) |
|---|---|
| `SYNC_TAGS_FROM_EXTENSION` | `SYNC_TAGS_FROM_EXTENSION` |
| `SYNC_CONTACTS_FROM_EXTENSION` | `SYNC_CONTACTS_FROM_EXTENSION` |
| `SYNC_TEMPLATES_FROM_EXTENSION` | `SYNC_TEMPLATES_FROM_EXTENSION` |
| `SYNC_FRIEND_REQUESTS_FROM_EXTENSION` | `SYNC_FRIEND_REQUESTS_FROM_EXTENSION` |
| `BULK_SEND_PROGRESS_UPDATE` | `BULK_SEND_PROGRESS_UPDATE` |
| `BULK_SEND_COMPLETE` | `BULK_SEND_COMPLETE` |
| `FRIEND_REQUEST_TRACKED` | `FRIEND_REQUEST_TRACKED` |
| `FRIEND_REQUEST_STATUS_UPDATED` | `FRIEND_REQUEST_STATUS_UPDATED` |

**Webapp → Extension (relay out):**

The webapp sends a `window.postMessage` with `source: 'crm-extension-direct'`. webappSync.js intercepts this and forwards it to background.js via `chrome.runtime.sendMessage`.

This relay pattern is required because: the webapp is served over HTTP, and Chrome's Content Security Policy prevents direct `fetch()` calls from the page context to the extension. Using the injected content script as a bridge bypasses this restriction.

---

## Chrome Storage Layout

All extension data is stored in `chrome.storage.local`:

| Key | Type | Description |
|---|---|---|
| `crmFixedJwtToken` | string | Sanctum Bearer token for API auth |
| `crmUserId` | string | Authenticated user's UUID |
| `crmUserName` | string | Authenticated user's display name |
| `crmUserEmail` | string | Authenticated user's email |
| `tags` | Tag[] | Cached tag list |
| `contacts` | Contact[] | Cached contact list |
| `templates` | Template[] | Cached message templates |
| `friendRequests` | FriendRequest[] | Tracked outgoing friend requests |
| `facebookAccountLinked` | boolean | Whether a Facebook account has been linked |
| `validatedFacebookAccount` | object | Cached Facebook account info + timestamp |
| `bulkSendProgress` | object | Current or last campaign progress state |
| `lastSyncTime` | number | Unix timestamp of last backend sync |

---

## Build System

The extension uses a custom build script (`build.mjs`) that:

1. Bundles `background.js` and `popup.js` using esbuild
2. Copies static assets (manifest, HTML, CSS, jQuery, inject scripts) to `dist/`
3. Inject scripts are **not** bundled — they are copied verbatim because they run in the page context and must not be wrapped in a module scope

To build:

```bash
cd crm-extension
npm run build
```

Output is in `dist/` — this is the folder loaded as an unpacked extension in Chrome.
