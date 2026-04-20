/**
 * MESSENGER CRM EXTENSION - COMPLETE POPUP INTERFACE
 *
 * Features:
 * - Sanctum token authentication (Laravel backend)
 * - All original functionality: tags, contacts, bulk messaging, export, templates
 */

/* ===============================
   JWT AUTHENTICATION STATE
   =============================== */

let authState = {
  currentView: 'loading', // loading, welcome, jwt, authenticated
  isAuthenticated: false,
  userId: null,
  userName: null,
  userEmail: null,
  deviceId: null,
  isLoading: true,
  error: null
};

/* ===============================
   APPLICATION STATE DEFINITION
   =============================== */

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

const state = {
  tags: [],
  contacts: [],
  selectedTagId: null,
  checkedTagIds: new Set(),
  templates: [],
  currentTemplateIndex: 0,
  bulkSendProgress: {
    isActive: false,
    currentIndex: 0,
    totalCount: 0,
    successCount: 0,
    failureCount: 0,
    startTime: null
  }
};

let searchTerm = '';

/* ===============================
   UTILITY FUNCTIONS
   =============================== */

const $ = id => document.getElementById(id);

function genId() {
  return 't' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function toast(msg, ok = true) {
  const t = document.createElement('div');
  t.className = 'toast ' + (ok ? 'ok' : 'err');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/* ===============================
   UNIFIED STORAGE MANAGER - JWT Compatible
   =============================== */

class StorageManager {
    constructor() {
        this.cache = new Map();
        this.syncQueue = [];
        this.isSyncing = false;
        this.lastSync = 0;
        this.syncDebounceTimeout = null;
        this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration
        this.VERSION_KEY_PREFIX = '_version_';
        this.SYNC_TIME_KEY_PREFIX = '_sync_time_';
    }
    
    /**
     * Smart cache checking - works with JWT auth
     */
    async shouldRefreshFromCloud(key, forceRefresh = false) {
        if (forceRefresh) return true;
        if (!authState.isAuthenticated) return false;
        
        const syncTimeKey = this.SYNC_TIME_KEY_PREFIX + key;
        const result = await chrome.storage.local.get([syncTimeKey]);
        const lastSyncTime = result[syncTimeKey];
        
        if (!lastSyncTime) return true; // Never synced before
        
        const timeSinceSync = Date.now() - lastSyncTime;
        const shouldRefresh = timeSinceSync > this.CACHE_DURATION;
        
        console.log(`[StorageManager] ${key} cache check:`, {
            timeSinceSync: Math.round(timeSinceSync / 1000) + 's',
            shouldRefresh,
            cacheValid: !shouldRefresh
        });
        
        return shouldRefresh;
    }
    
    /**
     * Get data with smart caching - JWT compatible
     */
    async getWithSmartCache(key, forceRefresh = false) {
        const shouldRefresh = await this.shouldRefreshFromCloud(key, forceRefresh);
        
        if (!shouldRefresh) {
            // Use cached data
            const cachedData = await this.load(key);
            if (cachedData !== null) {
                console.log(`[StorageManager] Using cached ${key} data`);
                return cachedData;
            }
        }
        
        // For JWT auth, we primarily use local storage
        // Cloud sync would go through JWT API endpoints here
        console.log(`[StorageManager] Loading ${key} from local storage`);
        return await this.load(key);
    }
    
    /**
     * Save data with timestamp
     */
    async saveWithTimestamp(key, data) {
        const syncTimeKey = this.SYNC_TIME_KEY_PREFIX + key;
        const saveData = {
            [key]: data,
            [syncTimeKey]: Date.now()
        };
        
        await chrome.storage.local.set(saveData);
        this.cache.set(key, data);
        return { success: true };
    }
    
    /**
     * Invalidate cache for a specific key
     */
    async invalidateCache(key) {
        const syncTimeKey = this.SYNC_TIME_KEY_PREFIX + key;
        await chrome.storage.local.remove([syncTimeKey]);
        this.cache.delete(key);
        console.log(`[StorageManager] Invalidated cache for ${key}`);
    }
    
    /**
     * Batch save method
     */
    async saveBatch(dataBundle, options = {}) {
        const { priority = 'normal' } = options;
        
        try {
            // Single storage operation
            await chrome.storage.local.set({
                ...dataBundle,
                lastSync: Date.now()
            });
            
            // Update cache
            for (const [key, data] of Object.entries(dataBundle)) {
                this.cache.set(key, data);
            }
            
            return { success: true };
        } catch (error) {
            console.error('[Storage] Batch save failed:', error);
            return { success: false, error: error.message };
        }
    }
    
    async save(key, data, options = {}) {
        return this.saveBatch({ [key]: data }, options);
    }
    
    /**
     * Load data from storage
     */
    async load(key) {
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        
        try {
            const result = await chrome.storage.local.get([key]);
            if (result[key]) {
                this.cache.set(key, result[key]);
                return result[key];
            }
            return null;
        } catch (error) {
            console.error(`[Storage] Load failed for ${key}:`, error);
            return null;
        }
    }
    
    /**
     * Queue sync operation
     */
    queueSync(key, data, priority = 'normal') {
        const existingIndex = this.syncQueue.findIndex(item => item.key === key);
        const syncItem = { key, data, priority, timestamp: Date.now() };
        
        if (existingIndex !== -1) {
            this.syncQueue[existingIndex] = syncItem;
        } else {
            this.syncQueue.push(syncItem);
        }
        
        this.debouncedProcessQueue();
    }
    
    debouncedProcessQueue = debounce(() => {
        if (!this.isSyncing && this.syncQueue.length > 0) {
            this.processQueue();
        }
    }, 1000);
    
    async processQueue() {
        if (this.isSyncing || this.syncQueue.length === 0) return;
        
        this.isSyncing = true;
        console.log(`[StorageManager] Processing ${this.syncQueue.length} queued operations`);
        
        // Process all queued operations
        while (this.syncQueue.length > 0) {
            const item = this.syncQueue.shift();
            try {
                await this.saveWithTimestamp(item.key, item.data);
            } catch (error) {
                console.error(`[StorageManager] Queue processing failed for ${item.key}:`, error);
            }
        }
        
        this.isSyncing = false;
        this.lastSync = Date.now();
    }
}

// Create storage manager instance
const storageManager = new StorageManager();

/* ===============================
   DATA MANAGEMENT FUNCTIONS
   =============================== */

// Add friend request state
const friendRequestState = {
  stats: {
    total: 0,
    pending: 0,
    accepted: 0
  },
  requests: []
};

async function loadState() {
    try {
        console.log('[Popup] Loading application state...');
        
        const keys = ['tags', 'contacts', 'templates', 'currentTemplateIndex', 'friendRequests', 'friendRequestStats'];
        const result = await chrome.storage.local.get(keys);
        
        if (result.tags && Array.isArray(result.tags)) {
            state.tags = result.tags;
        }
        
        if (result.contacts && Array.isArray(result.contacts)) {
            state.contacts = result.contacts;
        }
        
        if (result.templates) {
            if (Array.isArray(result.templates)) {
                state.templates = result.templates;
            } else if (result.templates.templates) {
                // Handle template object format
                state.templates = result.templates.templates;
                state.currentTemplateIndex = result.templates.currentIndex || 0;
            }
        }
        
        if (typeof result.currentTemplateIndex === 'number') {
            state.currentTemplateIndex = result.currentTemplateIndex;
        }
        
        // Load friend request data
        if (result.friendRequests && Array.isArray(result.friendRequests)) {
            friendRequestState.requests = result.friendRequests;
        }
        
        if (result.friendRequestStats) {
            friendRequestState.stats = {
                ...friendRequestState.stats,
                ...result.friendRequestStats
            };
        }
        
        console.log('[Popup] State loaded successfully');
        return true;
    } catch (error) {
        console.error('[Popup] Failed to load state:', error);
        return false;
    }
}

/**
 * Fetch all user data from the backend API.
 * Called after login to populate local storage on a fresh browser.
 */
async function fetchDataFromBackend() {
    try {
        if (!window.fixedJwtAuth?.token) return false;

        console.log('[Popup] Fetching data from backend API...');

        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/poll`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${window.fixedJwtAuth.token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            console.warn('[Popup] Backend fetch failed:', response.status);
            return false;
        }

        const result = await response.json();
        if (!result.success || !result.data) return false;

        const { tags, contacts, templates, friendRequests, user } = result.data;

        // Sync user name/email from backend (keeps extension in sync after profile changes)
        if (user?.name && user.name !== window.fixedJwtAuth.userName) {
            window.fixedJwtAuth.userName = user.name;
            authState.userName = user.name;
            await chrome.storage.local.set({ [AUTH_CONFIG.STORAGE_KEYS.USER_NAME]: user.name });
            updateUserProfile();
        }
        if (user?.email && user.email !== window.fixedJwtAuth.userEmail) {
            window.fixedJwtAuth.userEmail = user.email;
            authState.userEmail = user.email;
            await chrome.storage.local.set({ [AUTH_CONFIG.STORAGE_KEYS.USER_EMAIL]: user.email });
            updateUserProfile();
        }

        // Merge into local state
        if (Array.isArray(tags) && tags.length > 0) {
            // Merge: keep any local-only tags that haven't synced to backend yet (dedup by id AND name)
            const backendTagIds = new Set(tags.map(t => t.id));
            const backendTagNames = new Set(tags.map(t => (t.name || '').toLowerCase()));
            const localOnly = state.tags.filter(t =>
                !backendTagIds.has(t.id) && !backendTagNames.has((t.name || '').toLowerCase())
            );
            state.tags = [...tags, ...localOnly];
        }
        if (Array.isArray(contacts) && contacts.length > 0) {
            // Backend is source of truth for contacts and their tags.
            // Only keep local-only contacts (not yet synced to backend).
            const backendIds = new Set(contacts.map(c => c.id));
            const backendUserIds = new Set(contacts.map(c => c.userId).filter(Boolean));
            const localOnlyContacts = state.contacts.filter(c =>
                !backendIds.has(c.id) && !(c.userId && backendUserIds.has(c.userId))
            );
            state.contacts = [...contacts, ...localOnlyContacts];
        }
        if (Array.isArray(templates) && templates.length > 0) state.templates = templates;
        if (Array.isArray(friendRequests) && friendRequests.length > 0) {
            friendRequestState.requests = friendRequests;
        }

        // Persist to local storage
        await chrome.storage.local.set({
            tags: state.tags,
            contacts: state.contacts,
            templates: state.templates,
            friendRequests: friendRequestState.requests,
        });

        console.log('[Popup] Backend data loaded:', {
            tags: state.tags.length,
            contacts: state.contacts.length,
            templates: state.templates.length,
            friendRequests: friendRequestState.requests.length,
        });

        return true;
    } catch (error) {
        console.error('[Popup] fetchDataFromBackend failed:', error);
        return false;
    }
}

async function saveState(priority = 'normal') {
    try {
        const dataToSave = {
            tags: state.tags,
            contacts: state.contacts,
            templates: state.templates,
            currentTemplateIndex: state.currentTemplateIndex
        };
        
        await storageManager.saveBatch(dataToSave, { priority });
        console.log('[Popup] State saved successfully');
        
        // Sync to backend API (always works, even if webapp is closed)
        try {
            await syncToBackend();
        } catch (error) {
            console.warn('[Popup] Backend sync failed:', error.message);
        }

        // Also sync to open webapp tabs for live updates
        try {
            await syncToWebApp();
        } catch (error) {
            console.log('[Popup] Webapp tab sync failed:', error.message);
        }
        
        // Also notify background script to handle sync in case popup closes
        chrome.runtime.sendMessage({
            type: 'DATA_CHANGED',
            payload: dataToSave
        }).catch(() => {
            // Popup might be closing, this is expected
            console.log('[Popup] Background script notification sent');
        });
        
        return { success: true };
    } catch (error) {
        console.error('[Popup] Failed to save state:', error);
        return { success: false, error: error.message };
    }
}

/* ===============================
   SYNC TO BACKEND API
   =============================== */

async function syncToBackend() {
    const token = window.fixedJwtAuth?.token;
    if (!token) return;

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    try {
        // Sync tags first and wait for confirmation — contacts reference tags,
        // so the backend must have them before we sync contacts
        if (state.tags.length > 0) {
            const tagResp = await fetch(`${AUTH_CONFIG.API_BASE_URL}/tags/sync`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ tags: state.tags }),
            });
            const tagResult = await tagResp.json();
            if (!tagResult.success) {
                console.warn('[Popup] Tag sync failed:', tagResult);
            }
        }

        // Now sync contacts and templates in parallel (tags are guaranteed in backend)
        const promises = [];
        if (state.contacts.length > 0) {
            promises.push(fetch(`${AUTH_CONFIG.API_BASE_URL}/contacts/sync`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ contacts: state.contacts }),
            }));
        }
        if (state.templates.length > 0) {
            promises.push(fetch(`${AUTH_CONFIG.API_BASE_URL}/templates/sync`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ templates: state.templates }),
            }));
        }
        if (promises.length > 0) await Promise.all(promises);

        console.log('[Popup] Backend sync completed');
    } catch (error) {
        console.warn('[Popup] Backend sync failed:', error.message);
    }
}

/* ===============================
   EXTENSION TO WEB APP SYNC
   =============================== */

async function syncToWebApp() {
    try {
        console.log('[Popup] 🔄 Syncing changes to web app...', {
            tags: state.tags.length,
            contacts: state.contacts.length,
            templates: state.templates.length,
            authenticated: authState.isAuthenticated
        });
        
        // Check if web app is open and accessible
        const tabs = await chrome.tabs.query({ url: CONFIG.WEB_APP_TAB_PATTERNS });

        if (tabs.length === 0) {
            console.log('[Popup] ❌ Web app not open, skipping sync to web app');
            return;
        }
        
        console.log('[Popup] ✅ Found', tabs.length, 'web app tabs');
        
        // Send tags first so they exist before contacts reference them
        await syncDataToWebApp('SYNC_TAGS_FROM_EXTENSION', state.tags);
        console.log('[Popup] ✅ Tags synced, now syncing contacts & templates');

        // Contacts and templates can sync in parallel
        await Promise.all([
            syncDataToWebApp('SYNC_CONTACTS_FROM_EXTENSION', state.contacts),
            syncDataToWebApp('SYNC_TEMPLATES_FROM_EXTENSION', state.templates)
        ]);
        console.log('[Popup] ✅ Successfully synced all data to web app');
        
    } catch (error) {
        console.error('[Popup] ❌ Failed to sync to web app:', error);
    }
}

async function syncDataToWebApp(messageType, data) {
    try {
        console.log(`[Popup] 📤 Sending ${messageType} with ${data.length} items`);
        
        const tabs = await chrome.tabs.query({ url: CONFIG.WEB_APP_TAB_PATTERNS });

        if (tabs.length === 0) {
            console.log(`[Popup] ❌ No web app tabs found for ${messageType}`);
            return;
        }
        
        for (const tab of tabs) {
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    type: messageType,
                    payload: data,
                    source: 'crm-extension'
                });
                console.log(`[Popup] ✅ Sent ${messageType} to web app tab ${tab.id} with ${data.length} items`);
            } catch (error) {
                console.log(`[Popup] ❌ Could not send ${messageType} to tab ${tab.id}:`, error.message);
            }
        }
    } catch (error) {
        console.error(`[Popup] ❌ Error syncing ${messageType}:`, error);
    }
}

/* ===============================
   FACEBOOK ACCOUNT VALIDATION
   =============================== */

/**
 * Validate current Facebook account against backend
 * Uses the same logic as content scripts
 */
async function validateFacebookAccount() {
  try {
    console.log('[Popup] Validating Facebook account...');

    // Check if we have a cached valid account from auto-link
    // Only use cache if it's recent (less than 5 minutes old)
    const cachedData = await chrome.storage.local.get(['validatedFacebookAccount']);
    if (cachedData.validatedFacebookAccount && cachedData.validatedFacebookAccount.valid) {
      const cacheAge = Date.now() - (cachedData.validatedFacebookAccount.validatedAt || 0);
      const maxCacheAge = 60 * 1000; // 1 minute

      if (cacheAge < maxCacheAge) {
        console.log('[Popup] ✅ Using cached Facebook account validation (age: ' + Math.round(cacheAge/1000) + 's):', cachedData.validatedFacebookAccount.accountName);
        return {
          valid: true,
          accountName: cachedData.validatedFacebookAccount.accountName || 'Facebook User',
          facebookUserId: cachedData.validatedFacebookAccount.facebookUserId
        };
      } else {
        console.log('[Popup] ⚠️ Cached validation is stale (age: ' + Math.round(cacheAge/1000) + 's), re-validating...');
      }
    }

    // Get JWT token from storage
    const storage = await chrome.storage.local.get(['crmFixedJwtToken']);
    const jwtToken = storage.crmFixedJwtToken;

    if (!jwtToken) {
      return {
        valid: false,
        error: 'No JWT token found. Please authenticate first.',
        code: 'NO_JWT'
      };
    }

    // Get Facebook user ID from active tab's cookies
    const facebookUserId = await getFacebookUserIdFromTab();

    if (!facebookUserId) {
      return {
        valid: false,
        error: 'Could not detect Facebook account. Please make sure you are logged into Facebook in an open tab.',
        code: 'NO_FB_USER'
      };
    }

    console.log('[Popup] Validating FB user ID:', facebookUserId);

    // Validate with backend
    const apiUrl = `${CONFIG.API_BASE_URL}/facebook-accounts/validate`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({ facebookUserId })
    });

    const data = await response.json();

    if (data.success) {
      console.log('[Popup] ✅ Facebook account validated:', data.data.accountName);

      // Cache validation result
      await chrome.storage.local.set({
        facebookAccountLinked: true,
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
      console.warn('[Popup] ❌ Facebook validation failed:', data.error);

      // Clear any stale cached validation so the linking page shows correctly
      await chrome.storage.local.remove(['facebookAccountLinked', 'validatedFacebookAccount']);

      return {
        valid: false,
        error: data.error,
        code: data.code
      };
    }

  } catch (error) {
    console.error('[Popup] Facebook validation error:', error);
    return {
      valid: false,
      error: 'Failed to validate Facebook account: ' + error.message,
      code: 'VALIDATION_ERROR'
    };
  }
}

/**
 * Get Facebook user ID from active tab cookies
 */
async function getFacebookUserIdFromTab() {
  try {
    // Try to get c_user cookie from Facebook domains
    const domains = [
      'https://www.facebook.com',
      'https://m.facebook.com'
    ];

    for (const domain of domains) {
      try {
        const cookie = await chrome.cookies.get({
          url: domain,
          name: 'c_user'
        });

        if (cookie && cookie.value) {
          console.log('[Popup] Found Facebook user ID from cookie:', cookie.value);
          return cookie.value;
        }
      } catch (err) {
        console.log('[Popup] Could not read cookie from', domain, err);
      }
    }

    console.warn('[Popup] No c_user cookie found');
    return null;

  } catch (error) {
    console.error('[Popup] Error getting Facebook user ID:', error);
    return null;
  }
}

/**
 * Show Facebook account warning banner (non-blocking)
 */
/**
 * Show dedicated Facebook linking page (full screen)
 */
function showFacebookLinkingPage(errorCode) {
  const mainInterface = document.getElementById('mainInterface');
  const authModal = document.getElementById('authModal');

  if (mainInterface) mainInterface.style.display = 'none';
  if (authModal) authModal.style.display = 'none';

  // Remove existing page if any
  const existingPage = document.getElementById('fbLinkingPage');
  if (existingPage) {
    existingPage.remove();
  }

  const message = errorCode === 'NO_FB_USER'
    ? 'Link Your Facebook Account'
    : 'Link Your Facebook Account';

  const description = errorCode === 'NO_FB_USER'
    ? 'To use the full features of this extension, please link your Facebook account.'
    : 'Your Facebook account needs to be linked to continue using Messenger features.';

  const page = document.createElement('div');
  page.id = 'fbLinkingPage';
  page.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    color: white;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  page.innerHTML = `
    <div style="text-align: center; max-width: 400px;">
      <!-- Facebook Icon -->
      <div style="margin-bottom: 24px;">
        <svg width="80" height="80" fill="white" viewBox="0 0 24 24">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
      </div>

      <!-- Title -->
      <h1 style="font-size: 28px; font-weight: 700; margin: 0 0 12px 0;">
        ${escapeHtml(message)}
      </h1>

      <!-- Description -->
      <p style="font-size: 16px; opacity: 0.9; margin: 0 0 32px 0; line-height: 1.5;">
        ${escapeHtml(description)}
      </p>

      <!-- Instructions -->
      <div style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin-bottom: 32px; text-align: left;">
        <div style="font-weight: 600; margin-bottom: 12px; font-size: 14px;">How it works:</div>
        <ol style="margin: 0; padding-left: 20px; font-size: 14px; opacity: 0.9; line-height: 1.8;">
          <li>Click the button below to open Facebook</li>
          <li>Make sure you're logged into Facebook</li>
          <li>Your account will be linked automatically</li>
          <li>Come back here and reopen the extension</li>
        </ol>
      </div>

      <!-- Open Facebook Button -->
      <button id="linkFacebookMainBtn" style="
        background: white;
        color: #667eea;
        border: none;
        border-radius: 8px;
        padding: 16px 48px;
        cursor: pointer;
        font-weight: 700;
        font-size: 16px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transition: all 0.2s;
        width: 100%;
        max-width: 280px;
      " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(0,0,0,0.2)'"
         onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'">
        <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24" style="vertical-align: middle; margin-right: 8px;">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
        Open Facebook
      </button>

      <!-- Sign Out Link -->
      <div style="margin-top: 24px;">
        <button id="signOutFromLinkingBtn" style="
          background: transparent;
          border: none;
          color: white;
          opacity: 0.7;
          cursor: pointer;
          font-size: 13px;
          text-decoration: underline;
          padding: 8px;
        " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">
          Sign out instead
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(page);

  // Open Facebook button
  document.getElementById('linkFacebookMainBtn').onclick = () => {
    chrome.tabs.create({ url: 'https://www.facebook.com' });
  };

  // Sign out button
  document.getElementById('signOutFromLinkingBtn').onclick = async () => {
    await handleSignOut();
    page.remove();
  };
}

function showFacebookLinkPrompt(errorCode) {
  // Remove existing banner if any
  const existingBanner = document.getElementById('fbLinkPrompt');
  if (existingBanner) {
    existingBanner.remove();
  }

  const banner = document.createElement('div');
  banner.id = 'fbLinkPrompt';
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-bottom: 2px solid #5a67d8;
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 9999;
    font-size: 13px;
    color: white;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  `;

  const message = errorCode === 'NO_FB_USER'
    ? 'Link your Facebook account to unlock full extension features'
    : 'Link your Facebook account to use Messenger features';

  banner.innerHTML = `
    <svg width="24" height="24" fill="white" viewBox="0 0 24 24">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
    <div style="flex: 1;">
      <div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(message)}</div>
      <div style="font-size: 12px; opacity: 0.9;">Click the button to open Facebook and link your account automatically</div>
    </div>
    <button id="linkFacebookBtn" style="
      background: white;
      color: #667eea;
      border: none;
      border-radius: 6px;
      padding: 10px 20px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      transition: all 0.2s;
    " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
      Open Facebook
    </button>
    <button id="closeLinkPromptBtn" style="
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: white;
      opacity: 0.7;
    ">
      <svg width="16" height="16" fill="white" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
      </svg>
    </button>
  `;

  document.body.appendChild(banner);

  document.getElementById('linkFacebookBtn').onclick = () => {
    // Open Facebook in a new tab
    chrome.tabs.create({ url: 'https://www.facebook.com' });
  };

  document.getElementById('closeLinkPromptBtn').onclick = () => {
    banner.remove();
  };
}

function showFacebookWarningBanner(message) {
  // Remove existing banner if any
  const existingBanner = document.getElementById('fbWarningBanner');
  if (existingBanner) {
    existingBanner.remove();
  }

  const banner = document.createElement('div');
  banner.id = 'fbWarningBanner';
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #fef3c7;
    border-bottom: 1px solid #f59e0b;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 9999;
    font-size: 13px;
    color: #92400e;
  `;

  banner.innerHTML = `
    <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
      <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
    </svg>
    <span style="flex: 1;">${escapeHtml(message)}</span>
    <button id="closeBannerBtn" style="
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: currentColor;
      opacity: 0.7;
    ">
      <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
      </svg>
    </button>
  `;

  document.body.appendChild(banner);

  document.getElementById('closeBannerBtn').onclick = () => {
    banner.remove();
  };
}

/**
 * Show Facebook account validation error (blocking modal)
 * Only used for critical errors like deactivated accounts
 */
function showFacebookAccountError(errorMessage, errorCode) {
  const errorMessages = {
    'NO_JWT': 'Please authenticate with your JWT token first.',
    'NO_FB_USER': 'Could not detect your Facebook account. Please:\n1. Open facebook.com/messages in a tab\n2. Make sure you are logged in\n3. Reopen this popup',
    'ACCOUNT_NOT_LINKED': 'This Facebook account is not linked to your CRM.\n\nPlease:\n1. Go to the CRM webapp\n2. Navigate to "Facebook Accounts"\n3. Add this Facebook account\n4. Reopen this popup',
    'ACCOUNT_DEACTIVATED': 'This Facebook account has been deactivated in the CRM.\n\nPlease contact your administrator or re-add the account in the webapp.',
    'INVALID_JWT': 'Your CRM authentication has expired.\n\nPlease get a new JWT token from the webapp and re-authenticate.',
    'VALIDATION_ERROR': 'Failed to validate account. Please check your internet connection and try again.'
  };

  const message = errorMessages[errorCode] || errorMessage;

  // Show error in a modal/alert
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 20px;
  `;

  errorDiv.innerHTML = `
    <div style="
      background: white;
      border-radius: 8px;
      padding: 24px;
      max-width: 400px;
      text-align: center;
    ">
      <div style="
        width: 48px;
        height: 48px;
        background: #fee;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 16px;
      ">
        <svg width="24" height="24" fill="#e11d48" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
        </svg>
      </div>
      <h3 style="margin: 0 0 12px; font-size: 18px; color: #111;">Facebook Account Not Validated</h3>
      <p style="margin: 0 0 20px; color: #666; white-space: pre-line; line-height: 1.5;">${escapeHtml(message)}</p>
      <button id="closeErrorBtn" style="
        background: #3b82f6;
        color: white;
        border: none;
        padding: 10px 24px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">Close</button>
    </div>
  `;

  document.body.appendChild(errorDiv);

  document.getElementById('closeErrorBtn').onclick = () => {
    errorDiv.remove();
  };
}

/* ===============================
   JWT AUTHENTICATION HANDLERS
   =============================== */

async function initializeAuthentication() {
  console.log('[Popup] Initializing JWT authentication...');

  try {
    // Initialize fixed JWT auth service
    await window.fixedJwtAuth.init();

    if (window.fixedJwtAuth.isAuthenticated) {
      // Already authenticated with JWT
      authState.isAuthenticated = true;
      authState.userId = window.fixedJwtAuth.userId;
      authState.userName = window.fixedJwtAuth.userName;
      authState.userEmail = window.fixedJwtAuth.userEmail;
      authState.deviceId = window.fixedJwtAuth.deviceId;
      authState.currentView = 'authenticated';

      console.log('[Popup] Already authenticated:', authState.userId);

      // **Check Facebook account status before showing interface**
      const fbValidation = await validateFacebookAccount();

      if (!fbValidation.valid) {
        console.warn('[Popup] Facebook account validation failed:', fbValidation.error, '(Code:', fbValidation.code, ')');

        // Show dedicated Facebook linking page instead of main interface
        if (fbValidation.code === 'NO_FB_USER' || fbValidation.code === 'ACCOUNT_NOT_LINKED' || fbValidation.code === 'NO_JWT') {
          showFacebookLinkingPage(fbValidation.code);
          return; // Don't show main interface
        }

        // For other errors, show interface with warning
        showMainInterface();
        await loadUserData();
        showFacebookLinkPrompt(fbValidation.code);
        return;
      }

      // Facebook account is linked - show main interface
      console.log('[Popup] Facebook account validated:', fbValidation.accountName);
      showMainInterface();
      await loadUserData();
    } else {
      // Show welcome screen
      authState.currentView = 'welcome';
      authState.isAuthenticated = false;
      showAuthModal();
    }

  } catch (error) {
    console.error('[Popup] Authentication initialization failed:', error);
    authState.currentView = 'welcome';
    authState.error = 'Authentication initialization failed';
    showAuthModal();
  }

  authState.isLoading = false;
  updateAuthUI();
}

async function handleJWTAuthentication(authKey) {
  console.log('[Popup] Attempting auth key authentication...');

  const submitBtn = document.getElementById('jwtSubmitBtn');
  const errorDiv = document.getElementById('authError');

  // Update UI state
  submitBtn.textContent = 'Authenticating...';
  submitBtn.disabled = true;
  errorDiv.style.display = 'none';

  try {
    // Authenticate with auth key — server returns device-specific token
    const result = await window.fixedJwtAuth.authenticateWithAuthKey(authKey);
    
    console.log('[Popup] Auth key authentication successful');

    authState.isAuthenticated = true;
    authState.userId = result.user?.id || window.fixedJwtAuth.userId;
    authState.userName = result.user?.name || window.fixedJwtAuth.userName;
    authState.userEmail = result.user?.email || window.fixedJwtAuth.userEmail;
    authState.deviceId = result.device?.deviceId || window.fixedJwtAuth.deviceId;
    authState.currentView = 'authenticated';
    authState.error = null;

    // Validate Facebook account before showing main interface
    const fbValidation = await validateFacebookAccount();
    if (!fbValidation.valid) {
      if (fbValidation.code === 'NO_FB_USER' || fbValidation.code === 'ACCOUNT_NOT_LINKED' || fbValidation.code === 'NO_JWT') {
        showFacebookLinkingPage(fbValidation.code);
        return;
      }
      showMainInterface();
      await loadUserData();
      showFacebookLinkPrompt(fbValidation.code);
      return;
    }

    showMainInterface();
    await loadUserData();
    updateTokenExpiryDisplay();

  } catch (error) {
    console.error('[Popup] JWT authentication failed:', error);
    
    authState.error = error.message;
    showAuthError(error.message);
    
    // Handle specific error types
    if (error.message.includes('Device limit reached')) {
      showAuthError(
        'Device limit reached (4/4). Please revoke a device from the web dashboard before adding this one.'
      );
    }
    
  } finally {
    submitBtn.textContent = 'Authenticate';
    submitBtn.disabled = false;
  }
}

function showAuthError(message) {
  const errorDiv = document.getElementById('authError');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }
}

function hideAuthError() {
  const errorDiv = document.getElementById('authError');
  if (errorDiv) {
    errorDiv.style.display = 'none';
  }
}

async function handleSignOut() {
  try {
    console.log('[Popup] Signing out...');
    
    const userMenuBtn = document.getElementById('userMenuBtn');
    const userDropdown = document.getElementById('userDropdown');
    
    // Close dropdown
    if (userDropdown) userDropdown.style.display = 'none';
    if (userMenuBtn) userMenuBtn.classList.remove('open');

    // Call fixedJwtAuth.logout() which revokes Sanctum token AND device on server,
    // then clears local credentials. This is the correct logout flow.
    try {
      await window.fixedJwtAuth.logout();
      console.log('[Popup] Server-side logout completed (token + device revoked)');
    } catch (error) {
      console.error('[Popup] Error during server-side logout:', error);
      // Still clear local credentials even if server call fails
      await window.fixedJwtAuth.clearCredentials();
    }

    // Clear validation errors (important!)
    await chrome.storage.local.remove(['validationError', 'validatedFacebookAccount']);

    // Clear auth state
    authState.isAuthenticated = false;
    authState.userId = null;
    authState.userName = null;
    authState.userEmail = null;
    authState.deviceId = null;
    authState.currentView = 'welcome';
    authState.error = null;

    // Reset state
    state.tags = [];
    state.contacts = [];
    state.selectedTagId = null;
    state.checkedTagIds.clear();

    // Hide main interface and show auth modal
    const mainInterface = document.getElementById('mainInterface');
    if (mainInterface) mainInterface.style.display = 'none';

    showAuthModal();
    updateAuthUI();

    toast('Signed out successfully');

    console.log('[Popup] Sign out complete - auth modal shown');
    
  } catch (error) {
    console.error('[Popup] Sign out failed:', error);
    toast('Error signing out. Please try again.', false);
  }
}

async function handleSyncNow() {
  if (!authState.isAuthenticated) {
    toast('Sync is only available for authenticated users.', false);
    return;
  }
  
  try {
    updateSyncStatus('syncing');
    
    // For JWT version, just refresh local data
    await loadUserData();
    
    updateSyncStatus('synced');
    toast('Data synced successfully!');
    
  } catch (error) {
    console.error('[Popup] Manual sync failed:', error);
    updateSyncStatus('error');
    toast('Sync failed. Please try again.', false);
  }
}

function openWebDashboard() {
  chrome.tabs.create({ 
    url: `${CONFIG.WEB_APP_URL}/jwt-tokens`
  });
}

/* ===============================
   UI STATE MANAGEMENT
   =============================== */

function updateAuthUI() {
  const authModal = document.getElementById('authModal');
  const mainInterface = document.getElementById('mainInterface');
  
  if (authState.isLoading) {
    showAuthState('loading');
    return;
  }
  
  if (authState.isAuthenticated) {
    if (authModal) authModal.style.display = 'none';
    if (mainInterface) mainInterface.style.display = 'flex';
    updateUserProfile();
  } else {
    if (authModal) authModal.style.display = 'block';
    if (mainInterface) mainInterface.style.display = 'none';
    showAuthState(authState.currentView);
  }
}

function showAuthModal() {
  const authModal = document.getElementById('authModal');
  const mainInterface = document.getElementById('mainInterface');
  
  if (authModal) authModal.style.display = 'block';
  if (mainInterface) mainInterface.style.display = 'none';
  
  updateAuthUI();
}

function showMainInterface() {
  const authModal = document.getElementById('authModal');
  const mainInterface = document.getElementById('mainInterface');
  
  if (authModal) authModal.style.display = 'none';
  if (mainInterface) mainInterface.style.display = 'flex';
  
  updateAuthUI();
  startTokenExpiryUpdates(); // Start token expiry monitoring
}

function showAuthState(view) {
  // 'jwt' and 'welcome' are now the same combined page
  if (view === 'jwt') view = 'welcome';

  const states = ['loading', 'welcome', 'jwt'];

  states.forEach(state => {
    const element = document.getElementById(`auth${state.charAt(0).toUpperCase() + state.slice(1)}`);
    if (element) {
      element.style.display = view === state ? 'block' : 'none';
    }
  });
}

function updateUserProfile() {
  const userProfile = document.getElementById('userProfile');
  const userDisplayName = document.getElementById('userDisplayName');
  const userEmail = document.getElementById('userEmail');
  const userAvatar = document.getElementById('userAvatar');
  
  if (userProfile) {
    userProfile.style.display = 'block';
  }
  
  // Update display name — fall back to email prefix if name not stored
  if (userDisplayName) {
    const emailPrefix = authState.userEmail ? authState.userEmail.split('@')[0] : null;
    userDisplayName.textContent = authState.userName || emailPrefix || 'User';
  }

  // Update email info
  if (userEmail) {
    if (authState.userEmail) {
      userEmail.textContent = authState.userEmail;
      userEmail.style.display = 'block';
    } else {
      userEmail.style.display = 'none';
    }
  }

  // Update avatar with initial
  if (userAvatar) {
    const emailPrefix = authState.userEmail ? authState.userEmail.split('@')[0] : null;
    const initial = (authState.userName || emailPrefix || 'U').charAt(0).toUpperCase();
    userAvatar.textContent = initial;
    userAvatar.classList.remove('has-image');
  }
  
  // Update sync status
  updateSyncStatus('synced');
}

function updateSyncStatus(status) {
  const syncStatusDot = document.getElementById('syncStatusDot');
  const syncStatusText = document.getElementById('syncStatusText');
  
  if (!syncStatusDot || !syncStatusText) return;
  
  // Remove all status classes
  syncStatusDot.classList.remove('syncing', 'error', 'offline');
  const dropdownDot = document.getElementById('syncStatusDotDropdown');
  if (dropdownDot) dropdownDot.classList.remove('syncing', 'error', 'offline');
  
  switch (status) {
    case 'syncing':
      syncStatusDot.classList.add('syncing');
      syncStatusText.textContent = 'Syncing...';
      break;
    case 'error':
      syncStatusDot.classList.add('error');
      syncStatusText.textContent = 'Sync Error';
      break;
    case 'synced':
    default:
      syncStatusText.textContent = authState.isAuthenticated ? 'Synced' : 'Local Data';
      break;
  }
}

/* ===============================
   USER DROPDOWN MENU MANAGEMENT
   =============================== */

function setupUserDropdown() {
  const userMenuBtn = document.getElementById('userMenuBtn');
  const userDropdown = document.getElementById('userDropdown');
  const signOutBtn = document.getElementById('signOutBtn');
  
  if (userMenuBtn && userDropdown) {
    userMenuBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = userDropdown.style.display === 'block';
      
      if (isOpen) {
        userDropdown.style.display = 'none';
        userMenuBtn.classList.remove('open');
      } else {
        userDropdown.style.display = 'block';
        userMenuBtn.classList.add('open');
      }
    };
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!userMenuBtn.contains(e.target) && !userDropdown.contains(e.target)) {
        userDropdown.style.display = 'none';
        userMenuBtn.classList.remove('open');
      }
    });
  }
  
  const supportBtn = document.getElementById('supportBtn');
  if (supportBtn) {
    supportBtn.onclick = () => {
      userDropdown.style.display = 'none';
      userMenuBtn.classList.remove('open');
      chrome.tabs.create({ url: CONFIG.SUPPORT_URL });
    };
  }

  if (signOutBtn) {
    signOutBtn.onclick = () => {
      userDropdown.style.display = 'none';
      userMenuBtn.classList.remove('open');
      
      if (confirm('Are you sure you want to sign out?')) {
        handleSignOut();
      }
    };
  }
}

/* ===============================
   DATA LOADING FUNCTIONS
   =============================== */

async function loadUserData() {
  try {
    console.log('[Popup] Reloading user data...');

    // Reload data from local storage first
    await loadState();

    // Always fetch fresh data from backend so dashboard changes (new templates, tags, etc.)
    // are immediately visible in the extension popup
    await fetchDataFromBackend();

    // Update UI with loaded data
    renderTags();
    renderContacts();
    renderFriendRequestStats();
    updateTemplateUI();

    // Check if there's an ongoing friend request refresh
    checkOngoingRefresh();

    console.log('[Popup] User data reloaded successfully');

  } catch (error) {
    console.error('[Popup] Failed to reload user data:', error);
  }
}

/* ===============================
   TAG MANAGEMENT FUNCTIONS
   =============================== */

async function addTag(name, color) {
    try {
        console.log('[Popup] Adding tag:', { name, color });
        
        if (!name || !color) {
            toast('Name and color are required', false);
            return { success: false, error: 'Missing required fields' };
        }

        if (name.trim().length > 50) {
            toast('Tag name must be 50 characters or less', false);
            return { success: false, error: 'Tag name too long' };
        }

        const duplicate = state.tags.find(t => t.name.toLowerCase() === name.trim().toLowerCase());
        if (duplicate) {
            toast('Tag already exists', false);
            return { success: false, error: 'Tag already exists' };
        }

        const newTag = {
            id: genId(),
            name: name.trim(),
            color: color
        };
        
        state.tags.push(newTag);
        
        const result = await saveState('high');
        if (result.success) {
            renderTags();
            toast(`Tag "${name}" added successfully`);
            return { success: true, tag: newTag };
        } else {
            // Rollback on failure
            state.tags = state.tags.filter(t => t.id !== newTag.id);
            throw new Error(result.error);
        }
        
    } catch (error) {
        console.error('[Popup] addTag failed:', error);
        toast('Failed to add tag: ' + error.message, false);
        return { success: false, error: error.message };
    }
}

async function removeTag(id) {
    try {
        console.log('[Popup] Removing tag:', id);

        const tagToRemove = state.tags.find(t => t.id === id);
        if (!tagToRemove) {
            throw new Error('Tag not found');
        }

        // Delete from backend FIRST so re-fetches won't restore it
        if (window.fixedJwtAuth?.token) {
            const resp = await fetch(`${AUTH_CONFIG.API_BASE_URL}/tags/bulk-delete`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${window.fixedJwtAuth.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: [id] }),
            });
            const data = await resp.json();
            if (!data.success) console.warn('[Popup] Backend tag delete failed:', data.error);
        }

        // Remove tag from tags array
        state.tags = state.tags.filter(t => t.id !== id);

        // Remove tag from all contacts
        state.contacts.forEach(contact => {
            contact.tags = contact.tags.filter(tagId => tagId !== id);
        });

        // Update selected states
        if (state.selectedTagId === id) state.selectedTagId = null;
        state.checkedTagIds.delete(id);

        // Save to storage (suppress listener to avoid overwrite race)
        _suppressStorageListener = true;
        await storageManager.saveBatch({
            tags: state.tags,
            contacts: state.contacts,
            templates: state.templates,
            currentTemplateIndex: state.currentTemplateIndex
        }, { priority: 'high' });
        setTimeout(() => { _suppressStorageListener = false; }, 500);

        renderTags();
        renderContacts();
        toast(`Tag "${tagToRemove.name}" removed`);
        return { success: true };

    } catch (error) {
        console.error('[Popup] removeTag failed:', error);
        toast('Failed to remove tag: ' + error.message, false);
        return { success: false, error: error.message };
    }
}

/* ===============================
   TEMPLATE MANAGEMENT FUNCTIONS
   =============================== */

async function saveTemplate() {
    try {
        const nameInput = $('templateNameInput');
        const messageArea = $('bulkMessage');
        
        if (!nameInput || !messageArea) return;
        
        const name = nameInput.value.trim();
        const body = messageArea.value.trim();
        
        if (!name) {
            toast('Template name is required', false);
            return;
        }
        
        if (!body) {
            toast('Template message is required', false);
            return;
        }

        if (name.length > 50) {
            toast('Template name must be 50 characters or less', false);
            return;
        }

        if (body.length > 3000) {
            toast('Template message must be 3000 characters or less', false);
            return;
        }

        // Update current template or create new one
        if (state.currentTemplateIndex < state.templates.length) {
            // Update existing
            state.templates[state.currentTemplateIndex] = {
                ...state.templates[state.currentTemplateIndex],
                name,
                body
            };
        } else {
            // Create new
            const newTemplate = {
                id: 'template' + Date.now(),
                name,
                body
            };
            state.templates.push(newTemplate);
            state.currentTemplateIndex = state.templates.length - 1;
        }
        
        await saveState();
        updateTemplateUI();
        toast('Template saved successfully');
        
    } catch (error) {
        console.error('[Popup] Failed to save template:', error);
        toast('Failed to save template', false);
    }
}

async function deleteTemplate() {
    try {
        if (state.templates.length <= 1) {
            toast('Cannot delete the last template', false);
            return;
        }
        
        const templateToDelete = state.templates[state.currentTemplateIndex];
        if (!templateToDelete) return;
        
        state.templates.splice(state.currentTemplateIndex, 1);
        
        // Adjust current index
        if (state.currentTemplateIndex >= state.templates.length) {
            state.currentTemplateIndex = state.templates.length - 1;
        }
        
        await saveState();
        updateTemplateUI();
        setupTemplateNavigation();
        toast(`Template "${templateToDelete.name}" deleted`);
        
    } catch (error) {
        console.error('[Popup] Failed to delete template:', error);
        toast('Failed to delete template', false);
    }
}

function loadTemplate(idx) {
    if (idx >= 0 && idx < state.templates.length) {
        state.currentTemplateIndex = idx;
        updateTemplateUI();
        saveState();
    }
}

function setupTemplateNavigation() {
    const prevBtn = $('prevTemplate');
    const nextBtn = $('nextTemplate');
    const saveBtn = $('saveTemplateBtn');
    const deleteBtn = $('deleteTemplateBtn');
    const delaySlider = $('delaySlider');
    const delayVal = $('delayVal');
    
    if (prevBtn) {
        prevBtn.onclick = () => {
            state.currentTemplateIndex = (state.currentTemplateIndex - 1 + state.templates.length) % state.templates.length;
            loadTemplate(state.currentTemplateIndex);
            setupTemplateNavigation();
        };
    }
    
    if (nextBtn) {
        nextBtn.onclick = () => {
            state.currentTemplateIndex = (state.currentTemplateIndex + 1) % state.templates.length;
            loadTemplate(state.currentTemplateIndex);
            setupTemplateNavigation();
        };
    }
    
    if (saveBtn) {
        saveBtn.onclick = saveTemplate;
    }
    
    if (deleteBtn) {
        deleteBtn.onclick = deleteTemplate;
    }
    
    if (delaySlider && delayVal) {
        delaySlider.oninput = e => delayVal.textContent = e.target.value;
    }

    // Batch settings event listeners
    const batchSizeInput = $('batchSizeInput');
    const batchWaitInput = $('batchWaitInput');
    const batchInfo = $('batchInfo');
    const batchInfoText = $('batchInfoText');

    function updateBatchInfo() {
        const batchSize = batchSizeInput ? Number(batchSizeInput.value) || 0 : 0;
        const batchWait = batchWaitInput ? Number(batchWaitInput.value) || 5 : 5;

        if (batchSize > 0) {
            if (batchInfo) batchInfo.style.display = 'flex';
            if (batchInfoText) {
                batchInfoText.textContent = `Send ${batchSize} messages, then wait ${batchWait} minute${batchWait > 1 ? 's' : ''} before continuing.`;
            }
        } else {
            if (batchInfo) batchInfo.style.display = 'none';
        }
    }

    if (batchSizeInput) {
        batchSizeInput.oninput = updateBatchInfo;
    }

    if (batchWaitInput) {
        batchWaitInput.oninput = updateBatchInfo;
    }

    // Initialize batch info on modal open
    updateBatchInfo();
}

/* ===============================
   CONTACT MANAGEMENT FUNCTIONS
   =============================== */

async function removeContactsBulk(ids) {
    const CHUNK_SIZE = 50;
    if (!Array.isArray(ids) || ids.length === 0) {
        return { success: true, deleted: 0 };
    }

    const idSet = new Set(ids);
    const removed = state.contacts.filter(c => idSet.has(c.id));
    if (removed.length === 0) {
        toast('No matching contacts found', false);
        return { success: false, error: 'No matching contacts' };
    }

    let totalDeleted = 0;
    try {
        if (window.fixedJwtAuth?.token) {
            for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
                const chunk = ids.slice(i, i + CHUNK_SIZE);
                const resp = await fetch(`${AUTH_CONFIG.API_BASE_URL}/contacts/bulk-delete`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${window.fixedJwtAuth.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ ids: chunk }),
                });
                const data = await resp.json();
                if (!data.success) {
                    console.warn('[Popup] Backend bulk delete failed:', data.error);
                    throw new Error(data.error || 'Bulk delete failed');
                }
                totalDeleted += (typeof data.deleted === 'number' ? data.deleted : chunk.length);
            }
        }

        state.contacts = state.contacts.filter(c => !idSet.has(c.id));

        _suppressStorageListener = true;
        await storageManager.saveBatch({
            tags: state.tags,
            contacts: state.contacts,
            templates: state.templates,
            currentTemplateIndex: state.currentTemplateIndex
        }, { priority: 'high' });
        setTimeout(() => { _suppressStorageListener = false; }, 500);

        renderContacts();
        renderTags();
        toast(`Removed ${removed.length} contact${removed.length === 1 ? '' : 's'}`);
        return { success: true, deleted: totalDeleted };
    } catch (error) {
        console.error('[Popup] removeContactsBulk failed:', error);
        toast('Failed to remove contacts: ' + error.message, false);
        return { success: false, error: error.message };
    }
}

async function removeContact(id) {
    try {
        console.log('[Popup] Removing contact:', id);

        const contactToRemove = state.contacts.find(c => c.id === id);
        if (!contactToRemove) {
            throw new Error('Contact not found');
        }

        // Delete from backend FIRST so re-fetches won't restore it
        if (window.fixedJwtAuth?.token) {
            const resp = await fetch(`${AUTH_CONFIG.API_BASE_URL}/contacts/bulk-delete`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${window.fixedJwtAuth.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: [id] }),
            });
            const data = await resp.json();
            if (!data.success) console.warn('[Popup] Backend contact delete failed:', data.error);
        }

        // Remove contact from contacts array
        state.contacts = state.contacts.filter(c => c.id !== id);

        // Save to storage (suppress listener to avoid overwrite race)
        _suppressStorageListener = true;
        await storageManager.saveBatch({
            tags: state.tags,
            contacts: state.contacts,
            templates: state.templates,
            currentTemplateIndex: state.currentTemplateIndex
        }, { priority: 'high' });
        setTimeout(() => { _suppressStorageListener = false; }, 500);

        renderContacts();
        renderTags(); // Update tag counts
        toast(`Contact "${contactToRemove.name}" removed`);
        return { success: true };

    } catch (error) {
        console.error('[Popup] removeContact failed:', error);
        toast('Failed to remove contact: ' + error.message, false);
        return { success: false, error: error.message };
    }
}

/* ===============================
   BULK MESSAGING FUNCTIONS
   =============================== */

function updateProgressUI(progress) {
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressStats = document.getElementById('progressStats');
    
    if (!progress.isActive) {
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        return;
    }
    
    if (!progressContainer) {
        createProgressUI();
    }
    
    document.getElementById('progressContainer').style.display = 'block';
    
    const percentage = progress.totalCount > 0 ? (progress.currentIndex / progress.totalCount) * 100 : 0;
    document.getElementById('progressBar').style.width = `${percentage}%`;
    
    document.getElementById('progressText').textContent = 
        `Sending messages: ${progress.currentIndex} of ${progress.totalCount}`;
    
    const elapsed = progress.startTime ? Math.round((Date.now() - progress.startTime) / 1000) : 0;
    document.getElementById('progressStats').innerHTML = `
        <span class="success-count">✅ ${progress.successCount} sent</span>
        <span class="failure-count">❌ ${progress.failureCount} failed</span>
        <span class="elapsed-time">⏱️ ${elapsed}s elapsed</span>
    `;
    
    document.getElementById('cancelBulkBtn').disabled = false;
}

function createProgressUI() {
    // Check if progress UI already exists
    if (document.getElementById('progressContainer')) {
        console.log('[Popup] Progress UI already exists, skipping creation');
        return;
    }
    
    const progressHTML = `
        <div id="progressContainer" class="progress-container" style="display: none;">
            <div class="progress-header">
                <h3>Bulk Send Progress</h3>
                <button id="cancelBulkBtn" class="btn btn-secondary btn-small">Cancel</button>
            </div>
            <div class="progress-bar-container">
                <div id="progressBar" class="progress-bar"></div>
            </div>
            <div id="progressText" class="progress-text">Preparing to send...</div>
            <div id="progressStats" class="progress-stats"></div>
        </div>
    `;
    
    const header = document.querySelector('.header-modern');
    if (header) {
        header.insertAdjacentHTML('afterend', progressHTML);
        console.log('[Popup] Progress UI created');
    } else {
        // Fallback: append to body if header not found
        document.body.insertAdjacentHTML('beforeend', progressHTML);
        console.log('[Popup] Progress UI created (fallback to body)');
    }
    
    // Set up cancel button event listener
    const cancelBtn = document.getElementById('cancelBulkBtn');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            if (confirm('Are you sure you want to cancel the bulk send operation?')) {
                chrome.runtime.sendMessage({ type: 'CANCEL_BULK_SEND' }, (response) => {
                    if (chrome.runtime.lastError) {
                        toast('Error cancelling bulk send', false);
                        return;
                    }
                    
                    if (response && response.cancelled) {
                        toast('Bulk send cancelled');
                        hideProgressUI();
                    } else {
                        toast('Could not cancel: ' + (response?.reason || 'Unknown error'), false);
                    }
                });
            }
        };
    }
}

function hideProgressUI() {
    const progressContainer = document.getElementById('progressContainer');
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
    
    // Stop progress polling when hiding UI
    if (progressPollInterval) {
        console.log('[Popup] Stopping progress polling due to UI hide');
        clearInterval(progressPollInterval);
        progressPollInterval = null;
    }
}

// Global variable to track polling state
let progressPollInterval = null;

function startProgressPolling() {
    // Prevent multiple polling intervals
    if (progressPollInterval) {
        console.log('[Popup] Progress polling already active');
        return;
    }
    
    console.log('[Popup] Starting progress polling');
    progressPollInterval = setInterval(() => {
        chrome.runtime.sendMessage({ type: 'GET_BULK_PROGRESS' }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('[Popup] Progress polling error:', chrome.runtime.lastError.message);
                return;
            }
            
            if (response && response.progress) {
                updateProgressUI(response.progress);
                
                if (!response.progress.isActive) {
                    console.log('[Popup] Bulk operation completed, stopping polling');
                    clearInterval(progressPollInterval);
                    progressPollInterval = null;
                }
            } else {
                console.log('[Popup] No progress response, stopping polling');
                clearInterval(progressPollInterval);
                progressPollInterval = null;
            }
        });
    }, 1000);
    
    // Safety timeout to prevent infinite polling
    setTimeout(() => {
        if (progressPollInterval) {
            console.log('[Popup] Progress polling timeout, stopping');
            clearInterval(progressPollInterval);
            progressPollInterval = null;
        }
    }, 600000); // 10 minutes max
}

/* ===============================
   BULK PROGRESS RESTORATION
   =============================== */

async function checkAndRestoreBulkProgress() {
    try {
        console.log('[Popup] Checking for active bulk operations...');
        
        // Request current bulk progress from background script
        chrome.runtime.sendMessage({ type: 'GET_BULK_PROGRESS' }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('[Popup] Could not get bulk progress:', chrome.runtime.lastError.message);
                return;
            }
            
            if (response && response.progress && response.progress.isActive) {
                console.log('[Popup] Active bulk operation detected, restoring progress UI');
                
                // Create progress UI if it doesn't exist
                if (!document.getElementById('progressContainer')) {
                    createProgressUI();
                }
                
                // Update the progress UI with current state
                updateProgressUI(response.progress);
                
                // Start polling for updates
                startProgressPolling();
                
            } else {
                console.log('[Popup] No active bulk operation found');
            }
        });
        
    } catch (error) {
        console.error('[Popup] Error checking bulk progress:', error);
    }
}

/* ===============================
   BULK MESSAGING MODAL
   =============================== */

function openBulkModal() {
    console.log('[CRM] Opening bulk modal...');
    
    const modal = document.getElementById('bulkModal');
    const tagsDiv = document.getElementById('bulkTags');
    
    if (!modal || !tagsDiv) {
        console.error('[CRM] Bulk modal elements not found!');
        toast('Bulk modal not found. Please refresh the page.', false);
        return;
    }
    
    tagsDiv.innerHTML = '';
    
    if (!state.tags || state.tags.length === 0) {
        tagsDiv.innerHTML = `
            <div style="text-align: center; padding: 30px 20px; background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px; color: #64748b;">
                <div style="font-size: 48px; margin-bottom: 16px;">🏷️</div>
                <div style="font-weight: 600; margin-bottom: 8px; color: #334155;">No Tags Available</div>
                <div style="font-size: 14px; line-height: 1.5;">Create tags first by clicking the "+" button in the Tags section above.</div>
            </div>
        `;
        modal.style.display = 'flex';
        return;
    }
    
    console.log('[CRM] Rendering', state.tags.length, 'tags in bulk modal');
    
    state.tags.forEach((tag, index) => {
        const contactCount = state.contacts.filter(contact => 
            contact.tags.includes(tag.id)
        ).length;
        
        const messengerContactCount = state.contacts.filter(contact => 
            contact.tags.includes(tag.id) && 
            contact.userId && 
            (contact.source === 'messenger' || contact.source === 'facebook_group')
        ).length;
        
        const tagRow = document.createElement('div');
        tagRow.className = 'tagRow';
        tagRow.style.cssText = `
            display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin: 4px 0;
            background: ${tag.color}0d; border: 1px solid ${tag.color}25; border-radius: 8px;
            cursor: pointer; transition: all 0.15s ease; position: relative;
        `;
        tagRow.style.setProperty('--tag-bg', tag.color);
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `bulk-tag-${tag.id}`;
        checkbox.setAttribute('data-tag', tag.id);
        checkbox.style.cssText = `width: 14px; height: 14px; accent-color: ${tag.color}; cursor: pointer; flex-shrink: 0;`;

        const colorDot = document.createElement('div');
        colorDot.style.cssText = `width: 8px; height: 8px; background: ${tag.color}; border-radius: 50%; flex-shrink: 0;`;

        const textContainer = document.createElement('div');
        textContainer.style.cssText = `flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0;`;

        const tagName = document.createElement('div');
        tagName.textContent = tag.name;
        tagName.style.cssText = `font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
        tagName.className = 'bulk-tag-name';

        const tagStats = document.createElement('div');
        tagStats.style.cssText = `display: flex; gap: 6px; margin-left: auto; flex-shrink: 0;`;

        if (messengerContactCount > 0) {
            tagStats.innerHTML = `
                <span class="bulk-tag-stat success">${messengerContactCount} reachable</span>
                ${contactCount > messengerContactCount ? `<span class="bulk-tag-stat muted">${contactCount} total</span>` : ''}
            `;
        } else if (contactCount > 0) {
            tagStats.innerHTML = `<span class="bulk-tag-stat danger">${contactCount} contacts</span>`;
        } else {
            tagStats.innerHTML = `<span class="bulk-tag-stat muted">Empty</span>`;
        }
        
        textContainer.appendChild(tagName);
        textContainer.appendChild(tagStats);
        
        tagRow.appendChild(checkbox);
        tagRow.appendChild(colorDot);
        tagRow.appendChild(textContainer);
        
        // Add hover effects
        tagRow.addEventListener('mouseenter', () => {
            tagRow.style.background = tag.color + '18';
            tagRow.style.borderColor = tag.color + '50';
        });

        tagRow.addEventListener('mouseleave', () => {
            tagRow.style.background = tag.color + '0d';
            tagRow.style.borderColor = tag.color + '25';
        });
        
        tagRow.addEventListener('click', (e) => {
            console.log('[Bulk Modal] Tag row clicked:', tag.name, 'Target:', e.target.tagName);
            
            // If the click is directly on the checkbox, let the browser handle it naturally
            if (e.target === checkbox) {
                console.log('[Bulk Modal] Direct checkbox click, letting browser handle it');
                return;
            }
            
            // For any other click on the tag row, toggle the checkbox
            console.log('[Bulk Modal] Tag row area clicked, toggling checkbox from', checkbox.checked, 'to', !checkbox.checked);
            e.preventDefault();
            checkbox.checked = !checkbox.checked;
            
            // Trigger the change event to update the visual state
            const changeEvent = new Event('change', { bubbles: true });
            checkbox.dispatchEvent(changeEvent);
        });
        
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                tagRow.style.background = tag.color + '20';
                tagRow.style.borderColor = tag.color + '80';
            } else {
                tagRow.style.background = tag.color + '0d';
                tagRow.style.borderColor = tag.color + '25';
            }
        });
        
        if (messengerContactCount === 0) {
            checkbox.disabled = true;
            tagRow.style.opacity = '0.6';
            tagRow.style.cursor = 'not-allowed';
            tagRow.title = 'No contacts available for messaging in this tag';
        }
        
        tagsDiv.appendChild(tagRow);
    });
    
    loadTemplate(state.currentTemplateIndex);
    modal.style.display = 'flex';
}

