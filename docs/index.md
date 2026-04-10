# Messenger CRM Pro — Documentation

**Version:** 1.0.0  
**Last Updated:** April 2026

---

## What Is This System?

**Messenger CRM Pro** is a two-part system that turns Facebook Messenger into a fully-featured Customer Relationship Management (CRM) tool:

| Component | Description |
|---|---|
| **Chrome Extension** | Runs inside Facebook and Messenger. Adds tagging, bulk messaging, notes, friend request tracking, and group management directly to the Facebook UI.    |
| **Web Application** | A Laravel dashboard running locally. Stores all data, provides a full management interface, and syncs bidirectionally with the extension in real time. |

Together, they allow you to manage contacts sourced from Facebook, organize them with tags, run bulk message campaigns using templates, track friend requests, and keep per-contact notes — all without leaving your browser.

---

## Documentation Map

### Technical Documentation

| Document | Description |
|---|---|
| [System Architecture](technical/system-architecture.md) | High-level architecture, component diagram, tech stack, and data flow overview |
| [Extension Internals](technical/extension-internals.md) | Extension file structure, content scripts, background service worker, storage layout, message passing |
| [Webapp Internals](technical/webapp-internals.md) | Laravel architecture, Alpine.js frontend, WebSocket broadcasting, middleware and services |
| [API Reference](technical/api-reference.md) | All API endpoints — methods, paths, request parameters, response shapes |
| [Database Schema](technical/database-schema.md) | All tables, columns, types, indexes, and relationships |
| [Authentication](technical/authentication.md) | Auth flows, Sanctum tokens, device system, extension auth key |

### User Manual

| Document | Description |
|---|---|
| [Setup & Installation](user-manual/setup-installation.md) | Step-by-step install and configuration for both the webapp and extension |
| [Extension Guide](user-manual/extension-guide.md) | How to use every feature of the browser extension |
| [Webapp Guide](user-manual/webapp-guide.md) | How to use every feature of the web dashboard |
| [Troubleshooting](user-manual/troubleshooting.md) | Common problems and their fixes |

---

## Quick Start

1. Deploy the webapp — see [Setup & Installation](user-manual/setup-installation.md)
2. Load the extension in Chrome — see [Setup & Installation](user-manual/setup-installation.md#loading-the-extension)
3. Register an account on the webapp and copy your **Auth Key**
4. Paste the Auth Key into the extension popup to authenticate
5. Navigate to Facebook — the extension activates automatically

---

## System Requirements

### Web Application
- PHP 8.2+
- Composer
- Node.js 18+ and npm
- MySQL 8.0+ or PostgreSQL 14+
- A Reverb-compatible WebSocket server (bundled with Laravel Reverb)

### Browser Extension
- Google Chrome 114+ (Manifest V3 support required)
- The webapp running at `http://localhost:8000`

---

## Project Repositories

| Project | Path |
|---|---|
| Chrome Extension | `/Users/UMER/Documents/Projects/crm-extension` |
| Laravel Webapp | `/Users/UMER/Documents/Projects/crm-webapp` |
