# Troubleshooting

This document covers the most common issues encountered with Messenger CRM Pro and how to resolve them.

---

## Extension Issues

### The extension popup shows "Not authenticated"

**Cause:** The JWT token stored in the extension has expired, been revoked, or was never set.

**Fix:**
1. Open the webapp at `http://localhost:8000`
2. Go to **Profile** → **Reveal Auth Key**
3. Copy the key
4. Click the extension icon and paste the key into the auth field
5. Click **Authenticate**

---

### Extension popup shows "Could not connect to webapp"

**Cause:** The Laravel webapp is not running or is on a different port than configured.

**Fix:**
1. Make sure the webapp is running: `php artisan serve` in the crm-webapp directory
2. Confirm it is accessible at `http://localhost:8000`
3. If you changed the port, rebuild the extension with the updated `config.js`

---

### Extension icon is greyed out or shows no popup

**Cause:** The extension may have encountered a critical error or been disabled.

**Fix:**
1. Go to `chrome://extensions/`
2. Find Messenger CRM Pro — check if there is an error badge
3. Click the **Errors** button if present to see the error
4. Try toggling the extension off and back on
5. If the error persists, reload the extension by clicking the refresh icon on the extension card

---

### CRM buttons (Select All, Tag, Notes, Template) don't appear in Messenger

**Cause:** Facebook has updated its DOM structure, or the content scripts haven't injected yet.

**Fix:**
1. Hard-refresh the Messenger page: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
2. Wait 3–5 seconds for scripts to initialize after the page loads
3. Check the browser console for errors: right-click → Inspect → Console
4. If you see permission errors, go to `chrome://extensions/` → Messenger CRM Pro → Details → ensure "Site access" includes `facebook.com`
5. Try navigating away from Messenger and back

---

### Tagging contacts doesn't save them to the webapp

**Cause:** The extension cannot reach the API, or the token has been revoked.

**Fix:**
1. Open the extension popup and check the sync status at the top
2. Click **Sync Now** if available
3. Open browser console on a Facebook tab and look for failed network requests to `localhost:8000`
4. Ensure the webapp is running: `php artisan serve`
5. Re-authenticate the extension if the token appears invalid

---

### Notes don't open when clicking the Notes button

**Cause:** The background service worker may have been suspended by Chrome.

**Background:** Chrome (MV3) can suspend service workers after ~30 seconds of inactivity. notesInject.js has a built-in retry mechanism (up to ~3 seconds), but sometimes the worker takes longer to wake.

**Fix:**
1. Click the extension icon in the toolbar — this wakes the service worker
2. Then try the Notes button again
3. If the problem is consistent, try reloading the Facebook page

---

### Friend request status is not updating

**Cause:** Status checking requires the extension to visit profile pages, which takes time.

**Fix:**
1. Open the extension popup → **Friend Requests** → click **Refresh Status**
2. Wait for the process to complete (can take 1–2 minutes for large lists)
3. If no updates appear, ensure you are logged into Facebook in the same Chrome profile
4. Check that `facebook.com` host permission is granted in `chrome://extensions/` → Messenger CRM Pro → Details

---

### Bulk send stops mid-campaign

**Cause:** The Messenger tab was closed, Chrome suspended the service worker, or a tab navigation interrupted the process.

**Fix:**
1. Check if the campaign is in **Paused** state (in the popup or webapp)
2. If so, click **Resume** to continue from the last position
3. Keep the Messenger tab open and active during bulk sends
4. Avoid switching to other heavy Chrome tasks during a campaign to prevent service worker suspension

---

### "Device limit reached" when authenticating extension

**Cause:** You have 4 active devices registered and are trying to add a 5th.

**Fix:**
1. Open the webapp → **Devices** in the sidebar
2. Find a device you no longer use (check "Last Active" date)
3. Click **Revoke** on that device
4. Return to the extension and authenticate again

---

### Extension data is out of sync with the webapp

**Cause:** A sync error occurred, or data was changed in the webapp while the extension was offline.

**Fix:**
1. Open the extension popup and click **Sync Now**
2. If the popup doesn't have a sync button, reload the Facebook page (the extension syncs on page load)
3. Check if the webapp is running at `http://localhost:8000`
4. As a last resort, sign out of the extension and sign back in — this triggers a full data reload

---

## Webapp Issues

### Cannot access `http://localhost:8000` — "This site can't be reached"

