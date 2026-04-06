/**
 * Extension Configuration
 * Central place for all configurable values.
 */

const CONFIG = {
  // Set to false to silence all console output in production
  DEBUG: true,

  // Web app base URL (no trailing slash)
  WEB_APP_URL: 'http://localhost:8000',

  // API base URL
  API_BASE_URL: 'http://localhost:8000/api',

  // Allowed origins for external message validation
  ALLOWED_ORIGINS: [
    'http://localhost:8000',
    'https://localhost:8000',
    'http://127.0.0.1:8000',
    'https://127.0.0.1:8000'
  ],

  // Tab query patterns to find webapp tabs
  WEB_APP_TAB_PATTERNS: [
    'http://localhost:8000/*',
    'http://127.0.0.1:8000/*'
  ],

  // Support link
  SUPPORT_URL: 'https://example.com/support'
};

// Silence all console output when DEBUG is false
if (!CONFIG.DEBUG) {
  const noop = () => {};
  console.log = noop;
  console.warn = noop;
  console.info = noop;
  console.debug = noop;
  // Keep console.error in production for critical issues
}
