/**
 * AUTH KEY AUTHENTICATION FOR BROWSER EXTENSION
 *
 * This module handles authentication using auth keys.
 * Users paste their auth key from the web dashboard → extension exchanges it
 * for a device-specific Sanctum token via /api/auth/extension-login.
 */

// Authentication configuration
const AUTH_CONFIG = {
  API_BASE_URL: CONFIG.API_BASE_URL, // From config.js
  STORAGE_KEYS: {
    TOKEN: 'crmFixedJwtToken',       // Device-specific Sanctum token (kept same key for compatibility)
    USER_ID: 'crmUserId',
    USER_NAME: 'crmUserName',
    USER_EMAIL: 'crmUserEmail',
    DEVICE_ID: 'crmDeviceId',
  }
};

/**
 * Sanctum Token Authentication Manager
 */
class FixedJwtAuth {
  constructor() {
    this.token = null;
    this.userId = null;
    this.userName = null;
    this.userEmail = null;
    this.deviceId = null;
    this.isAuthenticated = false;
  }

  /**
   * Initialize authentication - load stored credentials and validate
   */
  async init() {
    try {
      const result = await chrome.storage.local.get([
        AUTH_CONFIG.STORAGE_KEYS.TOKEN,
        AUTH_CONFIG.STORAGE_KEYS.USER_ID,
        AUTH_CONFIG.STORAGE_KEYS.USER_NAME,
        AUTH_CONFIG.STORAGE_KEYS.USER_EMAIL,
        AUTH_CONFIG.STORAGE_KEYS.DEVICE_ID,
      ]);

      this.token = result[AUTH_CONFIG.STORAGE_KEYS.TOKEN];
      this.userId = result[AUTH_CONFIG.STORAGE_KEYS.USER_ID];
      this.userName = result[AUTH_CONFIG.STORAGE_KEYS.USER_NAME];
      this.userEmail = result[AUTH_CONFIG.STORAGE_KEYS.USER_EMAIL];
      this.deviceId = result[AUTH_CONFIG.STORAGE_KEYS.DEVICE_ID];

      console.log('[Auth] Loaded credentials from storage:', {
        hasToken: !!this.token,
        userId: this.userId,
        deviceId: this.deviceId,
      });

      // If we have credentials, validate them with the backend
      if (this.token && this.deviceId) {
        try {
          const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/devices/validate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.token}`,
            },
            body: JSON.stringify({ deviceId: this.deviceId }),
          });

          const data = await response.json().catch(() => ({}));

          if (response.ok && data.success && data.data?.isActive) {
            this.isAuthenticated = true;
            console.log('[Auth] Device validated successfully');
            return true;
          }

          // Token invalid or device revoked — clear credentials
          console.warn('[Auth] Validation failed:', data);
          await this.clearCredentials();
          return false;

        } catch (networkError) {
          // Network error — do NOT assume authenticated (security fix)
          console.warn('[Auth] Could not reach backend:', networkError.message);
          // Keep credentials but mark as needing re-validation
          this.isAuthenticated = false;
          return false;
        }
      }

      // No credentials stored
      this.isAuthenticated = false;
      return false;

    } catch (error) {
      console.error('[Auth] Init error:', error);
      return false;
    }
  }

  /**
   * Authenticate with auth key from web dashboard.
   * Sends auth key + device info to server, receives device-specific token.
   * @param {string} authKey - The auth key from the web dashboard
   * @returns {Promise<object>} Result with user, token, device
   */
  async authenticateWithAuthKey(authKey) {
    try {
      console.log('[Auth] Authenticating with auth key...');

      const deviceInfo = await this.collectDeviceInfo();

      const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/extension-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_key: authKey, deviceInfo }),
      });

      const result = await response.json();

      if (!result.success) {
        if (result.code === 'DEVICE_LIMIT_REACHED') {
          const err = new Error(result.error || 'Device limit reached. Please remove an existing device from the web dashboard.');
          err.code = 'DEVICE_LIMIT_REACHED';
          throw err;
        }
        throw new Error(result.error || 'Authentication failed. Check your auth key.');
      }

      const { token, user, device, deviceLimit } = result.data;

      // Store device-specific token (NOT the auth key)
      await chrome.storage.local.set({
        [AUTH_CONFIG.STORAGE_KEYS.TOKEN]: token,
        [AUTH_CONFIG.STORAGE_KEYS.USER_ID]: user.id,
        [AUTH_CONFIG.STORAGE_KEYS.USER_NAME]: user.name,
        [AUTH_CONFIG.STORAGE_KEYS.USER_EMAIL]: user.email,
        [AUTH_CONFIG.STORAGE_KEYS.DEVICE_ID]: device?.deviceId || null,
      });

      this.token = token;
      this.userId = user.id;
      this.userName = user.name;
      this.userEmail = user.email;
      this.deviceId = device?.deviceId || null;
      this.isAuthenticated = true;

      console.log('[Auth] Auth key authentication successful:', { userId: user.id, deviceId: device?.deviceId });

      return { user, token, device, deviceLimit };

    } catch (error) {
      console.error('[Auth] Auth key authentication error:', error);
      throw error;
    }
  }

  /**
   * Legacy login — kept for backward compatibility, redirects to auth key flow.
   * @deprecated Use authenticateWithAuthKey() instead
   */
  async login(email, password) {
    console.warn('[Auth] login() is deprecated. Use authenticateWithAuthKey() with an auth key instead.');
    throw new Error('Direct login is no longer supported. Please use your auth key from the web dashboard.');
  }

  /**
   * Legacy register — kept for backward compatibility.
   * @deprecated Register on the web dashboard instead
   */
  async register(name, email, password, passwordConfirmation) {
    console.warn('[Auth] register() is deprecated. Register on the web dashboard instead.');
    throw new Error('Registration from the extension is no longer supported. Please register on the web dashboard.');
  }

  /**
   * Log out — revoke token and clear credentials
   */
  async logout() {
    try {
      if (this.token) {
        const body = {};
        if (this.deviceId) body.deviceId = this.deviceId;

        await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`,
          },
          body: JSON.stringify(body),
        }).catch(() => {}); // Don't fail if backend is unreachable
      }
    } finally {
      await this.clearCredentials();
    }
  }

  /**
   * Collect device information for fingerprinting
   */
  async collectDeviceInfo() {
    return {
      screen: {
        width: typeof screen !== 'undefined' ? screen.width : 0,
        height: typeof screen !== 'undefined' ? screen.height : 0,
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      platform: navigator.platform || navigator.userAgentData?.platform || 'unknown',
    };
  }

  /**
   * Clear stored credentials
   */
  async clearCredentials() {
    try {
      await chrome.storage.local.remove([
        AUTH_CONFIG.STORAGE_KEYS.TOKEN,
        AUTH_CONFIG.STORAGE_KEYS.USER_ID,
        AUTH_CONFIG.STORAGE_KEYS.USER_NAME,
        AUTH_CONFIG.STORAGE_KEYS.USER_EMAIL,
        AUTH_CONFIG.STORAGE_KEYS.DEVICE_ID,
        // Also clear legacy keys
        'crmTokenId',
        'crmFirebaseToken',
        // Clear Facebook validation cache on logout
        'validatedFacebookAccount',
        'facebookAccountLinked',
        // Clear cached app data so new user starts fresh
        'contacts',
        'tags',
        'templates',
        'friendRequests',
        'friendRequestStats',
      ]);

      this.token = null;
      this.userId = null;
      this.userName = null;
      this.userEmail = null;
      this.deviceId = null;
      this.isAuthenticated = false;

      console.log('[Auth] Credentials cleared');
    } catch (error) {
      console.error('[Auth] Error clearing credentials:', error);
    }
  }

  /**
   * Get current authentication status
   */
  getAuthStatus() {
    return {
      isAuthenticated: this.isAuthenticated,
      hasToken: !!this.token,
      userId: this.userId,
      userName: this.userName,
      userEmail: this.userEmail,
      deviceId: this.deviceId,
    };
  }

  /**
   * Get token for API requests (backward compatible — other files call getJwtToken())
   */
  getJwtToken() {
    if (!this.isAuthenticated || !this.token) {
      throw new Error('Not authenticated');
    }
    return this.token;
  }

  /**
   * Alias for backward compatibility
   */
  getToken() {
    return this.getJwtToken();
  }

  /**
   * Get user info
   */
  getUserInfo() {
    return {
      id: this.userId,
      name: this.userName,
      email: this.userEmail,
    };
  }
}

// Create global instance
const fixedJwtAuth = new FixedJwtAuth();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FixedJwtAuth, fixedJwtAuth, AUTH_CONFIG };
} else {
  // Browser environment - attach to window
  window.fixedJwtAuth = fixedJwtAuth;
  window.AUTH_CONFIG = AUTH_CONFIG;
}

console.log('[Auth] Sanctum auth module loaded');