**Cause:** The Laravel dev server is not running.

**Fix:**
```bash
cd ~/Documents/Projects/crm-webapp
php artisan serve
```

Leave this terminal open. The server must stay running while you use the app.

---

### Login page redirects back to login (can't log in)

**Cause:** Session or database configuration issue.

**Fix:**
1. Check your `.env` file — make sure `SESSION_DRIVER=database` and `DB_*` values are correct
2. Run migrations if you haven't: `php artisan migrate`
3. Clear config cache: `php artisan config:clear`
4. Try clearing browser cookies for `localhost`

---

### Webapp loads but shows blank sections / no data

**Cause:** The frontend assets weren't built, or the API token wasn't injected properly.

**Fix:**
1. Run `npm run build` in the crm-webapp directory
2. Refresh the page
3. Open the browser console (F12 → Console) and look for JavaScript errors
4. If you see 401 errors in the Network tab, the API token may not be injecting — check InjectApiToken middleware is active

---

### Real-time updates aren't working (page doesn't update when extension syncs)

**Cause:** The Reverb WebSocket server is not running.

**Fix:**
```bash
cd ~/Documents/Projects/crm-webapp
php artisan reverb:start
```

The webapp will fall back to polling every 30 seconds if WebSocket is unavailable, so data will still eventually appear — just with a short delay.

---

### "SQLSTATE" database errors on page load or API calls

**Cause:** Database connection misconfiguration or the MySQL server is not running.

**Fix:**
1. Check that MySQL is running: `mysql -u root -p` (or `brew services list | grep mysql` on Mac)
2. Verify `DB_*` values in `.env` match your MySQL setup
3. Check the database exists: `SHOW DATABASES;` in MySQL
4. Run `php artisan migrate` if you just set up the project

---

### Campaign progress bar doesn't move

**Cause:** Queue worker is not running, or the extension is not active.

**Fix:**
1. Make sure the queue worker is running:
   ```bash
   php artisan queue:work
   ```
2. Make sure the extension is authenticated and a Facebook Messenger tab is open
3. Check the Campaign status — if it shows **Paused**, click **Resume**

---

### "Too Many Attempts" (429 error) on login or auth

**Cause:** The rate limiter has been triggered by too many failed requests.

**Fix:**
1. Wait 60 seconds and try again
2. If you're a developer testing, you can clear the rate limit cache:
   ```bash
   php artisan cache:clear
   ```

---

### "Unauthenticated" (401) errors on API calls

**Cause:** The Sanctum token has been revoked or expired.

**Fix:**
1. Log out and log back in to the webapp
2. For the extension, sign out and re-authenticate using the Auth Key

---

### Changes made in webapp don't appear in extension

**Cause:** The extension's local cache hasn't been refreshed.

**Fix:**
1. Open the extension popup — it syncs data on open
2. Reload the Facebook page
3. The extension's cache is refreshed every 5 minutes automatically

---

## General Tips

### Clearing All Extension Data

If you want a completely fresh start with the extension:
1. Go to `chrome://extensions/`
2. Click **Details** on Messenger CRM Pro
3. Scroll down to **Extension options** → or use the Chrome dev tools:
   - Right-click the extension popup → Inspect
   - Go to Application → Local Storage → clear all entries

### Checking Extension Console Logs

To see debug output from the extension:
1. Go to `chrome://extensions/`
2. Click **Service Worker** link under Messenger CRM Pro → opens a DevTools window for the background worker
3. Check the Console for errors

To see content script logs (from messengerInject.js, etc.):
1. On a Facebook page, right-click → **Inspect**
2. In the Console, you'll see output from all injected scripts

To enable verbose logging, set `DEBUG: true` in `config.js` and rebuild the extension.

### Checking Webapp Logs

Laravel logs are at `crm-webapp/storage/logs/laravel.log`. Check here for server-side errors:

```bash
tail -f ~/Documents/Projects/crm-webapp/storage/logs/laravel.log
```

### Full Reset (Last Resort)

If nothing works and you need a complete reset:

```bash
# Clear all Laravel caches
php artisan cache:clear
php artisan config:clear
php artisan route:clear
php artisan view:clear

# Re-run database migrations
php artisan migrate:fresh

# Rebuild frontend
npm run build
```

Then sign out of the extension, sign back in with a new Auth Key from your freshly-created account.