function handleBulkSendConfirm() {
    console.log('[CRM] Bulk send confirmation started');
    
    const tagCheckboxes = document.querySelectorAll('#bulkTags input[type="checkbox"]');
    
    if (tagCheckboxes.length === 0) {
        toast('No tags found. Please refresh and try again.', false);
        return;
    }
    
    const selectedTags = [];
    tagCheckboxes.forEach(checkbox => {
        if (checkbox.checked && !checkbox.disabled) {
            const tagId = checkbox.getAttribute('data-tag');
            if (tagId) selectedTags.push(tagId);
        }
    });
    
    if (selectedTags.length === 0) {
        toast('Please select at least one tag with Messenger contacts', false);
        return;
    }
    
    const messageTextarea = $('bulkMessage');
    const message = messageTextarea?.value.trim();
    if (!message) {
        toast('Please write a message', false);
        return;
    }
    
    const delaySlider = $('delaySlider');
    const limitInput = $('limitInput');
    const batchSizeInput = $('batchSizeInput');
    const batchWaitInput = $('batchWaitInput');
    const delay = delaySlider ? Number(delaySlider.value) : 10;
    const limit = limitInput ? Number(limitInput.value) || null : null;
    const batchSize = batchSizeInput ? Number(batchSizeInput.value) || 0 : 0;
    const batchWaitMinutes = batchWaitInput ? Number(batchWaitInput.value) || 5 : 5;

    const messengerRecipients = state.contacts.filter(contact => {
        if (!contact.userId) return false;
        // Include both messenger and facebook_group contacts for bulk messaging
        if (contact.source !== 'messenger' && contact.source !== 'facebook_group') return false;
        return selectedTags.some(tagId => contact.tags.includes(tagId));
    });

    if (messengerRecipients.length === 0) {
        toast('No contacts available for messaging in selected tags', false);
        return;
    }

    const finalRecipients = limit ? messengerRecipients.slice(0, limit) : messengerRecipients;

    chrome.runtime.sendMessage({
        type: 'BULK_SEND',
        payload: {
            recipients: finalRecipients,
            template: message,
            delaySec: delay,
            limit: limit,
            batchSize: batchSize,
            batchWaitMinutes: batchWaitMinutes,
            selectedTagIds: selectedTags,
        }
    }, (response) => {
        if (chrome.runtime.lastError) {
            toast('Failed to start bulk send: ' + chrome.runtime.lastError.message, false);
            return;
        }
        
        if (response && response.status === 'started') {
            toast(`Started sending to ${finalRecipients.length} contacts!`);
            document.getElementById('bulkModal').style.display = 'none';
            startProgressPolling();
        } else {
            toast('Failed to start bulk send. Please try again.', false);
        }
    });
}

