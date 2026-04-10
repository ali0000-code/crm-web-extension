# System Architecture

## Overview

Messenger CRM Pro is composed of two tightly integrated pieces: a **Chrome browser extension** and a **local Laravel web application**. The extension operates inside Facebook's pages, while the webapp acts as the persistent data store and management UI. They stay in sync in real time through a combination of direct HTTP API calls, Chrome extension messaging, and WebSocket broadcasting.

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Google Chrome Browser                        │
│                                                                     │
│  ┌───────────────────────────┐   ┌───────────────────────────────┐  │
│  │    facebook.com/messages  │   │    facebook.com/*             │  │
│  │                           │   │                               │  │
│  │  ┌─────────────────────┐  │   │  ┌─────────────────────────┐ │  │
│  │  │  messengerInject.js │  │   │  │   groupsInject.js       │ │  │
│  │  │  notesInject.js     │  │   │  │   facebookAutoLink.js   │ │  │
│  │  └────────┬────────────┘  │   │  │   notesInject.js        │ │  │
│  └───────────│───────────────┘   │  └──────────┬──────────────┘ │  │
│              │                   └─────────────│────────────────┘  │
│              │  chrome.runtime.sendMessage      │                   │
│              └──────────────┬───────────────────┘                  │
│                             │                                       │
│              ┌──────────────▼──────────────────┐                   │
│              │     background-main.js           │                   │
│              │     (Service Worker)             │                   │
│              │                                  │                   │
│              │  • Message router                │                   │
│              │  • Bulk send engine              │                   │
│              │  • HTTP API calls                │                   │
│              │  • Cookie access                 │                   │
│              └──────────────┬───────────────────┘                  │
│                             │                                       │
│  ┌──────────────────────────│──────────────────────────────────┐   │
│  │         localhost:8000   │                                  │   │
│  │                          │  chrome.runtime.sendMessage      │   │
│  │  ┌─────────────────────┐ │  (externally_connectable)        │   │
│  │  │   webappSync.js     │◄├──────────────────────────────────┘   │
│  │  │ (content script)    │ │                                       │
│  │  └────────┬────────────┘ │                                       │
│  │           │ window.postMessage                                   │
│  │  ┌────────▼────────────┐ │                                       │
│  │  │  Alpine.js Frontend │ │                                       │
│  │  │  (SPA Dashboard)    │ │                                       │
│  │  └─────────────────────┘ │                                       │
│  │                          │                                       │
│  │  Laravel 13 Application  │                                       │
│  │  • REST API (/api/*)     │                                       │
│  │  • Sanctum Auth          │                                       │
│  │  • Reverb WebSocket      │                                       │
│  │  • MySQL Database        │                                       │
│  └──────────────────────────┘                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Chrome Extension

| Layer | Technology |
|---|---|
| Manifest | Manifest V3 |
| Background | Service Worker (background-main.js) |
| UI | HTML/CSS/Vanilla JS (popup.html/popup.js) |
| DOM Injection | jQuery 3.7.1 + Vanilla JS |
| Storage | Chrome Storage API (local) |
| Auth | JWT Bearer token (Laravel Sanctum) |

### Web Application

| Layer | Technology |
|---|---|
| Backend Framework | Laravel 13 (PHP 8.2+) |
| Authentication | Laravel Sanctum (API tokens + session) |
| Frontend Framework | Alpine.js v3 |
| CSS | Tailwind CSS v4 |
| Build Tool | Vite |
| Templating | Laravel Blade |
| Real-time | Laravel Reverb (WebSocket) + Laravel Echo |
| Database | MySQL 8+ / PostgreSQL 14+ |
| Queue | Laravel Queue (for async jobs) |

---

## Key Subsystems

### 1. Extension Storage & Sync

The extension uses Chrome's local storage as an in-memory cache with a 5-minute TTL. On load, it reads from storage and compares with the backend. The `StorageManager` class in `popup.js` handles:

- Reading/writing tags, contacts, templates, friend requests
- Queuing changes for backend sync
- Broadcasting updates to all content scripts after sync

### 2. Content Script Injection

Three content script bundles are injected by Chrome automatically based on URL patterns:

| Bundle | URL Match | Scripts |
|---|---|---|
| Messenger | `facebook.com/messages/*` | messengerInject.js, notesInject.js |
| Facebook General | `facebook.com/*` | facebookAutoLink.js, groupsInject.js, notesInject.js |
| Webapp | `localhost/*` | webappSync.js |

### 3. Background Service Worker

The background service worker is the central hub. It:

- Routes messages between content scripts, popup, and the webapp
- Executes bulk send campaigns (long-running operations)
- Makes all HTTP calls to the Laravel API
- Maintains a keep-alive mechanism to prevent service worker termination during campaigns

### 4. Bidirectional Webapp Sync

The extension cannot make direct HTTP calls from the webapp tab (CSP restrictions). Instead:

1. **Extension → Webapp:** background.js sends via `chrome.runtime.sendMessage`, webappSync.js relays it to the Alpine frontend via `window.postMessage`
2. **Webapp → Extension:** Alpine fires `window.postMessage` with `source: 'crm-extension-direct'`, webappSync.js picks it up and forwards via `chrome.runtime.sendMessage` to background.js

### 5. WebSocket Real-time Updates

The webapp uses Laravel Reverb to broadcast database changes to all connected clients on a private per-user channel (`user.{userId}`). When any device modifies data, all other open tabs and devices see the update instantly without polling.

---

## Data Flow: Bulk Message Campaign

```
User configures campaign in popup
         │
         ▼
popup.js sends BULK_SEND to background.js
         │
         ▼
background.js iterates recipients
  ├─ For each recipient:
  │    └─ Executes chrome.scripting.executeScript
  │         (injects message into Messenger tab)
  ├─ Sends progress update to popup
  └─ POSTs progress to /api/campaigns/{id}/progress
         │
         ▼
Campaign complete → broadcasts via Reverb
         │
         ▼
All open webapp tabs update in real time
```

---

## Data Flow: Contact Tagging

```
User selects contacts in Messenger / Groups
         │
         ▼
messengerInject.js / groupsInject.js collects user data
         │
         ▼
Sends SAVE_CONTACTS_TO_TAGS to background.js
         │
         ▼
background.js POSTs to /api/contacts/sync
         │
         ▼
Laravel saves contacts and tags → broadcasts
         │
         ▼
background.js updates chrome.storage.local
         │
         ▼
popup.js / content scripts reflect new state
```

---

## Data Flow: Extension Authentication

```
User opens extension popup
         │
         ├─ JWT token found in chrome.storage?
         │         ├─ Yes → load full UI
         │         └─ No  → show auth modal
         │
User enters Auth Key from webapp
         │
         ▼
popup.js calls /api/auth/extension-login
  (sends auth_key + device fingerprint)
         │
         ▼
Laravel validates auth_key → creates Sanctum token
  (enforces device limit, registers device)
         │
         ▼
Token returned → stored as crmFixedJwtToken
         │
         ▼
All subsequent API calls use Bearer token
```

---

## Security Boundaries

| Boundary | Mechanism |
|---|---|
| Extension ↔ API | Sanctum Bearer token in Authorization header |
| Webapp ↔ API | Sanctum token injected via InjectApiToken middleware |
| Extension ↔ Webapp (local) | Origin-validated postMessage + externally_connectable |
| Web session | Cookie-based session with CSRF protection |
| Device limits | Server enforces max 4 active devices per user |
| Rate limiting | `throttle:auth` on auth endpoints, `throttle:api` on data endpoints |
