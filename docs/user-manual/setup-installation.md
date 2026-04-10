# Setup & Installation Guide

This guide walks you through deploying the Messenger CRM Pro web application and loading the browser extension from scratch.

---

## Prerequisites

Before you begin, make sure the following are installed on your machine:

| Requirement | Minimum Version | Check Command |
|---|---|---|
| PHP | 8.2+ | `php --version` |
| Composer | 2.x | `composer --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| MySQL | 8.0+ | `mysql --version` |
| Git | Any | `git --version` |

A modern MySQL or PostgreSQL database is required. SQLite is not recommended for production.

---

## Part 1: Web Application Setup

### Step 1 — Clone and Install Dependencies

```bash
# Navigate to your projects directory
cd ~/Documents/Projects

# Install PHP dependencies
cd crm-webapp
composer install

# Install Node.js dependencies
npm install
```

### Step 2 — Environment Configuration

Copy the example environment file and open it for editing:

```bash
cp .env.example .env
```

Edit `.env` with your settings. The key values to configure:

```ini
# Application
APP_NAME="Messenger CRM Pro"
APP_ENV=local
APP_KEY=                          # Will be generated in next step
APP_DEBUG=true
APP_URL=http://localhost:8000

# Database
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=crm_db
DB_USERNAME=your_db_user
DB_PASSWORD=your_db_password

# Broadcasting (WebSocket)
BROADCAST_CONNECTION=reverb
REVERB_APP_ID=crm-app
REVERB_APP_KEY=crm-key
REVERB_APP_SECRET=crm-secret
REVERB_HOST=localhost
REVERB_PORT=8080
REVERB_SCHEME=http

# Frontend (Vite needs these)
VITE_REVERB_APP_KEY="${REVERB_APP_KEY}"
VITE_REVERB_HOST="${REVERB_HOST}"
VITE_REVERB_PORT="${REVERB_PORT}"

# Queue (for background jobs)
QUEUE_CONNECTION=database

# Session
SESSION_DRIVER=database
SESSION_LIFETIME=120
```

### Step 3 — Generate Application Key

```bash
php artisan key:generate
```

This sets `APP_KEY` in your `.env` file. It is required for encryption to work.

### Step 4 — Create the Database

Log in to MySQL and create a new database:

```sql
CREATE DATABASE crm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### Step 5 — Run Migrations

```bash
php artisan migrate
```

This creates all the tables. You should see output like:

```
  INFO  Running migrations.

  2025_01_01_000001_create_devices_table .............. 10ms DONE
  2025_01_01_000007_create_crm_tables ................. 25ms DONE
  ...
```

### Step 6 — Build Frontend Assets

```bash
npm run build
```

This compiles Alpine.js, Tailwind CSS, and all frontend assets into `public/build/`.

### Step 7 — Start the Web Server

Open **three separate terminal windows** and run one command in each:

**Terminal 1 — Laravel app server:**
```bash
php artisan serve
```
The app will be available at `http://localhost:8000`

**Terminal 2 — Reverb WebSocket server:**
```bash
php artisan reverb:start
```
This starts the real-time WebSocket server on port 8080.

**Terminal 3 — Queue worker:**
```bash
php artisan queue:work
```
This processes background jobs (campaign execution, syncs).

> **Tip:** For development, all three can be run together with:
> ```bash
> php artisan serve & php artisan reverb:start & php artisan queue:work
> ```

### Step 8 — Create Your Account

Open `http://localhost:8000` in your browser. You will see the registration page. Fill in your name, email, and a strong password (min 8 characters, uppercase, lowercase, and a number).

After registering, you will be taken to the dashboard.

---

## Part 2: Extension Setup

### Step 1 — Build the Extension

```bash
cd ~/Documents/Projects/crm-extension
npm install
npm run build
```

The built extension will be in the `dist/` folder.

### Step 2 — Load in Chrome