/* ===============================
   SAVE SELECTED MODAL
   =============================== */

async function handleSaveSelected() {
    let selectedUsers = [];
    
    try {
        const messengerTabs = await chrome.tabs.query({ url: ['https://www.facebook.com/messages/*'] });
        if (messengerTabs.length) {
            const messengerUsers = await chrome.tabs.sendMessage(messengerTabs[0].id, { action: 'getSelectedUsers' });
            if (messengerUsers && messengerUsers.length > 0) {
                selectedUsers = selectedUsers.concat(messengerUsers);
            }
        }
    } catch (error) {
        console.log('[CRM] No Messenger tab found or no selection');
    }
    
    try {
        const [facebookTab] = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
        if (facebookTab) {
            const groupUsers = await chrome.tabs.sendMessage(facebookTab.id, { action: 'getSelectedGroupMembers' });
            if (groupUsers && groupUsers.length > 0) {
                selectedUsers = selectedUsers.concat(groupUsers);
            }
        }
    } catch (error) {
        console.log('[CRM] No Facebook tab found or no selection');
    }
    
    if (!selectedUsers.length) {
        toast('Please select contacts first (from Messenger or Facebook Groups)');
        return;
    }

    const list = $('saveTagsList');
    if (!list) return;
    
    list.innerHTML = '';
    state.tags.forEach(t => {
        const count = state.contacts.filter(c => c.tags.includes(t.id)).length;
        const label = document.createElement('label');
        label.className = 'tagRow';
        label.style.setProperty('--tag-bg', t.color);
        label.innerHTML = `<input type="checkbox" value="${escapeHtml(t.id)}">${escapeHtml(t.name)} (${count})`;
        list.appendChild(label);
    });
    
    const sources = [...new Set(selectedUsers.map(u => u.source === 'facebook_group' ? 'Groups' : 'Messenger'))];
    const sourceText = sources.length > 1 ? 'Mixed Sources' : sources[0] || 'Messenger';
    const modalTitle = document.querySelector('#saveSelectedModal h2');
    if (modalTitle) {
        modalTitle.textContent = `Save ${selectedUsers.length} selected from ${sourceText}`;
    }
    
    $('saveSelectedModal').style.display = 'flex';
}

