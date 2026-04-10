# Authentication

The system has two distinct authentication paths: one for the **web dashboard** (browser session) and one for the **browser extension** (API token). Both are underpinned by Laravel Sanctum.

---

## Overview

| Auth Type | Used By | Mechanism | Token Name |
|---|---|---|---|
| Web Session | Browser dashboard | Cookie-based session | N/A (session) |
| Extension Token | Browser extension | Bearer token (Sanctum) | `extension-{deviceId}` |
| Web API Token | Dashboard JS calls | Bearer token (Sanctum) | `web-token` |

---

## Web Session Authentication

Used when a user logs into the dashboard in their browser.

### Registration Flow

```
POST /api/auth/register
  { name, email, password, password_confirmation }
         │
         ▼
Validate input (unique email, strong password)
         │
         ▼
Create User record with bcrypt-hashed password
         │
         ▼
Generate auth_key (48-char random string)
         │
         ▼
Issue Sanctum token named "web-token"
         │
         ▼
Return { user, token }
```

### Login Flow

```
POST /api/auth/login
  { email, password }
         │
         ▼
Validate credentials (Auth::attempt)
         │
         ├─ Fail → 422 Unprocessable Entity
         │
         └─ Success:
              Revoke old web-token if exists
              Issue new Sanctum token "web-token"
              Return { user, token }
```

### InjectApiToken Middleware

For the web dashboard, the API token is injected server-side into the Blade template as a JavaScript variable:

```php
// InjectApiToken.php
$token = $user->currentAccessToken()?->plainTextToken;
// injected as: window.__API_TOKEN__ = "token_string"
```

This means the frontend JS (api.js) never has to ask the user for their token — it reads `window.__API_TOKEN__` automatically.

---

## Extension Authentication

The extension uses a separate auth flow designed for headless (non-browser) use.

### Auth Key System

Each user has a unique **Auth Key** — a 48-character randomly generated string stored in `users.auth_key`. This is the only credential the extension needs to authenticate. Unlike passwords, it:

- Can be revealed in plaintext from the profile settings (after password confirmation)
- Can be regenerated (old key immediately invalidated)
- Does not change unless the user explicitly regenerates it

### Extension Login Flow

```
User copies Auth Key from webapp profile page
         │
         ▼
Pastes into extension popup's auth modal
         │
         ▼
popup.js calls POST /api/auth/extension-login
  {
    auth_key: "48-char-string",
    device_fingerprint: "unique-hash",
    browser_info: "Chrome 124",
    os_info: "macOS 14",
    ip_address: "...",
    screen_resolution: "1920x1080",
    language: "en-US"
  }
         │
         ▼
AuthController::extensionLogin()
  1. Find user by auth_key
  2. Check active device count ≤ device_limit (default 4)
  3. Create or update Device record
  4. Issue Sanctum token: "extension-{deviceId}"
  5. Return { token, device_id, user }
         │
         ▼
popup.js stores in chrome.storage.local:
  crmFixedJwtToken = token
  crmUserId = user.id
  crmUserName = user.name
  crmUserEmail = user.email
         │
         ▼
All subsequent API calls:
  Authorization: Bearer {crmFixedJwtToken}
```

### Device Fingerprint

The extension generates a fingerprint from:
- Browser user agent
- Screen resolution
- Browser language
- Installed plugins list hash
- Canvas fingerprint (where available)

This fingerprint uniquely identifies the browser installation. If the same fingerprint reconnects, the existing device record is reused rather than creating a new one.

### Device Limit Enforcement

```php
$activeDeviceCount = $user->devices()->where('is_active', true)->count();
if ($activeDeviceCount >= config('services.crm.device_limit', 4)) {
    return response()->json(['message' => 'Device limit reached'], 403);
}
```

If the limit is reached, the user must revoke an existing device from the webapp before the new one can authenticate.

---

## Token Types

| Token Name Pattern | Issued By | Scopes | Revoked When |
|---|---|---|---|
| `web-token` | `/api/auth/login` or `/api/auth/register` | All | User calls `/logout`, or `regenerate-token` |
| `extension-{deviceId}` | `/api/auth/extension-login` | All | Device is revoked in webapp |

All tokens are standard Laravel Sanctum personal access tokens stored in `personal_access_tokens`.

---

## Token Regeneration

### Regenerate Web Token

```
POST /api/auth/regenerate-token
         │
         ▼
Delete all existing tokens for user
         │
         ▼
Issue new "web-token"
         │
         ▼
Return { token: "new_token" }
```

**Note:** This also invalidates all extension tokens. The extension will need to re-authenticate after this.

### Regenerate Auth Key

```
POST /api/auth/regenerate-auth-key
         │
         ▼
Generate new 48-char random string
         │
         ▼
Update users.auth_key
         │
         ▼
Return { message: "Auth key regenerated" }
```

The old auth key is immediately invalid. Any extension or device that was authenticated using the old key will continue to work (their tokens are separate), but new logins must use the new key.

---

## Revealing the Auth Key

The auth key is stored hashed (or as plaintext depending on implementation). To reveal it:

```
POST /api/auth/reveal-auth-key
  { password: "current_password" }
         │
         ▼
Verify password via Hash::check
         │
         ├─ Fail → 422
         └─ Success → Return { auth_key: "48-char-string" }
```

This endpoint is rate-limited (`throttle:auth`) to prevent brute-force enumeration.

---

## Facebook Account Linking

After the extension authenticates, it automatically links the user's Facebook account via `facebookAutoLink.js`.

```
facebookAutoLink.js runs on facebook.com
         │
         ▼
Check chrome.storage: already linked and fresh (< 24h)?
  └─ Yes → skip
  └─ No  → continue
         │
         ▼
Extract Facebook user ID:
  1. From URL: profile.php?id=XXXXX
  2. From cookie: c_user (via background getFacebookCookies)
  3. From DOM: profile link hrefs
         │
         ▼
Extract display name from DOM
         │
         ▼
POST /api/facebook-accounts
  { facebook_user_id, account_name, profile_url, profile_picture }
  Authorization: Bearer {crmFixedJwtToken}
         │
         ▼
Server upserts FacebookAccount record
         │
         ▼
Cache result in chrome.storage.local:
  validatedFacebookAccount = { ...accountData, timestamp }
  facebookAccountLinked = true
         │
         ▼
Show toast notification: "Facebook account linked"
```

---

## Broadcasting Authentication

WebSocket channels are private and authenticated via Sanctum:

```
Laravel Echo connects to Reverb WebSocket
         │
         ▼
Subscribes to private channel: user.{userId}
         │
         ▼
Sends auth request to: POST /broadcasting/auth
  Authorization: Bearer {token}
         │
         ▼
Laravel validates token → returns signed channel auth
         │
         ▼
WebSocket connection established on private channel
```

---

## Security Considerations

| Concern | Mitigation |
|---|---|
| Brute-force on login | `throttle:auth` rate limiter |
| Auth key exposure | Stored as field, only revealed after password confirmation; regeneratable |
| Device proliferation | Hard limit of 4 active devices per user |
| Token theft | Short-lived tokens (no expiry set, but revocable); HTTPS in production |
| CSRF on web | XSRF-TOKEN cookie + X-XSRF-TOKEN header required for all state-changing requests |
| Unauthorized cross-origin messages | webappSync.js validates `event.origin` against `CONFIG.ALLOWED_ORIGINS` |
| Extension external message abuse | `externally_connectable` limits which origins can send messages to the extension |
