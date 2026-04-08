## Pending Issues — Messenger CRM Pro Extension

Last updated: 2026-04-08

---

### Already Fixed

| Issue | File | Status |
|-------|------|--------|
| Dead code: `syncToFirestore`, `removeFromFirestore` | `background.js:74-82` | Done |
| Dead code: `throttle()` (duplicate of debounce, never called) | `popup.js:75-85` | Done |
| `lastStatusCheck` type inconsistency (`Date.now()` vs ISO string) | `background.js:1545` | Done |
| Prod build output named `background.js` instead of `background-main.js` | `build.mjs:212` | Done |

---

### Necessary — Still Pending

#### High

| # | File | Line | Issue |
|---|------|------|-------|
| 1 | `tests/selectors/groups.spec.ts` | 6 | Wrong auth file path: `path.join(__dirname, '..', '..', 'auth', ...)` resolves to `<root>/auth/` but session is saved at `tests/auth/`. Fix: change `'..', '..'` to `'..'`. |
| 2 | `tests/selectors/messenger.spec.ts` | 6 | Same wrong auth file path as above. |
| 3 | `manifest.json` | 21 | `"*://crm.test/*"` dev-only domain in `host_permissions` — will cause Chrome Web Store review rejection. Remove for production. |
| 4 | `manifest.json` | 39-48 | Content script double-injection: `facebook.com/*` superset matches `/messages/*` pages, causing `const CONFIG` re-declaration `SyntaxError`. Fix: add `"exclude_matches": ["https://www.facebook.com/messages/*"]` to the `facebook.com/*` entry. |

---

### Intentionally Skipped (Low Risk / Not Worth Fixing Now)

| # | File | Issue | Reason Skipped |
|---|------|-------|----------------|
| 5 | `facebook-account-validator.js:118` | JWT token sent in message payload unnecessarily | Background ignores it; low exposure risk |
| 6 | `background.js:2513-3236` | ~200 lines of code duplication between `onMessage` and `onMessageExternal` | Tech debt, not a bug |
| 7 | `groupsInject.js` | No double-init guard (unlike messengerInject.js) | Low probability of double-init in practice |
| 8 | `background.js:614` | Hardcoded `sleep(20000)` before closing messenger tab | Works in practice; optimization not a bug |
| 9 | `messengerInject.js:103` | `window.selectedUsers` global on facebook.com | Theoretical conflict, hasn't caused issues |
| 10 | `popup.js:61` | `const $ = id => document.getElementById(id)` shadows jQuery convention | popup.html doesn't load jQuery; cosmetic only |
| 11 | `background.js:2663-2667` | `sendResponse` called before `createAndStartCampaign` resolves | Intentional fire-and-forget design |
| 12 | `tests/auth-setup.ts:24-25` | Hardcoded user agent string — may trigger Facebook bot detection | Low priority; update if tests start failing |