async function confirmSaveSelected() {
    const selectedTags = [...document.querySelectorAll('#saveTagsList input:checked')]
                         .map(cb => cb.value);
    if (!selectedTags.length) { 
        toast('Pick at least one tag', false); 
        return; 
    }

    let selectedUsers = [];

    // Collect from Messenger
    try {
        const msgTabs = await chrome.tabs.query({ url: ['https://www.facebook.com/messages/*'] });
        if (msgTabs.length) {
            const tab = msgTabs[0];
            const users = await chrome.tabs.sendMessage(tab.id, { action: 'getSelectedUsers' });
            if (users?.length) selectedUsers.push(...users);
            await chrome.tabs.sendMessage(tab.id, { action: 'clearSelection' }).catch(()=>{});
        }
    } catch (e) {
        console.log('[CRM] No Messenger selection:', e);
    }

    // Collect from Facebook Groups
    try {
        const [tab] = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
        if (tab) {
            const users = await chrome.tabs.sendMessage(tab.id, { action: 'getSelectedGroupMembers' });
            if (users?.length) selectedUsers.push(...users);
            await chrome.tabs.sendMessage(tab.id, { action: 'clearGroupSelection' }).catch(()=>{});
        }
    } catch (e) {
        console.log('[CRM] No Facebook Groups selection:', e);
    }

    if (!selectedUsers.length) { 
        toast('No users selected', false); 
        return; 
    }

    // Process contacts
    for (const user of selectedUsers) {
        const existing = state.contacts.find(
            c => c.userId === user.userId || (user.name && c.name === user.name)
        );

        if (existing) {
            if (user.profilePicture && user.profilePicture !== 'null') {
                existing.profilePicture = user.profilePicture;
            }
            if (user.source === 'facebook_group') {
                existing.source = 'facebook_group';
                existing.groupId = user.groupId;
            }
            existing.tags = [...new Set([...existing.tags, ...selectedTags])];
        } else {
            state.contacts.push({
                id: genId(),
                name: user.name || 'Unknown',
                userId: user.userId || null,
                profilePicture: user.profilePicture || null,
                source: user.source || 'messenger',
                groupId: user.groupId || null,
                tags: [...selectedTags]
            });
        }
    }

    // Show loading state
    const confirmBtn = $('confirmSaveSelected');
    const originalBtnText = confirmBtn.textContent;
    confirmBtn.textContent = 'Syncing...';
    confirmBtn.disabled = true;

    try {
        // Save with high priority for immediate sync
        console.log('[Popup] 🔥 CONTACT ADDITION - About to save state with contacts:', state.contacts.length);
        const result = await saveState('high');
        console.log('[Popup] 🔥 CONTACT ADDITION - Save state result:', result);
        
        // Invalidate cache to ensure fresh data on next load
        await storageManager.invalidateCache('contacts');
        
        renderContacts();
        renderTags();
        
        // Small delay to ensure sync completes
        await new Promise(resolve => setTimeout(resolve, 500));
        
        $('saveSelectedModal').style.display = 'none';
        toast(`${selectedUsers.length} contacts saved successfully!`);
        
    } finally {
        // Restore button state
        confirmBtn.textContent = originalBtnText;
        confirmBtn.disabled = false;
    }
}

/* ===============================
   EXPORT FUNCTIONALITY
   =============================== */

function openExportModal() {
    const modal = $('exportModal');
    if (!modal) {
        toast('Export modal not found. Please refresh the page.', false);
        return;
    }
    
    updateExportPreview();
    modal.style.display = 'flex';
    resetExportForm();
}

function updateExportPreview() {
    const contactCount = $('previewContactCount');
    const tagCount = $('previewTagCount');
    
    if (contactCount) contactCount.textContent = state.contacts.length;
    if (tagCount) tagCount.textContent = state.tags.length;
}

function resetExportForm() {
    const csvRadio = document.querySelector('input[name="exportFormat"][value="csv"]');
    if (csvRadio) csvRadio.checked = true;
    
    const sheetsConfig = $('sheetsConfig');
    if (sheetsConfig) sheetsConfig.style.display = 'none';
    
    const sheetsUrl = $('sheetsUrl');
    if (sheetsUrl) {
        sheetsUrl.value = '';
        sheetsUrl.classList.remove('valid', 'invalid');
    }
}

function handleExportFormatChange() {
    const selectedFormat = document.querySelector('input[name="exportFormat"]:checked')?.value;
    const sheetsConfig = $('sheetsConfig');
    
    if (selectedFormat === 'sheets' && sheetsConfig) {
        sheetsConfig.style.display = 'block';
    } else if (sheetsConfig) {
        sheetsConfig.style.display = 'none';
    }
}

function validateSheetsUrl(url) {
    if (!url) return false;
    const sheetsRegex = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/;
    return sheetsRegex.test(url);
}

function prepareExportData() {
    return state.contacts.map(contact => {
        const nameParts = (contact.name || '').trim().split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        
        const tagNames = contact.tags
            .map(tagId => state.tags.find(tag => tag.id === tagId)?.name)
            .filter(Boolean)
            .join(', ');
        
        const profileUrl = contact.userId 
            ? `https://www.facebook.com/messages/t/${contact.userId}`
            : '';
        
        return {
            firstName,
            lastName,
            fullName: contact.name || '',
            profileUrl,
            tags: tagNames,
            userId: contact.userId || '',
            profilePicture: contact.profilePicture || ''
        };
    });
}

