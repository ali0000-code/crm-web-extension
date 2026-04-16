/**
 * Facebook Account Validation Service
 *
 * Runs as: content script on facebook.com (loaded via manifest.json
 * before messengerInject.js and groupsInject.js so they can call it synchronously)
 *
 * Validates that the current Facebook account (identified by the c_user cookie) is
 * linked to the authenticated CRM user in the backend. messengerInject.js and
 * groupsInject.js call FacebookAccountValidator.validateAccount() at startup and
 * only activate CRM features if validation passes.
 *
 * Caching:
 *   - Stores the validation result in chrome.storage.local under
 *     'validatedFacebookAccount' with a timestamp.
 *   - Cache is considered fresh for 1 hour; after that, a new API call is made.
 *   - Cache is invalidated immediately if the c_user cookie changes (account switch).
 *
 * Communication:
 *   - Validation API calls are routed through background.js via chrome.runtime.sendMessage
 *     because content scripts on HTTPS pages cannot fetch HTTP localhost (mixed content).
 *
 * Exposed globally as window.FacebookAccountValidator and globalThis.FacebookAccountValidator
 * so other content scripts in the same world can access it directly.
 */

const FacebookAccountValidator = {

  /**
   * Extract Facebook User ID from cookies (c_user cookie)
   * This is the numeric ID that Facebook assigns to each user
   *
   * @returns {string|null} Facebook user ID or null if not found
   */
  getFacebookUserId() {
    try {
      const cookies = document.cookie.split(';');
      const cUserCookie = cookies.find(c => c.trim().startsWith('c_user='));

      if (cUserCookie) {
        const userId = cUserCookie.split('=')[1].trim();
        console.log('[FB Validator] Extracted Facebook User ID:', userId);
        return userId;
      }

      console.warn('[FB Validator] c_user cookie not found');
      return null;
    } catch (error) {
      console.error('[FB Validator] Error extracting Facebook user ID:', error);
      return null;
    }
  },

  /**
   * Validate current Facebook account against backend
   * Checks if the Facebook account (from c_user cookie) is linked to the CRM user
   *
   * @returns {Promise<object>} Validation result { valid: boolean, accountName?: string, error?: string, code?: string }
   */
  async validateAccount() {
    try {
      console.log('[FB Validator] Starting account validation...');

      // Get JWT token from storage (stored as 'crmFixedJwtToken')
      const storage = await chrome.storage.local.get(['crmFixedJwtToken', 'validatedFacebookAccount']);
      const jwtToken = storage.crmFixedJwtToken;
      const cachedValidation = storage.validatedFacebookAccount;

      if (!jwtToken) {
        console.warn('[FB Validator] Not authenticated. Please log in to the extension.');
        // Clear any cached validation since we have no JWT
        await this.clearValidation();
        return {
          valid: false,
          error: 'Not authenticated. Please log in to the extension.',
          code: 'NO_JWT'
        };
      }

      // Get current Facebook user ID from cookie
      const facebookUserId = this.getFacebookUserId();

      if (!facebookUserId) {
        console.warn('[FB Validator] Could not detect Facebook user');
        await this.clearValidation();
        return {
          valid: false,
          error: 'Could not detect Facebook account. Make sure you are logged into Facebook.',
          code: 'NO_FB_USER'
        };
      }

      console.log('[FB Validator] Current Facebook User ID from cookie:', facebookUserId);

      // If cached validation is for the same user and still fresh (< 1 hour), use it directly
      if (cachedValidation && cachedValidation.valid && cachedValidation.facebookUserId === facebookUserId) {
        const age = Date.now() - (cachedValidation.validatedAt || 0);
        if (age < 60 * 60 * 1000) {
          console.log('[FB Validator] ✅ Using fresh cached validation for:', cachedValidation.accountName);
          return {
            valid: true,
            accountName: cachedValidation.accountName,
            accountId: cachedValidation.accountId
          };
        }
        console.log('[FB Validator] Cache is stale, re-validating...');
      } else if (cachedValidation && cachedValidation.facebookUserId !== facebookUserId) {
        console.log('[FB Validator] Account changed, clearing cache...');
        await this.clearValidation();
      }

      console.log('[FB Validator] Validating via background service worker...', { facebookUserId });

      // Route through background.js — content scripts on HTTPS pages (facebook.com)
      // cannot fetch HTTP localhost due to mixed content / CSP restrictions.
      const data = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Validation request timed out')), 15000);
        chrome.runtime.sendMessage(
          { action: 'validateFacebookAccount', facebookUserId },
          (response) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response);
          }
        );
      });

      if (data.success) {
        console.log('[FB Validator] ✅ Validation successful:', data.data.accountName);

        await chrome.storage.local.set({
          validatedFacebookAccount: {
            valid: true,
            facebookUserId,
            accountName: data.data.accountName,
            accountId: data.data.accountId,
            validatedAt: Date.now()
          }
        });

        return {
          valid: true,
          accountName: data.data.accountName,
          accountId: data.data.accountId
        };
      } else {
        console.warn('[FB Validator] ❌ Validation failed:', data.error, data.code);
        await this.clearValidation();
        return {
          valid: false,
          error: data.error,
          code: data.code
        };
      }

    } catch (error) {
      console.error('[FB Validator] Validation error:', error);

      // Clear cached validation on error
      await this.clearValidation();

      return {
        valid: false,
        error: 'Failed to validate account: ' + error.message,
        code: 'VALIDATION_ERROR'
      };
    }
  },

  /**
   * Check if account is currently validated (uses cached validation)
   * Re-validates if cache is older than 1 hour
   *
   * @returns {Promise<boolean>} True if account is valid
   */
  async isAccountValid() {
    try {
      const result = await chrome.storage.local.get(['validatedFacebookAccount']);
      const validated = result.validatedFacebookAccount;

      if (!validated) {
        console.log('[FB Validator] No cached validation found');
        return false;
      }

      // Check if validation is recent (within 1 hour)
      const oneHour = 60 * 60 * 1000;
      const cacheAge = Date.now() - validated.validatedAt;

      if (cacheAge > oneHour) {
        console.log('[FB Validator] Cached validation expired, re-validating...');
        // Re-validate
        const validation = await this.validateAccount();
        return validation.valid;
      }

      // Check if current FB user matches validated user
      const currentFbUser = this.getFacebookUserId();
      const isMatch = currentFbUser === validated.facebookUserId;

      if (!isMatch) {
        console.warn('[FB Validator] Facebook account changed, cached validation invalid');
        return false;
      }

      console.log('[FB Validator] ✅ Using cached validation:', validated.accountName);
      return true;

    } catch (error) {
      console.error('[FB Validator] Error checking validation:', error);
      return false;
    }
  },

  /**
   * Get validation error message with actionable instructions
   *
   * @param {string} code - Error code from validation
   * @returns {string} User-friendly error message
   */
  getErrorMessage(code) {
    const messages = {
      'NO_JWT': 'Please log in to the extension first.',
      'NO_FB_USER': 'Could not detect your Facebook account. Make sure you are logged into Facebook.',
      'ACCOUNT_NOT_LINKED': 'This Facebook account is not linked to your CRM. Please add it in the CRM settings under "Facebook Accounts".',
      'MULTIPLE_USERNAME_ACCOUNTS': 'Multiple Facebook accounts found. Please remove duplicates in your CRM settings.',
      'ACCOUNT_DEACTIVATED': 'This Facebook account has been deactivated in the CRM.',
      'UNAUTHENTICATED': 'Your session has expired. Please log in again in the extension.',
      'INVALID_JWT': 'Your session has expired. Please log in again in the extension.',
      'VALIDATION_ERROR': 'Failed to validate account. Please check your internet connection and try again.'
    };

    return messages[code] || 'Account validation failed. Please check your settings.';
  },

  /**
   * Clear cached validation (call when user logs out or switches accounts)
   */
  async clearValidation() {
    await chrome.storage.local.remove(['validatedFacebookAccount', 'facebookAccountLinked']);
    console.log('[FB Validator] Validation cache cleared');
  }
};

// Make available globally for content scripts and page context
// In Chrome extension content scripts, we need to set it on both window and global scope
if (typeof window !== 'undefined') {
  window.FacebookAccountValidator = FacebookAccountValidator;
}

// Also make it available in global scope for content scripts
if (typeof globalThis !== 'undefined') {
  globalThis.FacebookAccountValidator = FacebookAccountValidator;
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FacebookAccountValidator;
}

console.log('[FB Validator] Module loaded and exposed:', typeof FacebookAccountValidator);