1. Open Google Chrome
2. Go to `chrome://extensions/` in the address bar
3. Toggle **Developer mode** on (top-right corner)
4. Click **Load unpacked**
5. Navigate to `~/Documents/Projects/crm-extension/dist/`
6. Click **Select Folder**

The extension will appear in your extensions list as **Messenger CRM Pro**.

> **Pinning the extension:** Click the puzzle piece icon (Extensions) in Chrome's toolbar, then click the pin icon next to Messenger CRM Pro to keep it visible in the toolbar.

### Step 3 — Get Your Auth Key

1. In the webapp at `http://localhost:8000`, click **Profile** in the sidebar
2. Scroll to the **Auth Key** section
3. Click **Reveal Auth Key** and enter your password
4. Copy the 48-character key that appears

### Step 4 — Authenticate the Extension

1. Click the **Messenger CRM Pro** icon in Chrome's toolbar
2. An authentication screen will appear
3. Paste your Auth Key into the input field
4. Click **Authenticate**

The extension will connect to your webapp and load your existing tags, contacts, and templates. You are now ready to use the system.

---

## Part 3: Verify the Connection

To confirm everything is working:

1. **Navigate to Facebook Messenger** (`https://www.facebook.com/messages/`)
2. You should see a **"Select All"** and **"Tag"** button appear in the conversation list sidebar
3. Click the extension icon — it should show your name and a sync status
4. In the webapp dashboard at `http://localhost:8000`, the contacts and tags sections should reflect any data you already have

---

## Development Mode (Hot Reload)

For development with live asset reloading, replace Step 6 and Step 7 with:

**Terminal 1 — Vite dev server:**
```bash
npm run dev
```

**Terminal 2 — Laravel:**
```bash
php artisan serve
```

**Terminal 3 — Reverb:**
```bash
php artisan reverb:start --debug
```

**Terminal 4 — Queue:**
```bash
php artisan queue:work
```

Changes to JS and CSS will be reflected immediately without a rebuild.

---

## Configuration Reference

### Extension config.js

Located at `crm-extension/config.js`. Edit before building if your webapp runs on a different port or host.

```js
const CONFIG = {
  DEBUG: false,                          // Set to true for console output
  WEB_APP_URL: 'http://localhost:8000',  // Webapp base URL
  API_BASE_URL: 'http://localhost:8000/api', // API URL
  ALLOWED_ORIGINS: [
    'http://localhost:8000',
    'http://127.0.0.1:8000'
  ],
};
```

After editing, run `npm run build` to apply changes.

### Device Limit

By default, each user account can authenticate on up to 4 devices. To change this, add to your `.env`:

```ini
CRM_DEVICE_LIMIT=6
```

### Changing the Default Port

If you need the webapp on a different port (e.g., 8001):

```bash
php artisan serve --port=8001
```

Also update `config.js` in the extension and rebuild, and update `APP_URL` in `.env`.

---

## Production Deployment Notes

For production (on a server, not localhost):

1. Set `APP_ENV=production` and `APP_DEBUG=false` in `.env`
2. Use HTTPS — update `APP_URL` to `https://your-domain.com`
3. Update `REVERB_SCHEME=https` and appropriate ports
4. Update `host_permissions` in `manifest.json` to include your production domain
5. Update `CONFIG.WEB_APP_URL` and `CONFIG.API_BASE_URL` in `config.js`
6. Rebuild the extension: `npm run build`
7. Use Supervisor to keep the queue worker and Reverb running continuously
8. Run `php artisan config:cache`, `php artisan route:cache`, and `npm run build` after deploy

---

## Uninstalling

### Remove the Extension

1. Go to `chrome://extensions/`
2. Find **Messenger CRM Pro**
3. Click **Remove**

### Remove the Webapp Data

```bash
php artisan migrate:rollback --step=999  # Drop all tables
```

Or simply drop the database:

```sql
DROP DATABASE crm_db;
```