function convertToCSV(data) {
    if (!data.length) return '';
    
    const headers = ['First Name', 'Last Name', 'Profile URL', 'Tags', 'User ID'];
    const csvRows = [headers.join(',')];
    
    data.forEach(contact => {
        const row = [
            `"${contact.firstName}"`,
            `"${contact.lastName}"`,
            `"${contact.profileUrl}"`,
            `"${contact.tags}"`,
            `"${contact.userId}"`
        ];
        csvRows.push(row.join(','));
    });
    
    return csvRows.join('\n');
}

function convertToTSV(data) {
    if (!data.length) return '';
    
    const headers = ['First Name', 'Last Name', 'Profile URL', 'Tags', 'User ID'];
    const tsvRows = [headers.join('\t')];
    
    data.forEach(contact => {
        const row = [
            contact.firstName,
            contact.lastName,
            contact.profileUrl,
            contact.tags,
            contact.userId
        ];
        tsvRows.push(row.join('\t'));
    });
    
    return tsvRows.join('\n');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function handleExportConfirm() {
    const selectedFormat = document.querySelector('input[name="exportFormat"]:checked')?.value;
    
    if (!selectedFormat) {
        toast('Please select an export format', false);
        return;
    }
    
    if (selectedFormat === 'sheets') {
        const sheetsUrl = $('sheetsUrl')?.value.trim();
        if (!sheetsUrl || !validateSheetsUrl(sheetsUrl)) {
            toast('Please enter a valid Google Sheets URL', false);
            return;
        }
    }
    
    try {
        const exportData = prepareExportData();
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        
        switch (selectedFormat) {
            case 'csv':
                const csvContent = convertToCSV(exportData);
                downloadFile(csvContent, `messenger-crm-contacts-${timestamp}.csv`, 'text/csv');
                toast(`CSV exported with ${exportData.length} contacts!`);
                break;
                
            case 'sheets':
                const sheetsUrl = $('sheetsUrl').value.trim();
                const tsvForSheets = convertToTSV(exportData);
                
                const confirmBtn = $('confirmExport');
                const originalText = confirmBtn.innerHTML;
                confirmBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                        <path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2"/>
                    </svg>
                    Processing...
                `;
                confirmBtn.disabled = true;
                
                try {
                    await navigator.clipboard.writeText(tsvForSheets);
                    toast('Table data copied to clipboard!', true);
                    setTimeout(() => window.open(sheetsUrl, '_blank'), 1000);
                } catch (clipboardError) {
                    const csvForSheets = convertToCSV(exportData);
                    downloadFile(csvForSheets, `messenger-crm-for-sheets-${timestamp}.csv`, 'text/csv');
                    toast('CSV file downloaded for manual upload', true);
                    setTimeout(() => window.open(sheetsUrl, '_blank'), 1000);
                }
                
                setTimeout(() => {
                    confirmBtn.innerHTML = originalText;
                    confirmBtn.disabled = false;
                }, 1000);
                break;
                
            case 'json':
                const jsonData = {
                    exportDate: new Date().toISOString(),
                    contactCount: exportData.length,
                    tagCount: state.tags.length,
                    contacts: exportData,
                    tags: state.tags
                };
                const jsonContent = JSON.stringify(jsonData, null, 2);
                downloadFile(jsonContent, `messenger-crm-data-${timestamp}.json`, 'application/json');
                toast(`JSON exported with ${exportData.length} contacts and ${state.tags.length} tags!`);
                break;
                
            default:
                throw new Error('Invalid export format selected');
        }
        
        setTimeout(() => {
            $('exportModal').style.display = 'none';
        }, 1500);
        
    } catch (error) {
        console.error('Export error:', error);
        toast('Export failed. Please try again.', false);
    }
}

/* ===============================
   FRIEND REQUEST MANAGEMENT
   =============================== */

/**
 * Render friend request statistics
 */
function renderFriendRequestStats() {
    console.log('[Popup] Rendering friend request stats:', friendRequestState.stats);
    
    // Update count badge
    const countBadge = document.getElementById('friendRequestCount');
    if (countBadge) {
        countBadge.textContent = friendRequestState.stats.total || 0;
    }
    
    // Update individual stat values
    const pendingElement = document.getElementById('friendRequestsPending');
    const acceptedElement = document.getElementById('friendRequestsAccepted');
    
    if (pendingElement) pendingElement.textContent = friendRequestState.stats.pending || 0;
    if (acceptedElement) acceptedElement.textContent = friendRequestState.stats.accepted || 0;
}

// Friend request refresh state
let friendRequestRefreshState = {
  isActive: false,
  status: 'idle',
  progress: '',
  results: null,
  error: null
};

/**
 * Handle refresh friend request status button click
 */
async function handleRefreshFriendRequestStatus() {
  const refreshBtn = document.getElementById('refreshFriendRequestStatusBtn');
  const progressContainer = document.getElementById('friendRequestCheckProgress');
  
  if (!refreshBtn) {
    console.error('[Popup] Refresh button not found');
    return;
  }
  
  try {
    console.log('[Popup] Starting friend request status check...');
    
    // Call background script to start the refresh
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'checkFriendRequestStatuses' },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });
    
    console.log('[Popup] Status check response:', response);
    
    if (response.success && response.started) {
      toast('Friend request status check started. This will continue even if you close the popup.', true);
      
      // Update UI to show refresh is in progress
      updateRefreshButtonState(true, 'Starting...');
      if (progressContainer) {
        progressContainer.style.display = 'block';
        showStatusCheckProgress('Friend request status check started...');
      }
      
      // Start polling for updates
      startRefreshStatusPolling();
      
    } else if (response.isActive) {
      toast('Friend request refresh already in progress', true);
      
      // Update UI to show refresh is in progress
      updateRefreshButtonState(true, response.refreshState?.progress || 'In Progress...');
      if (progressContainer) {
        progressContainer.style.display = 'block';
        showStatusCheckProgress(response.refreshState?.progress || 'Refresh in progress...');
      }
      
      // Start polling for updates
      startRefreshStatusPolling();
      
    } else {
      throw new Error(response.error || 'Failed to start refresh');
    }
    
  } catch (error) {
    console.error('[Popup] Friend request status check failed:', error);
    
    // Show appropriate error message
    if (error.message.includes('already in progress')) {
      toast('Friend request refresh already in progress', false);
    } else {
      toast('Failed to start status check. Please try again.', false);
    }
    
    // Reset button state
    updateRefreshButtonState(false, 'Refresh Status');
    const progressContainer = document.getElementById('friendRequestCheckProgress');
    if (progressContainer) {
      progressContainer.style.display = 'none';
    }
  }
}

/**
 * Update refresh button state
 */
function updateRefreshButtonState(isActive, text) {
  const refreshBtn = document.getElementById('refreshFriendRequestStatusBtn');
  if (!refreshBtn) return;
  
  if (isActive) {
    refreshBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="spinning">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
        <path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2"/>
      </svg>
      ${text}
    `;
    refreshBtn.disabled = true;
  } else {
    refreshBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M23 4V10H17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M20.49 15C19.9828 16.8395 18.8375 18.4734 17.2473 19.6247C15.6572 20.7759 13.7267 21.3734 11.7586 21.3218C9.79056 21.2701 7.89661 20.5719 6.36218 19.3336C4.82775 18.0954 3.74463 16.3957 3.29543 14.4812C2.84624 12.5667 3.05094 10.5486 3.87735 8.75003C4.70376 6.95147 6.10963 5.47893 7.8832 4.57007C9.65677 3.66122 11.6979 3.37368 13.6586 3.75671C15.6194 4.13974 17.3986 5.16705 18.69 6.67003L23 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      ${text}
    `;
    refreshBtn.disabled = false;
  }
}

/**
 * Start polling for refresh status updates
 */
function startRefreshStatusPolling() {
  // Clear any existing polling
  if (window.refreshStatusInterval) {
    clearInterval(window.refreshStatusInterval);
  }
  
  // Poll every 2 seconds
  window.refreshStatusInterval = setInterval(async () => {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'getFriendRequestRefreshState' },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          }
        );
      });
      
      if (response.success && response.refreshState) {
        handleRefreshStateUpdate(response.refreshState);
      }
      
    } catch (error) {
      console.error('[Popup] Error polling refresh state:', error);
      // Continue polling in case it's a temporary error
    }
  }, 2000);
}

/**
 * Handle refresh state updates
 */
function handleRefreshStateUpdate(refreshState) {
  friendRequestRefreshState = refreshState;
  
  const progressContainer = document.getElementById('friendRequestCheckProgress');
  
  if (refreshState.isActive) {
    // Update UI for active refresh
    updateRefreshButtonState(true, 'Checking...');
    if (progressContainer) {
      progressContainer.style.display = 'block';
      showStatusCheckProgress(refreshState.progress || 'In progress...');
    }
  } else {
    // Refresh completed or failed
    clearInterval(window.refreshStatusInterval);
    window.refreshStatusInterval = null;
    
    updateRefreshButtonState(false, 'Refresh Status');
    if (progressContainer) {
      progressContainer.style.display = 'none';
    }
    
    // Update the last check timestamp display
    updateLastCheckTimestamp();
    
    if (refreshState.status === 'completed' && refreshState.results) {
      const results = refreshState.results;
      
      if (results.updatedCount > 0) {
        toast(`${results.updatedCount} friend request(s) accepted!`, true);
        
        // Reload friend request data to update UI
        loadState().then(() => {
          renderFriendRequestStats();
        });
        
        // Show tag assignment modal if there are accepted friends
        if (results.showTagAssignmentModal && results.acceptedFriends && results.acceptedFriends.length > 0) {
          showTagAssignmentModal(results.acceptedFriends);
        }
      } else {
        toast('No new friend request acceptances found', true);
      }
    } else if (refreshState.status === 'error') {
      console.error('[Popup] Friend request refresh failed:', refreshState.error);
      
      // Show appropriate error message
      if (refreshState.error.includes('Failed to open friends list')) {
        toast('Could not access Facebook friends list. Make sure you are logged in.', false);
      } else if (refreshState.error.includes('timeout')) {
        toast('Request timed out. Please try again.', false);
      } else {
        toast('Status check failed. Please try again.', false);
      }
    }
    
    // Update last check timestamp
    updateLastCheckTimestamp();
  }
}

/**
 * Check for ongoing friend request refresh when popup opens
 */
async function checkOngoingRefresh() {
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'getFriendRequestRefreshState' },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });
    
    if (response.success && response.refreshState) {
      if (response.refreshState.isActive) {
        console.log('[Popup] Found ongoing friend request refresh, resuming UI updates');
        handleRefreshStateUpdate(response.refreshState);
        startRefreshStatusPolling();
      }
    }
    
  } catch (error) {
    console.error('[Popup] Error checking ongoing refresh:', error);
  }
}

/**
 * Show status check progress
 */
function showStatusCheckProgress(message) {
  const progressText = document.querySelector('#friendRequestCheckProgress .progress-text');
  const progressBar = document.querySelector('#friendRequestCheckProgress .progress-bar');
  
  if (progressText) {
    progressText.textContent = message;
  }
  
  if (progressBar) {
    // Animate progress bar
    progressBar.style.width = '0%';
    setTimeout(() => {
      progressBar.style.width = '100%';
    }, 100);
  }
}

/**
 * Update last check timestamp display
 */
function updateLastCheckTimestamp() {
  chrome.storage.local.get(['lastStatusCheck'], (result) => {
    const lastCheck = result.lastStatusCheck;
    const timestampElement = document.getElementById('lastStatusCheckTime');
    
    if (timestampElement) {
      if (lastCheck) {
        try {
          const lastCheckDate = new Date(lastCheck);
          // Validate the date
          if (isNaN(lastCheckDate.getTime())) {
            console.warn('[Popup] Invalid lastStatusCheck date:', lastCheck);
            timestampElement.textContent = 'Never checked';
            return;
          }
          
          const now = new Date();
          const diffMinutes = Math.floor((now - lastCheckDate) / (1000 * 60));
          
          let timeText;
          if (diffMinutes < 1) {
            timeText = 'Just now';
          } else if (diffMinutes < 60) {
            timeText = `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
          } else {
            const diffHours = Math.floor(diffMinutes / 60);
            timeText = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
          }
          
          timestampElement.textContent = `Last checked: ${timeText}`;
          console.log('[Popup] ✅ Updated timestamp display:', timeText);
        } catch (error) {
          console.error('[Popup] Error parsing lastStatusCheck:', error);
          timestampElement.textContent = 'Never checked';
        }
      } else {
        timestampElement.textContent = 'Never checked';
        console.log('[Popup] No lastStatusCheck found, showing "Never checked"');
      }
    }
  });
}

/**
 * Setup friend request section event listeners
 */
function setupFriendRequestEventListeners() {
    // Collapse/expand functionality
    const collapseBtn = document.getElementById('collapseFriendRequestsBtn');
    if (collapseBtn) {
        collapseBtn.onclick = () => {
            const section = document.querySelector('.friend-requests-section');
            if (section) {
                section.classList.toggle('collapsed');
                collapseBtn.classList.toggle('collapsed');
            }
        };
    }
    
// - Refresh status button handler
  const refreshStatusBtn = document.getElementById('refreshFriendRequestStatusBtn');
  if (refreshStatusBtn) {
    refreshStatusBtn.onclick = handleRefreshFriendRequestStatus;
  }

    // Manage friend requests button
    const manageBtn = document.getElementById('manageFriendRequestsBtn');
    if (manageBtn) {
        manageBtn.onclick = () => {
            showFriendRequestModal();
        };
    }
}

/**
 * Show friend request management modal
 */
function showFriendRequestModal() {
    // Create modal if it doesn't exist
    let modal = document.getElementById('friendRequestModal');
    if (!modal) {
        modal = createFriendRequestModal();
        document.body.appendChild(modal);
    }
    
    // Populate modal with current friend requests
    populateFriendRequestModal();
    
    // Show modal
    modal.style.display = 'flex';
}

/**
 * Create friend request modal HTML
 */
function createFriendRequestModal() {
    const modal = document.createElement('div');
    modal.id = 'friendRequestModal';
    modal.className = 'friend-request-modal';
    modal.style.display = 'none';
    
    modal.innerHTML = `
        <div class="friend-request-modal-content">
            <div class="modal-header">
                <h2>Friend Request Management</h2>
                <p>Track and manage your friend requests from Facebook Groups</p>
                <button id="closeFriendRequestModal" class="modal-close" aria-label="Close modal">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
            <div class="modal-content">
                <div id="friendRequestList" class="friend-request-list">
                    <!-- Friend requests will be populated here -->
                </div>
            </div>
            <div class="modal-footer">
                <button id="closeFriendRequestModalBtn" class="btn btn-secondary">Close</button>
            </div>
        </div>
    `;
    
    // Setup modal event listeners
    const closeBtn = modal.querySelector('#closeFriendRequestModal');
    const closeBtnFooter = modal.querySelector('#closeFriendRequestModalBtn');
    const refreshBtn = modal.querySelector('#refreshFriendRequestsBtn');
    
    const closeModal = () => {
        modal.style.display = 'none';
    };
    
    if (closeBtn) closeBtn.onclick = closeModal;
    if (closeBtnFooter) closeBtnFooter.onclick = closeModal;
    
    if (refreshBtn) {
        refreshBtn.onclick = () => {
            refreshFriendRequestStatus();
        };
    }
    
    // Close on backdrop click
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };
    
    return modal;
}

/**
 * Populate friend request modal with current data
 */
