/**
 * Facebook Auto-Link Content Script
 *
 * Runs on: facebook.com pages (matched via manifest.json)
 *
 * Automatically detects the logged-in Facebook account by reading the c_user cookie
 * (via background.js getFacebookCookies) and links it to the CRM backend so the
 * extension knows which Facebook account belongs to the authenticated CRM user.
 *
 * Guard conditions (skips if any are true):
 *   - User is not authenticated with the extension (no JWT token in storage)
 *   - Account is already linked AND the cached validation is less than 24 hours old
 *
 * On successful auto-link:
 *   - Stores { facebookAccountLinked: true, validatedFacebookAccount: {...} } in
 *     chrome.storage.local so future page loads skip the linking step.
 *   - Displays a non-intrusive slide-in toast notification confirming the link.
 */

(async function() {
  console.log('[FB Auto-Link] Script initialized');

  // Escape HTML special characters to prevent XSS
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  // Wait for page to be fully loaded
  if (document.readyState === 'loading') {
    await new Promise(resolve => {
      document.addEventListener('DOMContentLoaded', resolve);
    });
  }

  // Additional wait for React/dynamic content
  await new Promise(resolve => setTimeout(resolve, 2000));

  async function detectAndLinkFacebookAccount() {
    try {
      console.log('[FB Auto-Link] Starting account detection...');

      // Check if user is authenticated with extension
      const storage = await chrome.storage.local.get(['crmFixedJwtToken', 'crmUserId', 'facebookAccountLinked', 'validatedFacebookAccount']);

      if (!storage.crmFixedJwtToken || !storage.crmUserId) {
        console.log('[FB Auto-Link] User not authenticated with extension, skipping');
        return;
      }

      // Check if we have a cached validation AND it's valid and recent
      if (storage.facebookAccountLinked && storage.validatedFacebookAccount && storage.validatedFacebookAccount.valid) {
        const validationAge = Date.now() - (storage.validatedFacebookAccount.validatedAt || 0);
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        if (validationAge < maxAge) {
          console.log('[FB Auto-Link] Facebook account already linked and recently validated, skipping');
          return;
        } else {
          console.log('[FB Auto-Link] Cached validation is stale, re-checking...');
        }
      }

      console.log('[FB Auto-Link] User is authenticated, attempting to extract Facebook info...');

      // Method 1: Try to get user ID from page URL or profile link
      let facebookUserId = null;
      let facebookName = null;

      // Check URL for profile ID
      const urlMatch = window.location.href.match(/facebook\.com\/profile\.php\?id=(\d+)/);
      if (urlMatch) {
        facebookUserId = urlMatch[1];
        console.log('[FB Auto-Link] Found user ID from URL:', facebookUserId);
      }

      // Method 2: Try to get from cookies
      if (!facebookUserId) {
        const cookies = await chrome.runtime.sendMessage({
          action: 'getFacebookCookies'
        });

        if (cookies && cookies.c_user) {
          facebookUserId = cookies.c_user;
          console.log('[FB Auto-Link] Found user ID from cookies:', facebookUserId);
        }
      }

      // Method 3: Try to extract from page elements
      if (!facebookUserId) {
        // Look for profile link in navigation
        const profileLinks = document.querySelectorAll('a[href*="/profile.php?id="], a[href*="facebook.com/"]');
        for (const link of profileLinks) {
          const href = link.getAttribute('href');
          if (href) {
            const match = href.match(/id=(\d+)/);
            if (match) {
              facebookUserId = match[1];
              console.log('[FB Auto-Link] Found user ID from profile link:', facebookUserId);
              break;
            }
          }
        }
      }

      // Try to get user name
      const nameElement = document.querySelector('[aria-label*="Your profile"], [data-visualcompletion="ignore-dynamic"]');
      if (nameElement) {
        facebookName = nameElement.textContent.trim();
        console.log('[FB Auto-Link] Found user name:', facebookName);
      }

      if (!facebookUserId) {
        console.log('[FB Auto-Link] Could not detect Facebook user ID');
        return;
      }

      // Send to background script to link the account
      console.log('[FB Auto-Link] Attempting to link account:', {
        facebookUserId,
        facebookName
      });

      const response = await chrome.runtime.sendMessage({
        action: 'autoLinkFacebookAccount',
        facebookUserId,
        facebookName: facebookName || 'Facebook User'
      });

      if (response && response.success) {
        console.log('[FB Auto-Link] ✅ Account linked successfully!');

        // Store flag to prevent re-linking and clear validation errors
        await chrome.storage.local.set({
          facebookAccountLinked: true,
          validatedFacebookAccount: {
            valid: true,
            accountName: facebookName || 'Facebook User',
            facebookUserId: facebookUserId,
            validatedAt: Date.now()
          }
        });

        // Remove any validation error
        await chrome.storage.local.remove(['validationError']);

        // Show success notification
        showSuccessNotification(facebookName || 'Your Facebook account');
      } else {
        console.log('[FB Auto-Link] ❌ Failed to link account:', response?.error);
      }

    } catch (error) {
      console.error('[FB Auto-Link] Error during auto-link:', error);
    }
  }

  function showSuccessNotification(name) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      font-weight: 600;
      animation: slideIn 0.3s ease-out;
    `;

    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <svg width="24" height="24" fill="white" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
        </svg>
        <div>
          <div>Facebook Account Linked!</div>
          <div style="font-size: 12px; opacity: 0.9; font-weight: 400; margin-top: 4px;">${escapeHtml(name)} • Messenger CRM</div>
          <div style="font-size: 11px; opacity: 0.85; font-weight: 400; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.2);">
            Reopen the extension popup to refresh
          </div>
        </div>
      </div>
    `;

    // Add animation keyframes
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    // Remove after 5 seconds
    setTimeout(() => {
      notification.style.animation = 'slideIn 0.3s ease-out reverse';
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  }

  // Run detection
  detectAndLinkFacebookAccount();

})();