function populateFriendRequestModal() {
    const listContainer = document.getElementById('friendRequestList');
    if (!listContainer) return;
    
    if (friendRequestState.requests.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style="margin: 0 auto 16px; opacity: 0.5;">
                    <path d="M16 21V19C16 18.1645 15.7155 17.3541 15.2094 16.7007C14.7033 16.0473 13.9944 15.5885 13.2 15.3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M8 3.13C8.86039 3.35031 9.62303 3.85071 10.1676 4.55232C10.7122 5.25392 11.0078 6.11683 11.0078 7.005C11.0078 7.89317 10.7122 8.75608 10.1676 9.45768C9.62303 10.1593 8.86039 10.6597 8 10.88" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
                    <path d="M20 8V6C20 5.46957 19.7893 4.96086 19.4142 4.58579C19.0391 4.21071 18.5304 4 18 4H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <polyline points="18,2 20,4 18,6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <h3 style="margin: 0 0 8px; font-size: 16px; font-weight: 500;">No Friend Requests Tracked</h3>
                <p style="margin: 0; font-size: 14px; line-height: 1.5;">Visit Facebook Groups and click "Add Friend" buttons to start tracking friend requests automatically.</p>
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = friendRequestState.requests
        .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
        .map(request => createFriendRequestItem(request))
        .join('');
}

/**
 * Create HTML for a single friend request item
 */
function createFriendRequestItem(request) {
    const avatarSrc = request.profilePicture || `https://i.pravatar.cc/40?u=${request.userId}`;
    const sentDate = new Date(request.sentAt).toLocaleDateString();
    const sentTime = new Date(request.sentAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    let statusInfo = '';
    if (request.respondedAt) {
        const respondedDate = new Date(request.respondedAt).toLocaleDateString();
        statusInfo = `Responded on ${respondedDate}`;
    } else {
        statusInfo = `Sent on ${sentDate} at ${sentTime}`;
    }
    
    return `
        <div class="friend-request-item">
            <img src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(request.name)}" class="friend-request-avatar"
                 data-fallback="https://i.pravatar.cc/40?u=${escapeHtml(request.userId)}">
            <div class="friend-request-details">
                <div class="friend-request-name">${escapeHtml(request.name)}</div>
                <div class="friend-request-meta">
                    <span class="friend-request-status ${escapeHtml(request.status)}">${escapeHtml(request.status)}</span>
                    <span>•</span>
                    <span>${escapeHtml(statusInfo)}</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Refresh friend request status (placeholder for future implementation)
 */
function refreshFriendRequestStatus() {
    toast('Friend request status refresh not yet implemented', false);
}

/* ===============================
   TAG ASSIGNMENT MODAL FUNCTIONS
   =============================== */

/**
 * Show tag assignment modal for accepted friends
 */
function showTagAssignmentModal(acceptedFriends) {
    console.log('[Popup] Showing tag assignment modal for accepted friends:', acceptedFriends);
    
    // Create modal if it doesn't exist
    let modal = document.getElementById('tagAssignmentModal');
    if (!modal) {
        modal = createTagAssignmentModal();
        document.body.appendChild(modal);
    }
    
    // Populate modal with accepted friends and tags
    populateTagAssignmentModal(acceptedFriends);
    
    // Show modal
    modal.style.display = 'flex';
}

/**
 * Create tag assignment modal HTML
 */
function createTagAssignmentModal() {
    const modal = document.createElement('div');
    modal.id = 'tagAssignmentModal';
    modal.className = 'tag-assignment-modal';
    modal.style.display = 'none';
    
    modal.innerHTML = `
        <div class="tag-assignment-modal-content">
            <div class="tag-assignment-header">
                <h2>🎉 Friend Requests Accepted!</h2>
                <p>Great news! Some of your friend requests have been accepted. Would you like to add these new friends to tags?</p>
            </div>
            
            <div class="accepted-friends-list">
                <h3>New Friends</h3>
                <div id="acceptedFriendsList"></div>
            </div>
            
            <div class="tag-selection-section">
                <h3>Assign to Tags</h3>
                
                <div class="existing-tags">
                    <h4>Select existing tags:</h4>
                    <div class="tag-checkbox-list" id="existingTagsList"></div>
                </div>
                
                <div class="new-tag-section">
                    <h4>Or create a new tag:</h4>
                    <div class="new-tag-form">
                        <input type="text" id="newTagInput" class="new-tag-input" placeholder="Enter new tag name">
                        <div class="new-tag-colors" id="newTagColors"></div>
                    </div>
                </div>
            </div>
            
            <div class="tag-assignment-actions">
                <button id="cancelTagAssignment" class="btn-cancel">Skip</button>
                <button id="assignTags" class="btn-assign-tags">Assign Tags</button>
            </div>
        </div>
    `;
    
    // Set up event listeners
    modal.querySelector('#cancelTagAssignment').addEventListener('click', () => {
        hideTagAssignmentModal();
    });
    
    modal.querySelector('#assignTags').addEventListener('click', () => {
        handleTagAssignment();
    });
    
    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            hideTagAssignmentModal();
        }
    });
    
    return modal;
}

/**
 * Populate tag assignment modal with data
 */
function populateTagAssignmentModal(acceptedFriends) {
    // Populate accepted friends list
    const friendsList = document.getElementById('acceptedFriendsList');
    friendsList.innerHTML = acceptedFriends.map(friend => `
        <div class="accepted-friend-item" data-user-id="${escapeHtml(friend.userId)}">
            <div class="accepted-friend-avatar">
                ${friend.profilePicture ? `<img src="${escapeHtml(friend.profilePicture)}" alt="${escapeHtml(friend.name)}">` : ''}
            </div>
            <span class="accepted-friend-name">${escapeHtml(friend.name)}</span>
        </div>
    `).join('');
    
    // Populate existing tags
    const tagsList = document.getElementById('existingTagsList');
    tagsList.innerHTML = state.tags.map(tag => `
        <div class="tag-checkbox-item">
            <input type="checkbox" id="tag-${escapeHtml(tag.id)}" value="${escapeHtml(tag.id)}">
            <label for="tag-${escapeHtml(tag.id)}" class="tag-checkbox-label">
                <div class="tag-color-dot" style="background-color: ${escapeHtml(tag.color)}"></div>
                ${escapeHtml(tag.name)}
            </label>
        </div>
    `).join('');
    
    // Populate color options for new tag
    const colors = [
        '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
        '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50',
        '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800',
        '#ff5722', '#795548', '#9e9e9e', '#607d8b'
    ];
    
    const colorsContainer = document.getElementById('newTagColors');
    colorsContainer.innerHTML = colors.map((color, index) => `
        <div class="color-option ${index === 0 ? 'selected' : ''}" 
             data-color="${color}" 
             style="background-color: ${color}"></div>
    `).join('');
    
    // Set up color selection
    colorsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('color-option')) {
            colorsContainer.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
            e.target.classList.add('selected');
        }
    });
}

/**
 * Handle tag assignment submission
 */
async function handleTagAssignment() {
    const assignBtn = document.getElementById('assignTags');
    const originalText = assignBtn.textContent;
    assignBtn.textContent = 'Assigning...';
    assignBtn.disabled = true;
    
    try {
        // Get selected existing tags
        const selectedTagIds = Array.from(document.querySelectorAll('#existingTagsList input[type="checkbox"]:checked'))
            .map(checkbox => checkbox.value);
        
        // Get new tag info if provided
        const newTagName = document.getElementById('newTagInput').value.trim();
        const selectedColor = document.querySelector('#newTagColors .color-option.selected')?.dataset.color || '#3b82f6';
        
        // Create new tag if name is provided
        if (newTagName) {
            const newTag = await createNewTag(newTagName, selectedColor);
            if (newTag) {
                selectedTagIds.push(newTag.id);
            }
        }
        
        if (selectedTagIds.length === 0) {
            toast('Please select at least one tag or create a new one', false);
            return;
        }
        
        // Get accepted friends data
        const acceptedFriends = Array.from(document.querySelectorAll('.accepted-friend-item'))
            .map(item => ({
                userId: item.dataset.userId,
                name: item.querySelector('.accepted-friend-name').textContent
            }));
        
        // Assign friends to tags
        await assignFriendsToTags(acceptedFriends, selectedTagIds);
        
        toast(`Successfully assigned ${acceptedFriends.length} friends to ${selectedTagIds.length} tag(s)!`, true);
        hideTagAssignmentModal();
        
        // Refresh the contacts view
        loadState();
        
    } catch (error) {
        console.error('[Popup] Error assigning tags:', error);
        toast('Failed to assign tags. Please try again.', false);
    } finally {
        assignBtn.textContent = originalText;
        assignBtn.disabled = false;
    }
}

/**
 * Create a new tag
 */
async function createNewTag(name, color) {
    const duplicate = state.tags.find(t => t.name.toLowerCase() === name.trim().toLowerCase());
    if (duplicate) {
        toast('Tag already exists', false);
        return null;
    }
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: 'createTag',
            tagData: { name, color }
        }, (response) => {
            if (response && response.success) {
                // Add to local state
                const newTag = {
                    id: response.tagId,
                    name: name,
                    color: color
                };
                state.tags.push(newTag);
                resolve(newTag);
            } else {
                console.error('[Popup] Failed to create tag:', response?.error);
                resolve(null);
            }
        });
    });
}

/**
 * Assign friends to tags
 */
async function assignFriendsToTags(friends, tagIds) {
    // Convert friends to contact format
    const contacts = friends.map(friend => ({
        name: friend.name,
        userId: friend.userId,
        source: friend.source || 'facebook_group'  // Use existing source or default
    }));
    
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'saveContactsToTags',
            contacts: contacts,
            tagIds: tagIds
        }, (response) => {
            if (response && response.success) {
                resolve(response);
            } else {
                reject(new Error(response?.error || 'Failed to assign contacts'));
            }
        });
    });
}

/**
 * Hide tag assignment modal
 */
function hideTagAssignmentModal() {
    const modal = document.getElementById('tagAssignmentModal');
    if (modal) {
        modal.style.display = 'none';
        
        // Clear form
        document.getElementById('newTagInput').value = '';
        document.querySelectorAll('#existingTagsList input[type="checkbox"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('#newTagColors .color-option').forEach((opt, index) => {
            opt.classList.toggle('selected', index === 0);
        });
    }
}

/**
 * Check for pending tag assignment modal on popup startup
 */
async function checkForPendingTagAssignmentModal() {
    try {
        const result = await chrome.storage.local.get(['pendingTagAssignmentModal']);
        const pending = result.pendingTagAssignmentModal;

        // Always clear first — prevents re-showing on next open no matter what
        await chrome.storage.local.remove(['pendingTagAssignmentModal']);

        if (pending && pending.acceptedFriends && pending.acceptedFriends.length > 0) {
            // Ignore stale data older than 10 minutes
            const ageMs = Date.now() - (pending.timestamp || 0);
            if (ageMs > 10 * 60 * 1000) {
                console.log('[Popup] Ignoring stale pending tag assignment modal (age:', Math.round(ageMs / 60000), 'min)');
                return;
            }
            console.log('[Popup] Found pending tag assignment modal, showing it now');
            showTagAssignmentModal(pending.acceptedFriends);
        }
    } catch (error) {
        console.error('[Popup] Error checking for pending tag assignment modal:', error);
    }
}

/* ===============================
   RENDERING FUNCTIONS
   =============================== */

function renderTags() {
    const c = $('tagContainer');
    if (!c) return;
    
    c.innerHTML = '';
    
    const filtered = state.tags.filter(t => t.name.toLowerCase().includes(searchTerm));

    const tagCount = $('tagCount');
    if (tagCount) {
        tagCount.textContent = filtered.length;
    }

    const headerRow = document.createElement('div');
    headerRow.className = 'tagHeaderRow';
    headerRow.innerHTML = `
        <span>Tags</span>
        <div class="headerActions">
            <button id="selectAllTagsBtn" title="Select / deselect all">All</button>
            <button id="removeSelTagsBtn" title="Remove selected" disabled>Remove</button>
        </div>`;
    c.appendChild(headerRow);

    filtered.forEach(t => {
        const count = state.contacts.filter(ct => ct.tags.includes(t.id)).length;
        
        const row = document.createElement('label');
        row.className = 'tagRow';
        if (state.selectedTagId === t.id) {
            row.classList.add('active');
        }
        row.style.setProperty('--tag-bg', t.color);
        
        row.innerHTML = `
            <input type="checkbox" class="tagCheck" data-id="${escapeHtml(t.id)}" ${state.checkedTagIds.has(t.id) ? 'checked' : ''}>
            <span class="tagName">${escapeHtml(t.name)} (${count})</span>`;
        
        row.onclick = e => {
            // Find the checkbox within this row
            const checkbox = row.querySelector('.tagCheck');
            
            // If clicking directly on the checkbox, let the browser handle the change naturally
            if (e.target.classList.contains('tagCheck')) {
                // Let the checkbox change event fire naturally, then sync our state
                setTimeout(() => {
                    if (checkbox.checked) {
                        state.checkedTagIds.add(t.id);
                    } else {
                        state.checkedTagIds.delete(t.id);
                    }
                    saveState();
                }, 0);
                return;
            }
            
            // Prevent the label from also triggering a synthetic checkbox click (double-toggle bug)
            e.preventDefault();

            // If clicking anywhere else on the row, toggle the checkbox programmatically
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            
            // Update our state based on the new checkbox state
            if (checkbox.checked) {
                state.checkedTagIds.add(t.id);
                selectTag(t.id);
            } else {
                state.checkedTagIds.delete(t.id);
                if (state.selectedTagId === t.id) {
                    selectTag(null);
                }
            }
            saveState();
        };
        
        c.appendChild(row);
    });

    const selectAllBtn = $('selectAllTagsBtn');
    const removeBtn = $('removeSelTagsBtn');
    
    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            const boxes = c.querySelectorAll('.tagCheck');
            const allOn = [...boxes].every(cb => cb.checked);
            boxes.forEach(cb => {
                cb.checked = !allOn;
                const tagId = cb.dataset.id;
                if (cb.checked) {
                    state.checkedTagIds.add(tagId);
                } else {
                    state.checkedTagIds.delete(tagId);
                }
            });
            saveState();
            updateRemoveTagsBtn();
        };
    }
    
    if (removeBtn) {
        removeBtn.onclick = async () => {
            const ids = [...c.querySelectorAll('.tagCheck:checked')].map(cb => cb.dataset.id);
            for (const id of ids) {
                await removeTag(id);
            }
        };
    }
    
    c.addEventListener('change', () => updateRemoveTagsBtn());
    updateRemoveTagsBtn();

    function updateRemoveTagsBtn() {
        const removeBtn = $('removeSelTagsBtn');
        if (removeBtn) {
            removeBtn.disabled = !c.querySelector('.tagCheck:checked');
        }
    }
}

function selectTag(id) {
    state.selectedTagId = id;
    renderTags();
    renderContacts();
}

function renderContacts() {
    const c = $('contactContainer');
    const h = $('contactHeader');
    if (!c) return;

    c.innerHTML = '';

    let list = state.contacts;
    if (state.selectedTagId) list = list.filter(ct => ct.tags.includes(state.selectedTagId));
    if (searchTerm) list = list.filter(ct => ct.name.toLowerCase().includes(searchTerm));

    const contactCount = $('contactCount');
    if (contactCount) contactCount.textContent = list.length;

    // Update the static section title with active tag name
    if (h) {
        const selectedTagName = state.selectedTagId ? state.tags.find(t => t.id === state.selectedTagId)?.name : '';
        h.textContent = selectedTagName ? `Contacts (${selectedTagName})` : 'Contacts';
    }

    if (!list.length) {
        c.innerHTML = `
            <div class="emptyState">
                ${state.selectedTagId ? 'No contacts in this tag' : 'No contacts yet'}
            </div>`;
        return;
    }

    // Render header row with All/Remove inside the content container (same pattern as tags)
    const headerRow = document.createElement('div');
    headerRow.className = 'contactHeaderRow';
    headerRow.innerHTML = `
        <span>Contacts</span>
        <div class="headerActions">
            <button id="selectAllContactsBtn" title="Select / deselect all">All</button>
            <button id="removeSelContactsBtn" title="Remove selected" disabled>Remove</button>
        </div>`;
    c.appendChild(headerRow);

    list.forEach(ct => {
        const d = document.createElement('div');
        d.className = 'contact';
        d.dataset.id = ct.id;
        
        const profileImageSrc = ct.profilePicture && ct.profilePicture !== 'null' && ct.profilePicture.trim() !== ''
            ? ct.profilePicture 
            : `https://i.pravatar.cc/36?u=${ct.id}`;
        
        d.innerHTML = `
            <input type="checkbox" class="rowCheck">
            <img src="${escapeHtml(profileImageSrc)}"
                 data-fallback="https://i.pravatar.cc/36?u=${escapeHtml(ct.id)}"
                 alt="${escapeHtml(ct.name)}"
                 loading="lazy"/>
            <div class="info">
                <div class="name">${escapeHtml(ct.name)}</div>
                <div class="snippet">${ct.source === 'facebook_group' ? 'Facebook Group' : ct.userId ? 'Messenger Contact' : 'Manual Entry'}</div>
                <div class="badges">${ct.tags.map(tid => {
                    const t = state.tags.find(x => x.id === tid);
                    return t ? `<span class="badge" style="background:${escapeHtml(t.color)}">${escapeHtml(t.name)}</span>` : '';
                }).join('')}</div>
            </div>`;
        c.appendChild(d);
    });

    const selectAllBtn = $('selectAllContactsBtn');
    const removeBtn = $('removeSelContactsBtn');
    
    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            const boxes = c.querySelectorAll('.rowCheck');
            const allOn = [...boxes].every(cb => cb.checked);
            boxes.forEach(cb => cb.checked = !allOn);
            updateRemoveContactsBtn();
        };
    }
    
    if (removeBtn) {
        removeBtn.onclick = async () => {
            const ids = [...c.querySelectorAll('.rowCheck:checked')].map(cb => cb.closest('.contact').dataset.id);
            if (ids.length === 0) return;
            removeBtn.disabled = true;
            try {
                await removeContactsBulk(ids);
            } finally {
                updateRemoveContactsBtn();
            }
        };
    }
    
    c.addEventListener('change', () => updateRemoveContactsBtn());
    updateRemoveContactsBtn();

    function updateRemoveContactsBtn() {
        const removeBtn = $('removeSelContactsBtn');
        if (removeBtn) {
            removeBtn.disabled = !c.querySelector('.rowCheck:checked');
        }
    }
}

function updateTemplateUI() {
    const template = state.templates[state.currentTemplateIndex];
    const nameInput = $('templateNameInput');
    const messageArea = $('bulkMessage');
    
    if (nameInput && template) nameInput.value = template.name;
    if (messageArea && template) messageArea.value = template.body;
    
    setupTemplateNavigation();
}

/* ===============================
   EVENT LISTENERS SETUP
   =============================== */

function setupAuthEventListeners() {
    // JWT Form submission
    const jwtForm = document.getElementById('jwtForm');
    if (jwtForm) {
        jwtForm.onsubmit = async (e) => {
            e.preventDefault();
            const tokenInput = document.getElementById('jwtTokenInput');
            if (tokenInput && tokenInput.value.trim()) {
                await handleJWTAuthentication(tokenInput.value.trim());
            }
        };
    }
    
    // Open dashboard button
    const openDashboardFromWelcome = document.getElementById('openDashboardFromWelcome');
    
    if (openDashboardFromWelcome) {
        openDashboardFromWelcome.onclick = openWebDashboard;
    }

    // Open support button
    const openSupportBtn = document.getElementById('openSupportBtn');
    if (openSupportBtn) {
        openSupportBtn.onclick = () => chrome.tabs.create({ url: CONFIG.SUPPORT_URL });
    }

    // Setup dropdown and validation
    setupUserDropdown();
    
    console.log('[CRM Popup] Auth event listeners setup complete');
}

function setupEventListeners() {
    console.log('[Popup] Setting up event listeners...');
    
    // Search functionality
    const debouncedSearch = debounce((term) => {
        searchTerm = term.toLowerCase();
        renderTags();
        renderContacts();
    }, 300);
    
    const searchInput = $('searchBox');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));
        searchInput.addEventListener('keyup', (e) => debouncedSearch(e.target.value));
    }
    
    // Collapse/expand tags section
    const collapseBtn = $('collapseTagsBtn');
    if (collapseBtn) {
        collapseBtn.onclick = () => {
            const tagsSection = document.querySelector('.tags-section');
            if (tagsSection) {
                tagsSection.classList.toggle('collapsed');
                collapseBtn.classList.toggle('collapsed');
            }
        };
    }
    
    // Collapse/expand contacts section
    const collapseContactsBtn = $('collapseContactsBtn');
    if (collapseContactsBtn) {
        collapseContactsBtn.onclick = () => {
            const contactsSection = document.querySelector('.contacts-section');
            if (contactsSection) {
                contactsSection.classList.toggle('collapsed');
                collapseContactsBtn.classList.toggle('collapsed');
            }
        };
    }

    // Tag and contact management event delegation
    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('tagCheck')) {
            updateTagCounts();
        } else if (e.target.classList.contains('rowCheck')) {
            updateContactCounts();
        }
    });
}

function updateTagCounts() {
    const checkedCount = state.checkedTagIds.size;
    
    // Update remove button if it exists
    const removeBtn = document.querySelector('.remove-tags-btn');
    if (removeBtn) {
        removeBtn.disabled = checkedCount === 0;
        removeBtn.textContent = checkedCount > 0 ? 
            `Remove (${checkedCount})` : 'Remove Tags';
    }
}

function updateContactCounts() {
    const checkedBoxes = document.querySelectorAll('#contactContainer .rowCheck:checked');
    const checkedCount = checkedBoxes.length;
    
    // Update remove button if it exists
    const removeBtn = document.querySelector('.remove-contacts-btn');
    if (removeBtn) {
        removeBtn.disabled = checkedCount === 0;
        removeBtn.textContent = checkedCount > 0 ? 
            `Remove (${checkedCount})` : 'Remove Contacts';
    }
}

function setupAddTagForm() {
    const addTagBtn = $('addTagBtn');
    const saveTagBtn = $('saveTagBtn');
    const cancelTagBtn = $('cancelTagBtn');
    const newTagNameInput = $('newTagName');
    const addForm = $('addForm');
    const colorOptions = document.querySelectorAll('.modern-color');
    
    let selectedColor = '#4F46E5'; // Default color
    
    if (addTagBtn) {
        addTagBtn.onclick = () => {
            if (addForm) {
                addForm.style.display = 'block';
                if (newTagNameInput) newTagNameInput.focus();
            }
        };
    }
    
    if (saveTagBtn) {
        saveTagBtn.onclick = async () => {
            const name = newTagNameInput?.value.trim();
            if (!name) {
                toast('Please enter a tag name', false);
                return;
            }
            
            const result = await addTag(name, selectedColor);
            if (result.success) {
                if (newTagNameInput) newTagNameInput.value = '';
                if (addForm) addForm.style.display = 'none';
                // Reset color selection
                colorOptions.forEach(c => c.classList.remove('selected'));
                if (colorOptions[0]) {
                    colorOptions[0].classList.add('selected');
                    selectedColor = colorOptions[0].dataset.color;
                }
            }
        };
    }
    
    if (cancelTagBtn) {
        cancelTagBtn.onclick = () => {
            if (addForm) addForm.style.display = 'none';
            if (newTagNameInput) newTagNameInput.value = '';
            // Reset color selection
            colorOptions.forEach(c => c.classList.remove('selected'));
            if (colorOptions[0]) {
                colorOptions[0].classList.add('selected');
                selectedColor = colorOptions[0].dataset.color;
            }
        };
    }
    
    // Color selection
    colorOptions.forEach(option => {
        option.onclick = () => {
            colorOptions.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            selectedColor = option.dataset.color;
        };
    });
    
    // Set default selection
    if (colorOptions[0]) {
        colorOptions[0].classList.add('selected');
    }
    
    // Enter key support
    if (newTagNameInput) {
        newTagNameInput.onkeypress = (e) => {
            if (e.key === 'Enter') {
                saveTagBtn?.click();
            }
        };
    }
}

function setupThemeToggle() {
    // Light mode only — no toggle needed
}

function setupActionButtons() {
    // Bulk messaging
    const bulkBtn = $('bulkBtn');
    const closeBulkBtn = $('closeBulk');
    const closeBulkX = $('closeBulkX');
    const sendBulkConfirm = $('sendBulkConfirm');
    
    if (bulkBtn) bulkBtn.onclick = openBulkModal;
    if (closeBulkBtn) closeBulkBtn.onclick = () => $('bulkModal').style.display = 'none';
    if (closeBulkX) closeBulkX.onclick = () => $('bulkModal').style.display = 'none';
    if (sendBulkConfirm) sendBulkConfirm.onclick = handleBulkSendConfirm;
    
    // Export functionality
    const exportBtn = $('exportBtn');
    const closeExportBtn = $('closeExportX');
    const cancelExport = $('cancelExport');
    const exportConfirmBtn = $('confirmExport');
    
    if (exportBtn) exportBtn.onclick = openExportModal;
    if (closeExportBtn) closeExportBtn.onclick = () => $('exportModal').style.display = 'none';
    if (cancelExport) cancelExport.onclick = () => $('exportModal').style.display = 'none';
    if (exportConfirmBtn) exportConfirmBtn.onclick = handleExportConfirm;
    
    // Export format change handler
    const formatRadios = document.querySelectorAll('input[name="exportFormat"]');
    formatRadios.forEach(radio => {
        radio.addEventListener('change', handleExportFormatChange);
    });
    
    // Save selected contacts functionality
    const saveSelectedBtn = $('saveSelectedBtn');
    const confirmSaveSelectedBtn = $('confirmSaveSelected');
    const cancelSaveSelected = $('cancelSaveSelected');
    const closeSaveSelectedBtn = $('closeSaveX');
    
    if (saveSelectedBtn) saveSelectedBtn.onclick = handleSaveSelected;
    if (confirmSaveSelectedBtn) confirmSaveSelectedBtn.onclick = confirmSaveSelected;
    if (cancelSaveSelected) cancelSaveSelected.onclick = () => $('saveSelectedModal').style.display = 'none';
    if (closeSaveSelectedBtn) closeSaveSelectedBtn.onclick = () => $('saveSelectedModal').style.display = 'none';
    
    // Modal backdrop click handlers
    const modals = ['bulkModal', 'exportModal', 'saveSelectedModal'];
    modals.forEach(modalId => {
        const modal = $(modalId);
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            };
        }
    });
}

/* ===============================
   CONTACT NOTES FUNCTIONALITY
   =============================== */

let notesState = {
  contactsWithNotes: [],
  isLoading: false
};

/**
 * Load contacts that have notes from the Laravel backend
 */
async function loadContactsWithNotes() {
  console.log('[Notes] Loading contacts with notes...');
  notesState.isLoading = true;

  try {
    let token;
    try { token = window.fixedJwtAuth?.getJwtToken(); } catch (e) { token = null; }
    if (!token) {
      console.log('[Notes] No auth token available');
      displayNotesEmpty('Please log in to view notes');
      return;
    }

    const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/notes/contacts/all`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[Notes] API error:', response.status);
      displayNotesEmpty('Error loading notes');
      return;
    }

    const data = await response.json();
    console.log('[Notes] API response:', data);

    if (data.success && data.data && data.data.length > 0) {
      notesState.contactsWithNotes = data.data;
      displayNotesList(data.data);
    } else {
      displayNotesEmpty();
    }
  } catch (error) {
    console.error('[Notes] Error loading contacts with notes:', error);
    displayNotesEmpty('Error loading notes');
  } finally {
    notesState.isLoading = false;
  }
}

/**
 * Display list of contacts with notes
 */
function displayNotesList(contacts) {
  const emptyState = document.getElementById('notesEmptyState');
  const listContainer = document.getElementById('notesListContainer');
  const countBadge = document.getElementById('notesContactCount');

  if (!listContainer) return;

  if (contacts.length === 0) {
    displayNotesEmpty();
    return;
  }

  // Update count
  if (countBadge) countBadge.textContent = contacts.length;

  // Hide empty state, show list
  if (emptyState) emptyState.style.display = 'none';
  listContainer.style.display = 'block';

  // Populate list
  listContainer.innerHTML = contacts.map(contact => `
    <div class="note-contact-card" data-user-id="${escapeHtml(contact.userId || contact.contactUserId)}">
      <div class="note-contact-info">
        <div class="note-contact-avatar">
          ${contact.profilePicture ?
            `<img src="${escapeHtml(contact.profilePicture)}" alt="${escapeHtml(contact.contactName || contact.name)}">` :
            `<div class="note-contact-avatar-placeholder">${escapeHtml((contact.contactName || contact.name || '?').charAt(0).toUpperCase())}</div>`
          }
        </div>
        <div class="note-contact-details">
          <div class="note-contact-name">${escapeHtml(contact.contactName || contact.name)}</div>
          <div class="note-contact-meta">
            <span>${contact.noteCount || 1} note${(contact.noteCount || 1) > 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>
      <button class="btn-view-notes" data-user-id="${escapeHtml(contact.userId || contact.contactUserId)}" data-user-name="${escapeHtml(contact.contactName || contact.name)}" data-profile-picture="${escapeHtml(contact.profilePicture || '')}">
        View
      </button>
    </div>
  `).join('');

  // Add event listeners to view buttons — open inline detail view
  listContainer.querySelectorAll('.btn-view-notes').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openNotesDetailView(
        btn.dataset.userId,
        btn.dataset.userName,
        btn.dataset.profilePicture || null
      );
    });
  });
}

/* ─── Notes Detail View (inline in popup) ─── */

let notesDetailState = {
  userId: null,
  userName: null,
  profilePicture: null,
  notes: [],
  isLoading: false
};

function openNotesDetailView(userId, userName, profilePicture) {
  notesDetailState.userId = userId;
  notesDetailState.userName = userName;
  notesDetailState.profilePicture = profilePicture;

  const modal = document.getElementById('notesDetailModal');
  if (modal) modal.style.display = 'flex';

  // Populate header
  const avatarEl = document.getElementById('notesDetailAvatar');
  const nameEl = document.getElementById('notesDetailName');
  const countEl = document.getElementById('notesDetailCount');
  if (avatarEl) {
    avatarEl.innerHTML = profilePicture
      ? `<img src="${escapeHtml(profilePicture)}" alt="${escapeHtml(userName)}">`
      : `<div class="note-contact-avatar-placeholder">${escapeHtml((userName || '?').charAt(0).toUpperCase())}</div>`;
  }
  if (nameEl) nameEl.textContent = userName;
  if (countEl) countEl.textContent = 'Loading...';

  // Setup close button
  const closeBtn = document.getElementById('notesModalCloseBtn');
  if (closeBtn) closeBtn.onclick = closeNotesDetailView;

  // Close on backdrop click
  const backdrop = modal?.querySelector('.modal-backdrop');
  if (backdrop) backdrop.onclick = closeNotesDetailView;

  // Setup add note
  const textarea = document.getElementById('newNoteText');
  const addBtn = document.getElementById('addNoteBtn');
  if (textarea && addBtn) {
    textarea.value = '';
    addBtn.disabled = true;
    textarea.oninput = () => { addBtn.disabled = !textarea.value.trim(); };
    addBtn.onclick = () => addNoteFromPopup();
  }

  // Load notes
  loadNotesForContact(userId);
}

function closeNotesDetailView() {
  const modal = document.getElementById('notesDetailModal');
  if (modal) modal.style.display = 'none';

  // Refresh the contacts list
  loadContactsWithNotes();
}

async function loadNotesForContact(userId) {
  const listEl = document.getElementById('notesDetailList');
  const countEl = document.getElementById('notesDetailCount');
  if (!listEl) return;

  listEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-3);font-size:12px;">Loading notes...</div>';

  try {
    let token;
    try { token = window.fixedJwtAuth?.getJwtToken(); } catch (e) { token = null; }
    if (!token) return;

    const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/notes/${userId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await response.json();

    if (data.success) {
      notesDetailState.notes = data.data || [];
      if (countEl) countEl.textContent = `${notesDetailState.notes.length} note${notesDetailState.notes.length !== 1 ? 's' : ''}`;
      renderNotesDetailList();
    }
  } catch (err) {
    console.error('[Notes] Error loading notes:', err);
    listEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--danger);font-size:12px;">Failed to load notes</div>';
  }
}

function renderNotesDetailList() {
  const listEl = document.getElementById('notesDetailList');
  if (!listEl) return;

  if (notesDetailState.notes.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-3);font-size:12px;">No notes yet. Add one above.</div>';
    return;
  }

  listEl.innerHTML = notesDetailState.notes.map(note => `
    <div class="note-item" data-note-id="${escapeHtml(note.id)}">
      <div class="note-item-text">${escapeHtml(note.text)}</div>
      <div class="note-item-footer">
        <span class="note-item-date">${formatNoteDate(note.createdAt || note.created_at)}</span>
        <div class="note-item-actions">
          <button class="note-action-btn edit" title="Edit" data-note-id="${escapeHtml(note.id)}">✏️</button>
          <button class="note-action-btn delete" title="Delete" data-note-id="${escapeHtml(note.id)}">🗑️</button>
        </div>
      </div>
    </div>
  `).join('');

  // Edit handlers
  listEl.querySelectorAll('.note-action-btn.edit').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      startEditNote(btn.dataset.noteId);
    };
  });

  // Delete handlers
  listEl.querySelectorAll('.note-action-btn.delete').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      deleteNoteFromPopup(btn.dataset.noteId);
    };
  });
}

function startEditNote(noteId) {
  const note = notesDetailState.notes.find(n => n.id == noteId);
  if (!note) return;

  const noteEl = document.querySelector(`.note-item[data-note-id="${noteId}"]`);
  if (!noteEl) return;

  noteEl.innerHTML = `
    <textarea class="modern-input note-edit-area">${escapeHtml(note.text)}</textarea>
    <div class="note-edit-actions">
      <button class="btn btn-secondary btn-sm note-cancel-edit" style="padding:2px 8px;font-size:10px;">Cancel</button>
      <button class="btn btn-primary btn-sm note-save-edit" style="padding:2px 8px;font-size:10px;">Save</button>
    </div>
  `;

  const textarea = noteEl.querySelector('textarea');
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  noteEl.querySelector('.note-cancel-edit').onclick = () => renderNotesDetailList();
  noteEl.querySelector('.note-save-edit').onclick = () => saveEditNote(noteId, textarea.value);
}

async function saveEditNote(noteId, newText) {
  if (!newText.trim()) return;

  try {
    const token = window.fixedJwtAuth?.getJwtToken();
    const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/notes/${notesDetailState.userId}/${noteId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteText: newText.trim() })
    });
    const data = await response.json();

    if (data.success) {
      const idx = notesDetailState.notes.findIndex(n => n.id == noteId);
      if (idx !== -1) {
        notesDetailState.notes[idx].text = newText.trim();
        notesDetailState.notes[idx].updatedAt = new Date().toISOString();
      }
      renderNotesDetailList();
      toast('Note updated');
    } else {
      toast('Failed to update note', false);
    }
  } catch (err) {
    console.error('[Notes] Error updating note:', err);
    toast('Failed to update note', false);
  }
}

async function deleteNoteFromPopup(noteId) {
  try {
    const token = window.fixedJwtAuth?.getJwtToken();
    const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/notes/${notesDetailState.userId}/${noteId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await response.json();

    if (data.success) {
      notesDetailState.notes = notesDetailState.notes.filter(n => n.id != noteId);
      const countEl = document.getElementById('notesDetailCount');
      if (countEl) countEl.textContent = `${notesDetailState.notes.length} note${notesDetailState.notes.length !== 1 ? 's' : ''}`;
      renderNotesDetailList();
      toast('Note deleted');
    } else {
      toast('Failed to delete note', false);
    }
  } catch (err) {
    console.error('[Notes] Error deleting note:', err);
    toast('Failed to delete note', false);
  }
}

async function addNoteFromPopup() {
  const textarea = document.getElementById('newNoteText');
  const addBtn = document.getElementById('addNoteBtn');
  if (!textarea || !textarea.value.trim()) return;

  const text = textarea.value.trim();
  addBtn.disabled = true;

  try {
    const token = window.fixedJwtAuth?.getJwtToken();
    const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/notes`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactUserId: notesDetailState.userId,
        noteText: text,
        contactName: notesDetailState.userName,
        profilePicture: notesDetailState.profilePicture
      })
    });
    const data = await response.json();

    if (data.success) {
      notesDetailState.notes.unshift(data.data);
      const countEl = document.getElementById('notesDetailCount');
      if (countEl) countEl.textContent = `${notesDetailState.notes.length} note${notesDetailState.notes.length !== 1 ? 's' : ''}`;
      textarea.value = '';
      renderNotesDetailList();
      toast('Note added');
    } else {
      toast('Failed to add note', false);
    }
  } catch (err) {
    console.error('[Notes] Error adding note:', err);
    toast('Failed to add note', false);
  } finally {
    addBtn.disabled = !textarea.value.trim();
  }
}

/**
 * Display empty state for notes
 */
function displayNotesEmpty(message = null) {
  const emptyState = document.getElementById('notesEmptyState');
  const listContainer = document.getElementById('notesListContainer');
  const countBadge = document.getElementById('notesContactCount');

  if (countBadge) countBadge.textContent = '0';
  if (listContainer) listContainer.style.display = 'none';
  if (emptyState) {
    emptyState.style.display = 'block';
    if (message) {
      emptyState.querySelector('p').textContent = message;
    }
  }
}

/**
 * Format note date for display
 */
function formatNoteDate(timestamp) {
  if (!timestamp) return 'Recently';

  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * Setup Notes section event listeners
 */
function setupNotesEventListeners() {
  // Collapse/expand functionality
  const collapseBtn = document.getElementById('collapseNotesBtn');
  if (collapseBtn) {
    collapseBtn.onclick = () => {
      const section = document.querySelector('.notes-section');
      if (section) {
        section.classList.toggle('collapsed');
        const icon = collapseBtn.querySelector('.collapse-icon');
        if (icon) {
          icon.style.transform = section.classList.contains('collapsed') ?
            'rotate(-90deg)' : 'rotate(0deg)';
        }
      }
    };
  }

  // Refresh notes button
  const refreshBtn = document.getElementById('refreshNotesBtn');
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      // Add loading state
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="rotating">
          <path d="M23 4V10H17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M20.49 15C19.9828 16.8395 18.8375 18.4734 17.2473 19.6247C15.6572 20.7759 13.7267 21.3734 11.7586 21.3218C9.79056 21.2701 7.89661 20.5719 6.36218 19.3336C4.82775 18.0954 3.74463 16.3957 3.29543 14.4812C2.84624 12.5667 3.05094 10.5486 3.87735 8.75003C4.70376 6.95147 6.10963 5.47893 7.8832 4.57007C9.65677 3.66122 11.6979 3.37368 13.6586 3.75671C15.6194 4.13974 17.3986 5.16705 18.69 6.67003L23 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;

      await loadContactsWithNotes();

      // Restore button
      setTimeout(() => {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M23 4V10H17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20.49 15C19.9828 16.8395 18.8375 18.4734 17.2473 19.6247C15.6572 20.7759 13.7267 21.3734 11.7586 21.3218C9.79056 21.2701 7.89661 20.5719 6.36218 19.3336C4.82775 18.0954 3.74463 16.3957 3.29543 14.4812C2.84624 12.5667 3.05094 10.5486 3.87735 8.75003C4.70376 6.95147 6.10963 5.47893 7.8832 4.57007C9.65677 3.66122 11.6979 3.37368 13.6586 3.75671C15.6194 4.13974 17.3986 5.16705 18.69 6.67003L23 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `;
      }, 500);
    };
  }
}

/* ===============================
   BACKGROUND SCRIPT COMMUNICATION
   =============================== */

// Listen for progress updates and other messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Popup] Received message:', message.type || message.action);
    
    try {
        switch (message.action || message.type) {
            case 'GET_USER_ID':
                console.log('[Popup] Sending userId to content script:', authState.userId);
                sendResponse({ userId: authState.userId });
                return false;

            case 'getTags':
                console.log('[Popup] Sending tags to content script');
                sendResponse({ tags: state.tags });
                return false;

            case 'getTemplates':
                console.log('[Popup] Sending templates to content script');
                sendResponse({ templates: state.templates });
                return false;

            case 'saveContactsToTags':
                // Don't forward — background already receives this message
                // directly from the content script. Forwarding causes the
                // background to process it twice, creating duplicate contacts.
                // The popup updates via CONTACTS_UPDATED and storage.onChanged.
                return false;
                
            case 'BULK_PROGRESS_UPDATE':
                updateProgressUI(message.progress);
                return false;
                
            case 'BULK_SEND_COMPLETE':
                const { total, success, failed, duration, cancelled } = message.stats;
                const minutes = Math.round(duration / 60000);
                const seconds = Math.round((duration % 60000) / 1000);
                const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
                
                const statusMessage = cancelled ? 
                    `Bulk send cancelled. Sent ${success}, Failed ${failed}` :
                    `Bulk send complete! ${success}/${total} sent in ${timeStr}`;
                
                toast(statusMessage, !cancelled);
                hideProgressUI();
                return false;
                
            case 'CONTACTS_UPDATED':
                if (message.contacts) {
                    state.contacts = message.contacts;
                    renderContacts();
                    renderTags();
                    toast('Contacts updated!');
                }
                return false;
                
            case 'FRIEND_REQUEST_TRACKED':
                if (message.friendRequest) {
                    friendRequestState.requests.push(message.friendRequest);
                }
                if (message.stats) {
                    friendRequestState.stats = message.stats;
                }
                renderFriendRequestStats();
                toast(`Friend request tracked!`);
                return false;

                case 'FRIEND_REQUEST_STATUSES_UPDATED':
  if (message.updatedCount > 0) {
    // Reload and update the display
    loadState().then(() => {
      renderFriendRequestStats();
      toast(`${message.updatedCount} friend request(s) accepted!`, true);
      
      // Show tag assignment modal if there are accepted friends
      if (message.showTagAssignmentModal && message.acceptedFriends && message.acceptedFriends.length > 0) {
        showTagAssignmentModal(message.acceptedFriends);
      }
    });
  }
  return false;

                case 'FRIEND_REQUEST_REFRESH_UPDATE':
                  if (message.refreshState) {
                    handleRefreshStateUpdate(message.refreshState);
                  }
                  return false;
                
            case 'FRIEND_REQUEST_STATUS_UPDATED':
                if (message.userId && message.status) {
                    const request = friendRequestState.requests.find(r => r.userId === message.userId);
                    if (request) {
                        request.status = message.status;
                        if (message.status === 'accepted') {
                            request.respondedAt = new Date().toISOString();
                        }
                    }
                }
                if (message.stats) {
                    friendRequestState.stats = message.stats;
                }
                renderFriendRequestStats();
                return false;
                
            default:
                // Don't handle this message - let other listeners (like background script) handle it
                return false;
        }
    } catch (error) {
        console.error('[Popup] Message handler error:', error);
        sendResponse({ success: false, error: error.message });
        return false;
    }
});

/* ===============================
   VALIDATION ERROR HANDLING
   =============================== */

/**
 * Check for Facebook account validation errors and display them
 * ONLY shows validation errors if user is already authenticated with JWT
 */
async function checkValidationError() {
    try {
        // First check if user has JWT token
        const storage = await chrome.storage.local.get(['crmFixedJwtToken', 'validationError']);
        const hasJWT = !!storage.crmFixedJwtToken;
        const validationError = storage.validationError;

        const mainInterface = document.getElementById('mainInterface');

        if (!mainInterface) {
            console.warn('[Popup] Main interface element not found in DOM');
            return;
        }

        // Only show validation errors if user already has JWT token
        // If no JWT token, let the normal auth flow handle it
        if (validationError && hasJWT) {
            console.warn('[Popup] Validation error detected (user has JWT):', validationError);

            // Check if this is specifically an ACCOUNT_NOT_LINKED error
            if (validationError.code === 'ACCOUNT_NOT_LINKED') {
                console.log('[Popup] Showing simplified disabled UI for unlinked account');

                // Hide the main interface completely and show only the disabled message
                mainInterface.innerHTML = `
                    <div style="
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        min-height: 400px;
                        padding: 40px;
                        text-align: center;
                        background: #ffffff;
                    ">
                        <div style="
                            background: #fee2e2;
                            border: 2px solid #dc2626;
                            border-radius: 12px;
                            padding: 32px;
                            max-width: 400px;
                        ">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style="color: #dc2626; margin: 0 auto 20px;">
                                <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>

                            <h2 style="
                                font-size: 24px;
                                font-weight: 700;
                                color: #991b1b;
                                margin: 0 0 16px 0;
                                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                            ">Extension Disabled</h2>

                            <p style="
                                font-size: 15px;
                                color: #7f1d1d;
                                line-height: 1.6;
                                margin: 0;
                                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                            ">This Facebook account is not linked to your CRM. Please add it in the CRM settings under "Facebook Accounts".</p>
                        </div>
                    </div>
                `;

                mainInterface.style.display = 'flex';
                return;
            }

            // For other validation errors, show the banner (old behavior)
            const banner = document.getElementById('validationErrorBanner');
            const messageElement = document.getElementById('validationErrorMessage');

            if (banner && messageElement) {
                const errorMessages = {
                    'NO_FB_USER': 'Could not detect your Facebook account. Make sure you are logged into Facebook.',
                    'ACCOUNT_DEACTIVATED': 'This Facebook account has been deactivated in the CRM.',
                    'INVALID_JWT': 'Your CRM authentication has expired. Please re-authenticate in the extension.',
                    'VALIDATOR_LOAD_FAILED': 'Extension validation system failed to load. Please reinstall the extension.',
                    'VALIDATION_ERROR': 'Failed to validate account. Please check your internet connection and try again.'
                };

                const errorMessage = errorMessages[validationError.code] || validationError.error || 'Unknown validation error';
                messageElement.textContent = errorMessage;
                banner.style.display = 'block';
                console.log('[Popup] Displaying validation error banner');
            }
        } else {
            // No error or no JWT - hide banner if it exists
            const banner = document.getElementById('validationErrorBanner');
            if (banner) {
                banner.style.display = 'none';
            }

            if (validationError && !hasJWT) {
                console.log('[Popup] Validation error exists but user has no JWT - clearing old error');
                // Clear the validation error since it's not relevant without JWT
                await chrome.storage.local.remove(['validationError']);
            }
        }
    } catch (error) {
        console.error('[Popup] Error checking validation error:', error);
    }
}

/* ===============================
   INITIALIZATION
   =============================== */

// Handle image fallbacks via event delegation instead of inline onerror
document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG' && e.target.dataset.fallback) {
        e.target.src = e.target.dataset.fallback;
        delete e.target.dataset.fallback; // prevent infinite loop
    }
}, true);

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Popup] DOM loaded, initializing complete popup...');

    try {
        // FIRST: Clear any stale validation errors if no JWT token exists
        const storage = await chrome.storage.local.get(['crmFixedJwtToken', 'validationError']);
        if (!storage.crmFixedJwtToken && storage.validationError) {
            console.log('[Popup] No JWT but validation error exists - clearing stale error');
            await chrome.storage.local.remove(['validationError']);
        }

        // Load data from storage first (this includes synced data from web app)
        console.log('[Popup] Loading data from storage...');
        await loadState();

        // Render UI with loaded data
        renderTags();
        renderContacts();
        renderFriendRequestStats();
        updateLastCheckTimestamp(); // Update timestamp display on popup load
        updateTemplateUI();

        // Setup all event listeners
        setupAuthEventListeners();
        setupEventListeners();
        setupAddTagForm();
        setupActionButtons();
        setupThemeToggle();
        setupFriendRequestEventListeners();
        setupNotesEventListeners();

        // Initialize authentication FIRST
        await initializeAuthentication();

        // THEN check for validation errors (only matters if user is authenticated)
        await checkValidationError();

        // Load notes after authentication
        setTimeout(() => loadContactsWithNotes(), 1000);

        // Check for active bulk operations and restore progress UI
        await checkAndRestoreBulkProgress();

        // Check for pending tag assignment modals
        await checkForPendingTagAssignmentModal();

        // Reset export form
        resetExportForm();

        // Start periodic device validation check
        if (authState.isAuthenticated) {
            startDeviceValidationCheck();
        }

        console.log('[Popup] Complete initialization finished');

    } catch (error) {
        console.error('[Popup] Initialization failed:', error);
        authState.error = 'Initialization failed';
        showAuthModal();
    }
});

/**
 * Periodic device validation check
 * Checks if the device is still valid on the backend
 */
let deviceValidationInterval = null;

function startDeviceValidationCheck() {
    // Clear any existing interval
    if (deviceValidationInterval) {
        clearInterval(deviceValidationInterval);
    }

    // Check every 30 seconds
    deviceValidationInterval = setInterval(async () => {
        if (!authState.isAuthenticated || !authState.deviceId) {
            return;
        }

        try {
            const jwtToken = window.fixedJwtAuth.token;
            if (!jwtToken) return;

            // Validate device with backend
            const response = await fetch(`${CONFIG.API_BASE_URL}/devices/validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${jwtToken}`
                },
                body: JSON.stringify({
                    deviceId: authState.deviceId
                })
            });

            if (!response.ok) {
                const data = await response.json();
                console.warn('[Popup] Device validation failed:', data);

                // Device has been revoked - sign out
                if (response.status === 401 || response.status === 403) {
                    console.log('[Popup] Device revoked - signing out automatically');
                    clearInterval(deviceValidationInterval);
                    deviceValidationInterval = null;

                    // Clear credentials without calling backend (already revoked)
                    await window.fixedJwtAuth.clearCredentials();
                    await chrome.storage.local.remove(['validationError', 'validatedFacebookAccount']);

                    authState.isAuthenticated = false;
                    authState.userId = null;
                    authState.userName = null;
                    authState.userEmail = null;
                    authState.deviceId = null;
                    authState.currentView = 'welcome';

                    state.tags = [];
                    state.contacts = [];
                    state.selectedTagId = null;
                    state.checkedTagIds.clear();

                    const mainInterface = document.getElementById('mainInterface');
                    if (mainInterface) mainInterface.style.display = 'none';

                    showAuthModal();
                    updateAuthUI();

                    toast('Your session has been revoked. Please sign in again.', false);
                }
            }
        } catch (error) {
            console.error('[Popup] Device validation check error:', error);
        }
    }, 30000); // Check every 30 seconds
}

function stopDeviceValidationCheck() {
    if (deviceValidationInterval) {
        clearInterval(deviceValidationInterval);
        deviceValidationInterval = null;
    }
}

// Guard flag: when true, ignore incoming storage changes (e.g. during local delete)
let _suppressStorageListener = false;

// Listen for storage changes from background script
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local') {
        if (_suppressStorageListener) {
            console.log('[Popup] Storage listener suppressed (local operation in progress)');
            return;
        }
        let shouldRerender = false;

        if (changes.contacts) {
            console.log('[Popup] Contacts changed in storage, reloading...');
            state.contacts = changes.contacts.newValue || [];
            shouldRerender = true;
        }

        if (changes.tags) {
            console.log('[Popup] Tags changed in storage, reloading...');
            state.tags = changes.tags.newValue || [];
            shouldRerender = true;
        }

        if (changes.templates) {
            console.log('[Popup] Templates changed in storage, reloading...');
            const templateData = changes.templates.newValue;
            if (templateData) {
                if (Array.isArray(templateData)) {
                    state.templates = templateData;
                } else if (templateData.templates) {
                    state.templates = templateData.templates;
                    state.currentTemplateIndex = templateData.currentTemplateIndex || 0;
                }
            }
            updateTemplateUI();
        }

        // Check for validation error changes
        if (changes.validationError) {
            console.log('[Popup] Validation error status changed');
            await checkValidationError();
        }

        if (shouldRerender) {
            renderTags();
            renderContacts();
        }
    }
});

/* ===============================
   TOKEN EXPIRY DISPLAY FUNCTIONS
   =============================== */

/**
 * Update the token expiry display in the user profile
 */
function updateTokenExpiryDisplay() {
  const tokenExpiryContainer = document.getElementById('tokenExpiryContainer');
  const tokenExpiryText = document.getElementById('tokenExpiryText');
  
  if (!tokenExpiryContainer || !tokenExpiryText) {
    console.warn('[Popup] Token expiry elements not found');
    return;
  }
  
  try {
    // Get auth status from JWT service
    const authStatus = window.fixedJwtAuth?.getAuthStatus();
    
    if (!authStatus?.isAuthenticated || !authStatus.expiresAt) {
      tokenExpiryContainer.style.display = 'none';
      return;
    }
    
    const expiryDate = new Date(authStatus.expiresAt);
    const now = new Date();
    const timeDiff = expiryDate.getTime() - now.getTime();
    
    // Hide if token is expired
    if (timeDiff <= 0) {
      tokenExpiryContainer.style.display = 'none';
      return;
    }
    
    // Calculate time remaining
    const daysRemaining = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    const hoursRemaining = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    let displayText = '';
    let cssClass = '';
    
    if (daysRemaining > 7) {
      displayText = `Token expires in ${daysRemaining} days`;
      cssClass = '';
    } else if (daysRemaining > 1) {
      displayText = `Token expires in ${daysRemaining} days`;
      cssClass = 'warning';
    } else if (daysRemaining === 1) {
      displayText = `Token expires in 1 day`;
      cssClass = 'warning';
    } else if (hoursRemaining > 1) {
      displayText = `Token expires in ${hoursRemaining} hours`;
      cssClass = 'critical';
    } else {
      displayText = `Token expires soon`;
      cssClass = 'critical';
    }
    
    // Update the display
    tokenExpiryText.textContent = displayText;
    tokenExpiryText.className = `token-expiry-text ${cssClass}`;
    tokenExpiryContainer.style.display = 'block';
    
    console.log('[Popup] Token expiry updated:', displayText);
    
  } catch (error) {
    console.error('[Popup] Error updating token expiry display:', error);
    tokenExpiryContainer.style.display = 'none';
  }
}

/**
 * Start periodic token expiry updates
 */
function startTokenExpiryUpdates() {
  // Update immediately
  updateTokenExpiryDisplay();
  
  // Update every hour
  setInterval(updateTokenExpiryDisplay, 60 * 60 * 1000);
  
  // Also update every minute if token expires soon (< 24 hours)
  setInterval(() => {
    const authStatus = window.fixedJwtAuth?.getAuthStatus();
    if (authStatus?.expiresAt) {
      const expiryDate = new Date(authStatus.expiresAt);
      const now = new Date();
      const hoursRemaining = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      if (hoursRemaining > 0 && hoursRemaining < 24) {
        updateTokenExpiryDisplay();
      }
    }
  }, 60 * 1000); // Every minute
}

console.log('[Popup] Complete JWT popup script loaded');