/**
 * FACEBOOK GROUPS CRM EXTENSION - CONTENT SCRIPT (jQuery Version)
 *
 * Injects CRM UI elements into Facebook Group member list pages, enabling bulk
 * operations on group members directly from the Facebook Groups interface.
 *
 * Runs on: facebook.com (group pages, matched via manifest.json)
 *
 * Dependencies:
 *   - jQuery: loaded via manifest.json content_scripts before this file
 *   - config.js: provides CONFIG object (API base URL, endpoints)
 *   - facebook-account-validator.js: validates linked Facebook account before activation
 *
 * Communication:
 *   - Sends chrome.runtime.sendMessage() to background.js for friend request tracking,
 *     contact saving, and tag operations. Content scripts cannot call the HTTP localhost
 *     CRM backend directly from HTTPS facebook.com (mixed content / CSP).
 *
 * DOM Interaction:
 *   - Detects group member list containers and injects action buttons (Load All,
 *     Select All, Tag, Send Requests) above the member rows.
 *   - Injects checkboxes next to each group member row for multi-select.
 *   - Auto-scrolls the member list during "Load All" to force Facebook to render
 *     all members (lazy-loaded), then extracts member info (name, profile URL, picture).
 *   - Attaches click listeners to native "Add Friend" buttons to track sent requests.
 *   - A MutationObserver watches for new member rows and re-injects checkboxes.
 *
 * Key Features:
 *   - Load All Members: auto-scrolls the member list to load all lazy-rendered rows
 *   - Select All: toggle-selects every visible group member
 *   - Bulk Tag Assignment: modal to assign CRM tags to selected members
 *   - Send Friend Requests: clicks the native "Add Friend" button for each selected member
 *   - Friend Request Tracking: monitors sent requests, records them in the CRM backend,
 *     and periodically checks for status changes (accepted / pending)
 */

console.log('[Groups CRM] 🚀 Script loaded on:', location.href);
console.log('[Groups CRM] 🔧 Script version: Fixed Friend Request Tracking v2.0');


/* ===============================
   WEB APP COMMUNICATION HANDLER
   Responds to PING messages from the CRM webapp so it can detect extension presence.
   Also injects a hidden marker element into the DOM as a secondary detection method.
   =============================== */
window.addEventListener('message', (event) => {
  // Only accept messages from same origin
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;

  // Handle PING from web app
  if (event.data?.source === 'crm-webapp' && event.data?.type === 'PING') {
    console.log('[Groups CRM] Received PING from web app, sending PONG');
    window.postMessage({
      source: 'crm-extension',
      type: 'PONG',
      messageId: event.data.messageId,
      timestamp: Date.now()
    }, window.location.origin);
  }
});

// Add a marker element to indicate extension is present
const extensionMarker = document.createElement('div');
extensionMarker.id = 'crm-extension-marker';
extensionMarker.setAttribute('data-crm-extension', 'true');
extensionMarker.style.display = 'none';
document.head.appendChild(extensionMarker);

// Global state
window.selectedGroupMembers = new Set();
let extensionActive = false;
let buttons = null;

// Load All state management
let loadAllState = {
  isActive: false,
  totalLoaded: 0,
  startTime: null,
  lastScrollPosition: 0,
  noNewContentCount: 0,
  maxScrollAttempts: 30,
  stuckCount: 0,
  lastContactCount: 0,
  memberLimit: null
};

// jQuery is loaded via manifest content_scripts before this file
validateAndInitialize();

/* ===============================
   FACEBOOK DOM SELECTORS CONFIGURATION
   Centralised map of CSS selectors for Facebook Groups DOM elements.
   Grouped by risk level: Facebook may change class-based selectors at any time,
   while role/aria-label selectors are more stable across updates.
   ===============================

   ⚠️ IMPORTANT: Update these selectors when Facebook changes their UI

   This centralized configuration makes it easy to update selectors
   when Facebook modifies their DOM structure or class names.

   FRAGILITY INDICATORS:
   🔴 HIGH RISK - Auto-generated classes (x1abc, x2def) - Change frequently
   🟡 MEDIUM RISK - Attribute selectors - More stable but can change
   🟢 LOW RISK - Semantic selectors (role, aria-label) - Most stable
   =============================== */

const SELECTORS = {
    /* ============================================
       GROUP MEMBER ROWS
       Selectors for individual member row elements in the group member list.
       ============================================ */

    // 🟡 Member list items
    MEMBER_ROW: 'div[role="listitem"][data-visualcompletion="ignore-dynamic"]',

    // 🟢 Profile links in groups
    GROUP_PROFILE_LINK: 'a[href*="/groups/"][href*="/user/"]',

    /* ============================================
       BUTTONS & CONTROLS
       Selectors for native Facebook buttons (e.g., "Add Friend") within member rows.
       ============================================ */

    // 🟢 Role-based button selectors (most stable)
    ROLE_BUTTON: 'div[role="button"]',
    ROLE_BUTTON_ANY: '[role="button"]',

    // 🟢 Friend request buttons (aria-label based)
    ADD_FRIEND_ARIA: '[aria-label*="Add Friend"], [aria-label*="Add friend"], [aria-label*="add friend"], [aria-label*="ADD FRIEND"]',

    /* ============================================
       MODALS & UI ELEMENTS
       Selectors for CRM-injected modals (Load All progress, member limit input).
       ============================================ */

    // Extension-created modal IDs
    MEMBER_LIMIT_MODAL: '#member-limit-modal',
    LIMIT_INPUT: '#member-limit-input',
    LIMIT_CANCEL_BTN: '#limit-cancel-btn',
    LIMIT_CONFIRM_BTN: '#limit-confirm-btn',
    LOAD_ALL_MODAL: '#load-all-modal',
    CANCEL_LOAD_BTN: '#cancel-load-all-btn',
    LOAD_PROGRESS_TEXT: '#load-progress-text',
    LOAD_PROGRESS_BAR: '#load-progress-bar',
    MEMBER_COUNT: '#member-count',
    ELAPSED_TIME: '#elapsed-time',

    /* ============================================
       EXTENSION UI ELEMENTS
       Selectors for CRM-injected checkboxes, action buttons, and containers.
       ============================================ */

    // CRM custom selectors (created by extension)
    GROUPS_CRM_CHECKBOX: '.groups-crm-checkbox',
    GROUPS_CRM_NOTES_BTN: '.groups-crm-notes-btn',
    GROUPS_TOAST: '.groups-toast',
    GROUPS_TOAST_ANIMATIONS: '#groups-toast-animations',
    CRM_FRIEND_REQUEST_INDICATOR: '.crm-friend-request-indicator',
    CRM_TOAST: '.crm-toast',
    CRM_TOAST_STYLES: '#crmToastStyles',

    /* ============================================
       BUTTON IDS
       ID selectors for the main CRM action buttons injected above the member list.
       ============================================ */

    TAG_COUNTER: '#tag-counter',
    REQUEST_COUNTER: '#request-counter',
    GROUPS_SELECT_ALL: '#groups-select-all',
    GROUPS_TAG_BTN: '#groups-tag-btn',
    GROUPS_SEND_REQUEST: '#groups-send-request',
    GROUPS_LOAD_ALL: '#groups-load-all',

    /* ============================================
       TAG MODAL
       Selectors for the tag assignment modal overlay and its child elements.
       ============================================ */

    GROUPS_CRM_MODAL: '#groups-crm-modal',
    TAG_LIST: '#tag-list',
    MODAL_CANCEL: '#modal-cancel',
    MODAL_SAVE: '#modal-save',
    TAG_OPTION: '.tag-option',

    /* ============================================
       SVG & PROFILE DATA
       Selectors for extracting member profile pictures from SVG image elements.
       ============================================ */

    SVG_ARIA_LABEL: 'svg[aria-label]',
    IMG_IMAGE_ELEMENTS: 'img, image',

    /* ============================================
       DATA ATTRIBUTES
       Custom data-* attribute names used by the extension to mark processed elements.
       ============================================ */

    CRM_TRACKED: '[data-crm-tracked]',
    CRM_TRACKED_TRUE: '[data-crm-tracked="true"]',
    CRM_PROCESSED: '[data-crm-processed]'
};

/* ===============================
   UTILITY FUNCTIONS
   General helpers: HTML escaping and other shared utilities.
   =============================== */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sanitizeColor(color) {
  return /^#[0-9A-Fa-f]{3,8}$/.test(color) ? color : '#3f51b5';
}

/* ===============================
   DETECTION FUNCTIONS
   Determines whether the current Facebook page is a Group Members page
   by checking the URL path and looking for the member list container in the DOM.
   =============================== */

function isGroupPage() {
  const hasGroups = location.href.includes('/groups/');
  const hasMembersOrPeople = location.href.includes('/members') || location.href.includes('/people');
  
  console.log('[Groups CRM] 📍 Page detection:', {
    url: location.href,
    hasGroups: hasGroups,
    hasMembersOrPeople: hasMembersOrPeople,
    isGroupPage: hasGroups && hasMembersOrPeople
  });
  
  return hasGroups && hasMembersOrPeople;
}

function hasAdminAccess() {
  // REMOVED: Admin check - extension now works for all users
  console.log('[Groups CRM] 👮 Admin access check: DISABLED (works for all users)');
  return true; // Always return true
}

function shouldActivate() {
  const isGroup = isGroupPage();
  // REMOVED: Admin check - extension now works for all users

  console.log('[Groups CRM] 🔍 Activation check:', {
    currentUrl: location.href,
    isGroupPage: isGroup,
    shouldActivate: isGroup
  });

  return isGroup; // Only check if it's a group page
}

/* ===============================
   IMPROVED MEMBER EXTRACTION
   Parses each group member row to extract name, profile URL, userId, and profile
   picture. Attaches the extracted data to the DOM element via jQuery .data().
   =============================== */

function extractUserId(href) {
  if (!href) return null;
  
  // Facebook Groups user URL pattern: /groups/[groupId]/user/[userId]/
  const userMatch = href.match(/\/user\/(\d+)/);
  if (userMatch) {
    return userMatch[1];
  }
  
  // Facebook profile URL patterns
  const profileMatch = href.match(/facebook\.com\/([^\/\?]+)/);
  if (profileMatch && profileMatch[1] !== 'groups') {
    let profileId = profileMatch[1];
    
    // Remove any query parameters
    profileId = profileId.split('?')[0];
    
    // If it's a numeric ID, return as is
    if (/^\d+$/.test(profileId)) {
      return profileId;
    }
    
    // If it's a username, return it (Messenger can handle both)
    if (profileId !== 'profile.php' && profileId.length > 0) {
      return profileId;
    }
  }
  
  // Handle profile.php?id= format
  const profilePhpMatch = href.match(/profile\.php\?id=(\d+)/);
  if (profilePhpMatch) {
    return profilePhpMatch[1];
  }
  
  return null;
}

function extractGroupId() {
  const match = location.href.match(/\/groups\/(\d+)/);
  return match ? match[1] : null;
}

/* ===============================
   LOAD ALL FUNCTIONALITY
   Auto-scrolls the group member list to force Facebook to lazy-load all members.
   Shows a progress modal with member count and elapsed time. Supports an optional
   member limit, and can be cancelled mid-scroll. Detects scroll stalls and retries.
   =============================== */

function getCurrentContactCount() {
  const $rows = $(SELECTORS.MEMBER_ROW);
  const validRows = $rows.filter((_index, row) => {
    const $row = $(row);
    const $profileLink = $row.find(SELECTORS.GROUP_PROFILE_LINK);
    return $profileLink.length > 0;
  });
  return validRows.length;
}

function findChatContainer() {
  // Use the same approach as MemberLoader - just return document.body
  // Facebook Groups page scrolling works best with window/body scrolling
  console.log('[Groups CRM] 📄 Using document body for scrolling (MemberLoader approach)');
  return document.body;
}

function performAdvancedScroll() {
  if (!loadAllState.isActive) {
    return;
  }
  
  console.log('[Groups CRM] 🔄 Performing scroll, attempt:', loadAllState.maxScrollAttempts);
  
  // Use MemberLoader approach - simple window scrolling
  const currentScrollY = window.scrollY;
  const documentHeight = document.documentElement.scrollHeight;
  const windowHeight = window.innerHeight;
  const maxScrollY = documentHeight - windowHeight;
  
  console.log('[Groups CRM] 📊 Scroll info:', {
    currentScrollY,
    documentHeight,
    windowHeight,
    maxScrollY
  });
  
  // Check if we've reached the bottom
  if (currentScrollY >= maxScrollY - 100) {
    loadAllState.noNewContentCount++;
    console.log('[Groups CRM] Near bottom, checking for new content...');
  } else {
    loadAllState.noNewContentCount = 0;
  }
  
  // Check if we're stuck
  if (Math.abs(currentScrollY - loadAllState.lastScrollPosition) < 10) {
    loadAllState.stuckCount++;
  } else {
    loadAllState.stuckCount = 0;
  }
  
  loadAllState.lastScrollPosition = currentScrollY;
  
  // Use MemberLoader's smooth scrolling approach
  window.scrollTo({
    top: documentHeight,
    behavior: 'smooth'
  });
  
  // Wait for scroll animation to complete, then check progress
 setTimeout(async () => {
  // Wait for content to load with limit checking
  const shouldContinue = await waitForNewContent(2000);
  if (shouldContinue) {
    checkScrollProgress();
  } else {
    finishLoadAllProcess(loadAllState.memberLimit ? 'limit' : 'cancelled');
  }
}, 1000);
}

function checkScrollProgress() {
  const newContactCount = getCurrentContactCount();
  const oldCount = loadAllState.lastContactCount || loadAllState.totalLoaded;
  const hasNewContacts = newContactCount > oldCount;
  
  console.log('[Groups CRM] Progress check:', {
    oldCount,
    newCount: newContactCount,
    hasNewContacts,
    limit: loadAllState.memberLimit,
    noNewContentCount: loadAllState.noNewContentCount,
    stuckCount: loadAllState.stuckCount
  });
  
  if (hasNewContacts) {
    loadAllState.totalLoaded = newContactCount;
    loadAllState.lastContactCount = newContactCount;
    loadAllState.noNewContentCount = 0;
    loadAllState.stuckCount = 0;
  } else {
    loadAllState.noNewContentCount++;
  }
  
  updateLoadAllProgress();
  
  // Check if we've reached the member limit
  if (loadAllState.memberLimit && newContactCount >= loadAllState.memberLimit) {
    console.log('[Groups CRM] 🎯 Member limit reached:', newContactCount);
    finishLoadAllProcess('limit');
    return;
  }
  
  // Improved stopping conditions
  const shouldContinue = (
    loadAllState.isActive &&
    loadAllState.maxScrollAttempts > 0 &&
    // Stop if no new content for several attempts OR if stuck
    !(loadAllState.noNewContentCount >= 3 || loadAllState.stuckCount >= 3)
  );
  
  if (shouldContinue) {
    loadAllState.maxScrollAttempts--;
    const delay = hasNewContacts ? 2000 : 4000;
    setTimeout(performAdvancedScroll, delay);
  } else {
    // Determine why we stopped
    let reason = 'complete';
    if (loadAllState.noNewContentCount >= 3) {
      reason = 'no_new_content';
      console.log('[Groups CRM] 🏁 Stopping - no new content loaded after multiple attempts');
    } else if (loadAllState.stuckCount >= 3) {
      reason = 'stuck';
      console.log('[Groups CRM] 🏁 Stopping - scroll appears stuck');
    } else if (loadAllState.maxScrollAttempts <= 0) {
      reason = 'max_attempts';
      console.log('[Groups CRM] 🏁 Stopping - maximum scroll attempts reached');
    }
    
    finishLoadAllProcess(reason);
  }
}

function waitForNewContent(waitTime) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const endTime = startTime + waitTime;
    const checkInterval = 200; // Check every 200ms like MemberLoader
    
    const checkProgress = () => {
      // Check if loading was cancelled
      if (!loadAllState.isActive) {
        console.log('[Groups CRM] 🛑 Loading cancelled during wait');
        resolve(false);
        return;
      }
      
      // Check if we've reached our time limit
      if (Date.now() >= endTime) {
        resolve(true);
        return;
      }
      
      // Check if limit reached (like MemberLoader's limit checking)
      if (loadAllState.memberLimit) {
        const currentCount = getCurrentContactCount();
        if (currentCount >= loadAllState.memberLimit) {
          console.log('[Groups CRM] 🎯 Limit reached during wait');
          resolve(false);
          return;
        }
        
        // Update progress more frequently when near limit
        const progressPercent = (currentCount / loadAllState.memberLimit) * 100;
        if (progressPercent >= 80) {
          updateLoadAllProgress();
        }
      }
      
      setTimeout(checkProgress, checkInterval);
    };
    
    checkProgress();
  });
}
// FIXED: Member Limit Modal with proper event handling
function showMemberLimitModal(callback) {
  // Remove any existing modal
  $(SELECTORS.MEMBER_LIMIT_MODAL).remove();
  
  const modalHtml = `
    <div id="member-limit-modal" style="
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6); z-index: 25000;
      display: flex; align-items: center; justify-content: center;
    ">
      <div class="modal-content" style="
        background: white; padding: 30px; border-radius: 12px;
        max-width: 400px; width: 90%;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      ">
        <h2 style="margin: 0 0 20px 0; color: #333; text-align: center;">Load All Members</h2>
        <div style="margin: 0 0 20px 0;">
          <label for="member-limit-input" style="display: block; margin-bottom: 8px; font-weight: 500; color: #555;">
            Member Limit (optional):
          </label>
          <input type="number" id="member-limit-input" placeholder="Enter limit or leave empty for all" 
                 min="1" max="10000" style="
            width: 100%; padding: 10px 12px; border: 2px solid #ddd;
            border-radius: 6px; font-size: 14px; box-sizing: border-box;
          ">
          <div style="margin-top: 8px; font-size: 12px; color: #666;">
            Leave empty to load all available members, or enter a number to stop at that limit.
          </div>
        </div>
        <div style="display: flex; gap: 12px;">
          <button id="limit-cancel-btn" style="
            flex: 1; padding: 12px; background: #f5f5f5; color: #666; 
            border: 1px solid #ddd; border-radius: 6px; cursor: pointer; 
            font-weight: 500;
          ">Cancel</button>
          <button id="limit-confirm-btn" style="
            flex: 1; padding: 12px; background: #8b5cf6; color: white; 
            border: none; border-radius: 6px; cursor: pointer; 
            font-weight: 500;
          ">Start Loading</button>
        </div>
      </div>
    </div>
  `;
  
  $('body').append(modalHtml);
  
  // Focus the input
  setTimeout(() => {
    $(SELECTORS.LIMIT_INPUT).focus();
  }, 100);
  
  // Event handlers with proper cleanup
  function cleanup() {
    $(SELECTORS.MEMBER_LIMIT_MODAL).remove();
    $(document).off('keydown.limit-modal');
  }

  // Cancel handler
  $(SELECTORS.LIMIT_CANCEL_BTN).on('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Groups CRM] Limit modal cancelled');
    cleanup();
  });
  
  // Confirm handler
  $(SELECTORS.LIMIT_CONFIRM_BTN).on('click', function(e) {
    e.preventDefault();
    e.stopPropagation();

    const limitValue = $(SELECTORS.LIMIT_INPUT).val().trim();
    const limit = limitValue ? parseInt(limitValue, 10) : null;
    
    if (limit && (limit < 1 || limit > 10000)) {
      alert('Please enter a limit between 1 and 10,000');
      return;
    }
    
    console.log('[Groups CRM] Starting with limit:', limit);
    cleanup();
    callback(limit);
  });
  
  // Enter key in input
  $(SELECTORS.LIMIT_INPUT).on('keypress', function(e) {
    if (e.which === 13) {
      e.preventDefault();
      $(SELECTORS.LIMIT_CONFIRM_BTN).click();
    }
  });
  
  // Escape key
  $(document).on('keydown.limit-modal', function(e) {
    if (e.which === 27) {
      cleanup();
    }
  });
  
  // Backdrop click
  $(SELECTORS.MEMBER_LIMIT_MODAL).on('click', function(e) {
    if (e.target === this) {
      cleanup();
    }
  });

  // Prevent clicks inside modal from closing
  $('.modal-content').on('click', function(e) {
    e.stopPropagation();
  });
}

// FIXED: Load All Modal with proper event handling
function showLoadAllModal() {
  // Remove existing modal
  $('#load-all-modal').remove();
  
  const modalHtml = `
    <div id="load-all-modal" style="
      position: fixed; top: 20px; right: 20px;
      background: white; padding: 20px; border-radius: 10px;
      box-shadow: 0 8px 20px rgba(0,0,0,0.15);
      border: 2px solid #8b5cf6; min-width: 280px; z-index: 20000;
    ">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
        <h3 style="margin: 0; color: #8b5cf6; font-size: 16px; font-weight: 600;">
          📄 Loading Members
        </h3>
        <button id="cancel-load-all-btn" style="
          background: #ef4444; color: white; border: none;
          padding: 5px 10px; border-radius: 4px; cursor: pointer;
          font-size: 12px; font-weight: 500;
        ">Cancel</button>
      </div>
      
      <div id="load-progress-text" style="margin-bottom: 10px; color: #555; font-size: 14px;">
        Initializing...
      </div>
      
      <div style="background: #f0f0f0; border-radius: 6px; height: 8px; margin-bottom: 10px; overflow: hidden;">
        <div id="load-progress-bar" style="
          background: linear-gradient(90deg, #8b5cf6, #a855f7);
          height: 100%; width: 0%; transition: width 0.3s ease;
        "></div>
      </div>
      
      <div id="load-stats" style="display: flex; justify-content: space-between; font-size: 12px; color: #666;">
        <span id="member-count">Members: 0</span>
        <span id="elapsed-time">Time: 0s</span>
      </div>
    </div>
  `;
  
  $('body').append(modalHtml);
  
  // FIXED: Proper event binding with immediate handler
  $('#cancel-load-all-btn').on('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Groups CRM] Cancel load all clicked');
    cancelLoadAll();
  });
  
  console.log('[Groups CRM] Load All modal created and events bound');
}

function updateLoadAllProgress() {
  const progress = loadAllState;
  const elapsed = progress.startTime ? Math.round((Date.now() - progress.startTime) / 1000) : 0;
  
  let progressText = 'Loading members...';
  if (progress.memberLimit) {
    const percentage = Math.min((progress.totalLoaded / progress.memberLimit) * 100, 100);
    progressText = `Loading ${progress.totalLoaded}/${progress.memberLimit} members (${Math.round(percentage)}%)`;
    $('#load-progress-bar').css('width', `${percentage}%`);
  } else {
    progressText = `Loaded ${progress.totalLoaded} members`;
    $('#load-progress-bar').css({
      'width': '100%',
      'animation': 'pulse 2s infinite'
    });
  }
  
  $('#load-progress-text').text(progressText);
  $('#member-count').text(`Members: ${progress.totalLoaded}`);
  $('#elapsed-time').text(`Time: ${elapsed}s`);
}

function finishLoadAllProcess(reason = 'complete') {
  loadAllState.isActive = false;
  
  const elapsed = loadAllState.startTime ? Math.round((Date.now() - loadAllState.startTime) / 1000) : 0;
  const loaded = loadAllState.totalLoaded;
  
  let message = '';
  switch (reason) {
    case 'limit':
      message = `🎯 Limit reached! Loaded ${loaded} members in ${elapsed}s`;
      break;
    case 'cancelled':
      message = `ℹ️ Cancelled. Loaded ${loaded} members in ${elapsed}s`;
      break;
    case 'no_new_content':
      message = `✅ All members loaded! ${loaded} total members in ${elapsed}s`;
      break;
    case 'stuck':
      message = `⚠️ Scroll stuck. Loaded ${loaded} members in ${elapsed}s`;
      break;
    case 'max_attempts':
      message = `⏰ Max attempts reached. Loaded ${loaded} members in ${elapsed}s`;
      break;
    default:
      message = `✅ Complete! Loaded ${loaded} members in ${elapsed}s`;
  }
  
  $('#load-progress-text').text(message);
  $('#cancel-load-all-btn').text('Close').off('click').on('click', function() {
    $('#load-all-modal').remove();
  });
  
  showToast(message, reason === 'cancelled' ? 'warning' : 'success');
  updateButtons(); // Update main buttons
  
  // Trigger checkbox injection for new members
  setTimeout(() => {
    injectCheckboxes();
  }, 1000);
  
  // Auto-close modal after 5 seconds
  setTimeout(() => {
    $('#load-all-modal').fadeOut(300, function() {
      $(this).remove();
    });
  }, 5000);
}

function cancelLoadAll() {
  console.log('[Groups CRM] cancelLoadAll called, current state:', loadAllState.isActive);
  
  if (loadAllState.isActive) {
    loadAllState.isActive = false;
    console.log('[Groups CRM] Load All cancelled by user');
    finishLoadAllProcess('cancelled');
  } else {
    console.log('[Groups CRM] Load All not active, just closing modal');
    $('#load-all-modal').remove();
  }
}

// FIXED: Start process with proper callback handling
function startLoadAllProcess() {
  if (loadAllState.isActive) {
    showToast('Load All is already running!', 'warning');
    return;
  }
  
  console.log('[Groups CRM] 🚀 Starting Load All process...');
  
  const initialCount = getCurrentContactCount();
  console.log('[Groups CRM] Initial member count:', initialCount);
  
  // Show member limit input modal first with proper callback
  showMemberLimitModal((limit) => {
    console.log('[Groups CRM] Limit modal callback received:', limit);
    
    // Initialize load state
loadAllState = {
  isActive: true,
  totalLoaded: initialCount,
  startTime: Date.now(),
  lastScrollPosition: 0,
  noNewContentCount: 0,
  maxScrollAttempts: 15, // Reduced from 30
  stuckCount: 0,
  lastContactCount: initialCount,
  memberLimit: limit
};
    
    console.log('[Groups CRM] Load state initialized');
    
    // Show progress modal
    showLoadAllModal();
    updateLoadAllProgress();
    updateButtons();
    
    const limitText = limit ? `up to ${limit} members` : 'all members';
    showToast(`Starting to load ${limitText}...`, 'success');
    
    // Start scrolling after delay
    setTimeout(() => {
      console.log('[Groups CRM] Starting scroll process...');
      performAdvancedScroll();
    }, 1500);
  });
}

/* ===============================
   TOAST NOTIFICATIONS
   Displays temporary slide-in toast messages (success, warning, error)
   at the top-right of the page for user feedback.
   =============================== */

function showToast(message, type = 'info') {
  $(SELECTORS.GROUPS_TOAST).remove();
  
  let backgroundColor;
  switch (type) {
    case 'success': backgroundColor = '#10b981'; break;
    case 'error': backgroundColor = '#ef4444'; break;
    case 'warning': backgroundColor = '#f59e0b'; break;
    default: backgroundColor = '#6b7280';
  }
  
  const toast = $(`
    <div class="groups-toast" style="
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: ${backgroundColor}; color: white; padding: 12px 20px;
      border-radius: 8px; font-size: 14px; font-weight: 500; z-index: 30000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    ">${message}</div>
  `);
  
  if (!$(SELECTORS.GROUPS_TOAST_ANIMATIONS).length) {
    $('<style id="groups-toast-animations">').text(`
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
    `).appendTo('head');
  }
  
  $('body').append(toast);
  
  setTimeout(() => {
    toast.fadeOut(300, function() { $(this).remove(); });
  }, 3000);
}

/* ===============================
   BUTTON CREATION AND INJECTION
   Builds the CRM action buttons (Load All, Select All, Tag, Send Requests) and
   injects them above the group member list. Includes select-all toggle, checkbox
   handling for each member row, and friend request sending logic.
   =============================== */
// REUSABLE button factory
const ButtonFactory = {
    createButton(id, text, className, style = {}) {
        const button = document.createElement('button');
        button.id = id;
        button.textContent = text;
        button.className = className;
        Object.assign(button.style, {
            display: 'block',
            width: '100%',
            marginBottom: '8px',
            padding: '8px 12px',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '500',
            ...style
        });
        return button;
    },
    
    createContainer() {
        const container = document.createElement('div');
        container.id = 'groups-crm-buttons';
        Object.assign(container.style, {
            position: 'fixed',
            top: '80px',
            right: '20px',
            zIndex: '10000',
            background: 'rgba(255,255,255,0.95)',
            padding: '12px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            border: '2px solid #1877f2',
            minWidth: '140px'
        });
        return container;
    }
};

function makeDraggable(el, handle) {
    let isDragging = false, startX, startY, startLeft, startTop, moved;

    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, input, textarea, select')) return;
        isDragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = el.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        el.style.transition = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        el.style.left = (startLeft + dx) + 'px';
        el.style.top = (startTop + dy) + 'px';
        el.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        el.style.transition = '';
    });

    // Prevent click actions when drag just ended
    handle.addEventListener('click', (e) => {
        if (moved) { e.stopImmediatePropagation(); moved = false; }
    }, true);
}

function createButtons() {
    if (buttons) {
        buttons.remove();
    }
    
    buttons = ButtonFactory.createContainer();
    
    // Header with minimize button
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; cursor: move;';

    const headerText = document.createElement('div');
    headerText.textContent = 'GROUPS CRM';
    headerText.style.cssText = 'font-size: 11px; color: #666; font-weight: bold; flex: 1; text-align: center;';

    const minimizeBtn = document.createElement('div');
    minimizeBtn.textContent = '−';
    minimizeBtn.style.cssText = 'width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: bold; color: #666; border-radius: 4px; cursor: pointer; transition: background 0.15s; user-select: none;';
    minimizeBtn.onmouseenter = () => minimizeBtn.style.background = 'rgba(0,0,0,0.08)';
    minimizeBtn.onmouseleave = () => minimizeBtn.style.background = 'none';

    header.append(headerText, minimizeBtn);
    buttons.appendChild(header);

    // Buttons
    const loadAllBtn = ButtonFactory.createButton('groups-load-all', 'Load All', '', {
        background: '#8b5cf6',
        color: 'white'
    });

    const selectAllBtn = ButtonFactory.createButton('groups-select-all', 'Select All', '', {
        background: '#1877f2',
        color: 'white'
    });

    const tagBtn = ButtonFactory.createButton('groups-tag-btn', 'Tag (0)', '', {
        background: '#42b883',
        color: 'white'
    });

    const sendRequestBtn = ButtonFactory.createButton('groups-send-request', 'Send Requests', '', {
        background: '#9333ea',
        color: 'white'
    });
    sendRequestBtn.innerHTML = 'Send Requests (<span id="request-counter">0</span>)';
    tagBtn.innerHTML = 'Tag (<span id="tag-counter">0</span>)';

    buttons.append(loadAllBtn, selectAllBtn, tagBtn, sendRequestBtn);
    document.body.appendChild(buttons);

    // Floating logo button (hidden by default)
    let fab = document.getElementById('groups-crm-fab');
    if (!fab) {
        fab = document.createElement('div');
        fab.id = 'groups-crm-fab';
        // Use text label instead of image to avoid web_accessible_resources
        fab.innerHTML = `<span style="font-size:14px;font-weight:700;color:#1877f2;">CRM</span>`;
        Object.assign(fab.style, {
            position: 'fixed',
            top: '80px',
            right: '20px',
            zIndex: '10000',
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.97)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            border: '2px solid #1877f2',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'transform 0.15s, box-shadow 0.15s'
        });
        fab.onmouseenter = () => { fab.style.transform = 'scale(1.08)'; fab.style.boxShadow = '0 6px 18px rgba(0,0,0,0.25)'; };
        fab.onmouseleave = () => { fab.style.transform = 'scale(1)'; fab.style.boxShadow = '0 4px 14px rgba(0,0,0,0.18)'; };
        fab.onclick = () => {
            fab.style.display = 'none';
            buttons.style.display = 'block';
        };
        document.body.appendChild(fab);
    }

    // Minimize handler
    minimizeBtn.onclick = () => {
        buttons.style.display = 'none';
        fab.style.display = 'flex';
    };

    // Make panel draggable via header
    makeDraggable(buttons, header);
    // Make fab draggable
    makeDraggable(fab, fab);
    
    // Event listeners
    loadAllBtn.onclick = startLoadAllProcess;
    selectAllBtn.onclick = handleSelectAll;
    tagBtn.onclick = openTagModal;
    sendRequestBtn.onclick = handleSendRequests;
}

function updateButtons() {
  const count = window.selectedGroupMembers.size;
  $(SELECTORS.TAG_COUNTER).text(count);
  
  // Update send request counter
  // Update send request counter
const eligibleForRequest = Array.from(window.selectedGroupMembers).filter(member => {
  // Find the checkbox for this member
  const memberCheckbox = $(`input${SELECTORS.GROUPS_CRM_CHECKBOX}`).filter(function() {
    const memberData = $(this).data('memberObject');
    return memberData && memberData.userId === member.userId;
  });

  if (memberCheckbox.length > 0) {
    const memberRow = memberCheckbox.closest(SELECTORS.MEMBER_ROW);
    
    if (memberRow.length) {
      // Look for "Add friend" button
      const addFriendBtn = memberRow.find([
        '[aria-label*="Add Friend"]',
        '[aria-label*="Add friend"]', 
        '[aria-label*="add friend"]',
        '[aria-label*="ADD FRIEND"]'
      ].join(', ')).filter(function() {
        const text = $(this).text().toLowerCase();
        const ariaLabel = $(this).attr('aria-label')?.toLowerCase() || '';
        return text.includes('add friend') || ariaLabel.includes('add friend');
      });
      
      // Also check by button text
      if (addFriendBtn.length === 0) {
        const buttonByText = memberRow.find('div[role="button"]').filter(function() {
          const text = $(this).text().toLowerCase().trim();
          return text === 'add friend';
        });
        return buttonByText.length > 0;
      }
      
      return addFriendBtn.length > 0;
    }
  }
  return false;
}).length;
  
  $(SELECTORS.REQUEST_COUNTER).text(eligibleForRequest);

  // Update select all button text
  const $checkboxes = $(SELECTORS.GROUPS_CRM_CHECKBOX);
  const allChecked = $checkboxes.length > 0 && $checkboxes.filter(':checked').length === $checkboxes.length;
  $(SELECTORS.GROUPS_SELECT_ALL).text(allChecked ? 'Deselect All' : 'Select All');
  
  // Update tag button appearance
  const tagBtn = $(SELECTORS.GROUPS_TAG_BTN)[0];
  if (tagBtn) {
    tagBtn.style.background = count > 0 ? '#42b883' : '#94a3b8';
    tagBtn.style.opacity = count > 0 ? '1' : '0.8';
  }
  
  // Update send request button appearance
  const sendRequestBtn = $(SELECTORS.GROUPS_SEND_REQUEST)[0];
  if (sendRequestBtn) {
    sendRequestBtn.style.background = eligibleForRequest > 0 ? '#9333ea' : '#94a3b8';
    sendRequestBtn.style.opacity = eligibleForRequest > 0 ? '1' : '0.8';
  }
  
  // Update Load All button state (existing code...)
  const loadAllBtn = $(SELECTORS.GROUPS_LOAD_ALL)[0];
  if (loadAllBtn) {
    if (loadAllState.isActive) {
      loadAllBtn.style.background = '#ef4444';
      loadAllBtn.textContent = 'Cancel Load';
      $(loadAllBtn).off('click').on('click', function(e) {
        e.preventDefault();
        console.log('[Groups CRM] Cancel Load clicked from main button');
        cancelLoadAll();
      });
    } else {
      loadAllBtn.style.background = '#8b5cf6';
      loadAllBtn.textContent = 'Load All';
      $(loadAllBtn).off('click').on('click', function(e) {
        e.preventDefault();
        console.log('[Groups CRM] Load All clicked from main button');
        startLoadAllProcess();
      });
    }
  }
}

function handleSelectAll() {
  const $checkboxes = $(SELECTORS.GROUPS_CRM_CHECKBOX);
  const allChecked = $checkboxes.length > 0 && $checkboxes.filter(':checked').length === $checkboxes.length;
  
  $checkboxes.each(function() {
    const $cb = $(this);
    if (allChecked) {
      $cb.prop('checked', false);
      const memberData = $cb.data('memberObject');
      if (memberData) {
        window.selectedGroupMembers.forEach(item => {
          if (typeof item === 'object' && item.userId === memberData.userId) {
            window.selectedGroupMembers.delete(item);
          }
        });
      }
    } else {
      $cb.prop('checked', true);
      const memberData = $cb.data('memberObject');
      if (memberData) {
        window.selectedGroupMembers.add(memberData);
      }
    }
  });
  
  updateButtons();
}

function handleSendRequests() {
  if (window.selectedGroupMembers.size === 0) {
    showToast('Please select some members first!', 'warning');
    return;
  }
  
  const selectedMembers = Array.from(window.selectedGroupMembers);
  const eligibleMembers = [];
  
  // Check each selected member for "Add friend" button
  selectedMembers.forEach(member => {
    // Find the checkbox for this member
    const memberCheckbox = $(`input${SELECTORS.GROUPS_CRM_CHECKBOX}`).filter(function() {
      const memberData = $(this).data('memberObject');
      return memberData && memberData.userId === member.userId;
    });

    if (memberCheckbox.length > 0) {
      // Get the parent row (listitem)
      const memberRow = memberCheckbox.closest(SELECTORS.MEMBER_ROW);
      
      if (memberRow.length) {
        // Look for "Add friend" button with various possible aria-labels and text content
        const addFriendBtn = memberRow.find([
          '[aria-label*="Add Friend"]',
          '[aria-label*="Add friend"]', 
          '[aria-label*="add friend"]',
          '[aria-label*="ADD FRIEND"]'
        ].join(', ')).filter(function() {
          const text = $(this).text().toLowerCase();
          const ariaLabel = $(this).attr('aria-label')?.toLowerCase() || '';
          return text.includes('add friend') || ariaLabel.includes('add friend');
        });
        
        // Also check by button text content
        if (addFriendBtn.length === 0) {
          const buttonByText = memberRow.find('div[role="button"]').filter(function() {
            const text = $(this).text().toLowerCase().trim();
            return text === 'add friend';
          });
          
          if (buttonByText.length > 0) {
            eligibleMembers.push({
              member: member,
              button: buttonByText[0],
              row: memberRow[0]
            });
          }
        } else {
          eligibleMembers.push({
            member: member,
            button: addFriendBtn[0],
            row: memberRow[0]
          });
        }
      }
    }
  });
  
  console.log(`[Groups CRM] Debug: Selected ${selectedMembers.length}, Eligible ${eligibleMembers.length}`);
  
  if (eligibleMembers.length === 0) {
    showToast('No eligible members for friend requests (all are already friends or have pending requests)', 'warning');
    return;
  }
  
  const confirmMessage = `Send friend requests to ${eligibleMembers.length} members?\n\n` +
    `Note: Members who are already friends or have pending requests will be skipped.`;
  
  if (!confirm(confirmMessage)) {
    return;
  }
  
  // Start sending requests
  sendFriendRequestsSequentially(eligibleMembers);
}

async function sendFriendRequestsSequentially(eligibleMembers) {
  let successCount = 0;
  let skipCount = 0;
  
  showToast(`Starting to send ${eligibleMembers.length} friend requests...`, 'success');
  
  for (let i = 0; i < eligibleMembers.length; i++) {
    const { member, row } = eligibleMembers[i];
    
    try {
      // Check if button still exists and is still "Add friend"
      const currentButton = $(row).find('[aria-label*="Add Friend"], [aria-label*="Add friend"]');
      
      if (currentButton.length === 0) {
        console.log(`[Groups CRM] Skipping ${member.name} - button no longer available`);
        skipCount++;
        continue;
      }
      
      // Check if already tracked to avoid duplicates
      if (currentButton[0].dataset.crmTracked === 'true') {
        console.log(`[Groups CRM] Skipping ${member.name} - already tracked`);
        skipCount++;
        continue;
      }
      
      // Extract member data using your existing function
      const memberData = extractMemberDataWithFriendButton(currentButton[0]);
      if (memberData) {
        // Create request data with your existing format
        const requestData = {
          userId: memberData.userId,
          name: memberData.name,
          normalizedName: normalizeNameForMatching(memberData.name),
          profilePicture: memberData.profilePicture,
          groupId: memberData.groupId,
          status: 'pending',
          sentAt: new Date().toISOString(),
          respondedAt: null
        };
        
        // Add to local tracking (your existing functionality)
        trackedFriendRequests.set(memberData.userId, requestData);
        
        // Mark button as tracked BEFORE clicking (your existing functionality)
        currentButton[0].dataset.crmTracked = 'true';
        
        console.log(`[Groups CRM] Sending friend request to ${member.name}`);
        
        // Click the add friend button
        currentButton[0].click();
        
        // Update button UI with tracking indicator (your existing functionality)
        updateFriendRequestButtonUI(currentButton[0], 'pending');
        
        // Send tracking data to background script (your existing functionality)
        chrome.runtime.sendMessage({
          action: 'trackFriendRequest',
          requestData: requestData
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(`[Groups CRM] Extension communication error for ${memberData.name}`);
            return;
          }
          
          if (response && response.success) {
            console.log(`[Groups CRM] Friend request tracked for ${memberData.name}`);
          } else {
            console.error(`[Groups CRM] Failed to track friend request for ${memberData.name}:`, response?.error);
          }
        });
        
        successCount++;
      } else {
        console.log(`[Groups CRM] Could not extract member data for ${member.name}`);
        skipCount++;
      }
      
      // Add delay between requests to avoid spam detection
      if (i < eligibleMembers.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
      }
      
    } catch (error) {
      console.error(`[Groups CRM] Error sending request to ${member.name}:`, error);
      skipCount++;
    }
  }
  
  // Show completion message
  let message = `Friend request sending complete!\n`;
  message += `• Sent & Tracked: ${successCount}\n`;
  if (skipCount > 0) {
    message += `• Skipped: ${skipCount}`;
  }
  
  showToast(message, 'success');
  
  // Update button counts since some may have changed from "Add friend" to "Cancel request"
  setTimeout(() => {
    updateButtons();
  }, 1000);
}

/**
 * Normalize name for matching between groups and friends list
 */
function normalizeNameForMatching(name) {
  if (!name) return '';
  
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

/**
 * Check if two names match (handles variations)
 */
function namesMatch(name1, name2) {
  if (!name1 || !name2) return false;
  
  const norm1 = normalizeNameForMatching(name1);
  const norm2 = normalizeNameForMatching(name2);
  
  // Exact match
  if (norm1 === norm2) return true;
  
  // Check if one name is contained in the other (for partial matches)
  const words1 = norm1.split(' ').filter(w => w.length > 1);
  const words2 = norm2.split(' ').filter(w => w.length > 1);
  
  // If both names have at least 2 words and share 2+ words, consider it a match
  if (words1.length >= 2 && words2.length >= 2) {
    const commonWords = words1.filter(word => words2.includes(word));
    return commonWords.length >= 2;
  }
  
  // For single names or short names, require exact match
  return norm1 === norm2;
}

/* ===============================
   FRIEND REQUEST TRACKING
   Monitors clicks on native "Add Friend" buttons, records each sent request in
   the CRM backend via background.js, and adds a visual "Tracked" badge overlay.
   Also detects name-matching for fuzzy member identification.
   =============================== */

// Friend request tracking state
let friendRequestTrackingActive = false;
let trackedFriendRequests = new Map(); // userId -> requestData

/**
 * Set up friend request tracking functionality
 */
function setupFriendRequestTracking() {
  console.log('[Groups CRM] 🤝 Setting up friend request tracking...');
  
  // Use mousedown to capture button state BEFORE it changes
  document.addEventListener('mousedown', handleFriendRequestClick, true);
  
  // Monitor for status changes
  setInterval(checkForFriendRequestStatusChanges, 5000);
  
  friendRequestTrackingActive = true;
  console.log('[Groups CRM] ✅ Friend request tracking active');
}

/**
 * Handle friend request button clicks
 */
function handleFriendRequestClick(event) {
  if (!friendRequestTrackingActive) return;
  
  let button = event.target.closest('div[role="button"]');
  
  if (!button) {
    // Try alternate selectors for buttons
    button = event.target.closest('[role="button"]') || 
             event.target.closest('button') || 
             event.target.closest('[aria-label*="Add"]') ||
             event.target.closest('[aria-label*="add"]');
    
    if (!button) return;
  }
  
  // Capture the button state BEFORE the click changes it
  const buttonText = button.textContent?.trim().toLowerCase();
  const ariaLabel = button.getAttribute('aria-label')?.toLowerCase();
  
  // Determine if this is a friend request action (either adding or canceling)
  const isAddingFriend = 
    buttonText?.includes('add friend') ||
    buttonText === 'add' ||
    ariaLabel?.includes('add friend') ||
    ariaLabel?.includes('add as friend');
    
  const isCancelingRequest = 
    buttonText?.includes('cancel') ||
    buttonText?.includes('pending') ||
    buttonText?.includes('request sent') ||
    buttonText?.includes('cancel request') ||
    ariaLabel?.includes('cancel') ||
    ariaLabel?.includes('pending') ||
    ariaLabel?.includes('request sent') ||
    ariaLabel?.includes('cancel request');
  
  const isFriendRequestButton = isAddingFriend || isCancelingRequest;
  
  if (!isFriendRequestButton) return;
  
  // Handle cancellation of friend requests
  if (isCancelingRequest) {
    const memberData = extractMemberDataWithFriendButton(button);
    if (memberData) {
      // Remove from local tracking
      trackedFriendRequests.delete(memberData.userId);
      
      // Send removal message to background script
      chrome.runtime.sendMessage({
        action: 'removeFriendRequest',
        userId: memberData.userId
      }, (response) => {
        if (response && response.success) {
          showToast(`Friend request to ${memberData.name} cancelled`, 'info');
        }
      });
      
      // Remove tracking indicator
      button.dataset.crmTracked = 'false';
      const indicator = button.querySelector('.crm-friend-request-indicator');
      if (indicator) indicator.remove();
    }
    return;
  }
  
  // Only proceed if adding friend
  if (!isAddingFriend) return;
  
  // Prevent duplicate tracking for rapid clicks
  if (button.dataset.crmTracked === 'true') return;
  
  try {
    // Extract member data from the row
    const memberData = extractMemberDataWithFriendButton(button);
    if (!memberData) return;
    
    // Track the friend request
    const requestData = {
  userId: memberData.userId,
  name: memberData.name,
  // ADDED: Normalize name for matching
  normalizedName: normalizeNameForMatching(memberData.name),
  profilePicture: memberData.profilePicture,
  groupId: memberData.groupId,
  status: 'pending',
  sentAt: new Date().toISOString(),
  respondedAt: null
};
    
    trackedFriendRequests.set(memberData.userId, requestData);
    
    // Mark button as tracked
    button.dataset.crmTracked = 'true';
    
    // Update button UI
    updateFriendRequestButtonUI(button, 'pending');
    
    // Send tracking data to background script
    chrome.runtime.sendMessage({
      action: 'trackFriendRequest',
      requestData: requestData
    }, (response) => {
      if (chrome.runtime.lastError) {
        showToast('Extension communication error', 'error');
        return;
      }
      
      if (response && response.success) {
        showToast(`Friend request to ${memberData.name} tracked!`, 'success');
      } else {
        showToast(`Failed to track friend request: ${response?.error || 'Unknown error'}`, 'error');
      }
    });
    
  } catch (error) {
    console.error('[Groups CRM] ❌ Error handling friend request click:', error);
  }
}

/**
 * Extract member data from a row containing a friend request button
 */
function extractMemberDataWithFriendButton(button) {
  try {
    // Find the containing list item
    const listItem = button.closest(SELECTORS.MEMBER_ROW);
    if (!listItem) {
      console.log('[Groups CRM] ❌ Could not find list item for friend request button');
      return null;
    }
    
    // Find profile link
    const $listItem = $(listItem);
    const $profileLink = $listItem.find(SELECTORS.GROUP_PROFILE_LINK);
    
    if (!$profileLink.length) {
      console.log('[Groups CRM] ❌ Could not find profile link in friend request row');
      return null;
    }
    
    // Extract user data
    let memberName = 'Unknown';
    let userId = null;
    let profilePicture = null;
    
    // Extract name
    const ariaLabel = $profileLink.attr('aria-label');
    const linkText = $profileLink.text().trim();
    const $svg = $listItem.find(SELECTORS.SVG_ARIA_LABEL);
    const svgLabel = $svg.attr('aria-label');
    
    if (svgLabel && svgLabel.trim()) {
      memberName = svgLabel.trim();
    } else if (ariaLabel && ariaLabel.trim()) {
      memberName = ariaLabel.trim();
    } else if (linkText && linkText.length > 1) {
      memberName = linkText;
    }
    
    // Extract userId
    userId = extractUserId($profileLink.attr('href'));
    
    // Extract profile picture using Messenger's proven method  
    profilePicture = extractGroupsProfilePicture($listItem);
    
    if (!userId) {
      console.log('[Groups CRM] ❌ Could not extract userId from friend request row');
      return null;
    }
    
    const memberData = {
      name: memberName,
      userId: userId,
      profilePicture: profilePicture,
      source: 'facebook_group',
      groupId: extractGroupId()
    };
    
    console.log('[Groups CRM] ✅ Extracted member data for friend request:', memberData);
    return memberData;
    
  } catch (error) {
    console.error('[Groups CRM] ❌ Error extracting member data from friend request button:', error);
    return null;
  }
}

/**
 * Update friend request button UI with tracking indicators
 */
function updateFriendRequestButtonUI(button, status) {
  try {
    if (!button) return;
    
    // Add tracking indicator
    if (!button.querySelector('.crm-friend-request-indicator')) {
      const indicator = document.createElement('div');
      indicator.className = 'crm-friend-request-indicator';
      indicator.style.cssText = `
        position: absolute;
        top: -4px;
        right: -4px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #10b981;
        border: 2px solid white;
        z-index: 1000;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      `;
      indicator.title = 'Friend request tracked by CRM';
      
      // Ensure button has relative positioning
      if (window.getComputedStyle(button).position === 'static') {
        button.style.position = 'relative';
      }
      
      button.appendChild(indicator);
    }
    
    // Update button tooltip
    const originalTitle = button.title || '';
    if (!originalTitle.includes('CRM tracked')) {
      button.title = originalTitle + ' (CRM tracked)';
    }
    
    console.log('[Groups CRM] ✅ Updated friend request button UI for status:', status);
    
  } catch (error) {
    console.error('[Groups CRM] ❌ Error updating friend request button UI:', error);
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  // Remove existing toasts
  const existingToasts = document.querySelectorAll('.crm-toast');
  existingToasts.forEach(toast => toast.remove());
  
  const toast = document.createElement('div');
  toast.className = 'crm-toast';
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    max-width: 300px;
    word-wrap: break-word;
    animation: slideInFromRight 0.3s ease-out;
  `;
  
  // Add animation keyframes if not already added
  if (!document.getElementById('crmToastStyles')) {
    const style = document.createElement('style');
    style.id = 'crmToastStyles';
    style.textContent = `
      @keyframes slideInFromRight {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Auto remove after 3 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'slideInFromRight 0.3s ease-out reverse';
      setTimeout(() => toast.remove(), 300);
    }
  }, 3000);
}

/**
 * Check for friend request status changes
 */
function checkForFriendRequestStatusChanges() {
  if (!friendRequestTrackingActive || trackedFriendRequests.size === 0) return;
  
  try {
    // Find all previously tracked buttons and check their status
    const trackedButtons = document.querySelectorAll('div[role="button"][data-crm-tracked="true"]');
    
    trackedButtons.forEach(button => {
      const buttonText = button.textContent?.trim().toLowerCase();
      const ariaLabel = button.getAttribute('aria-label')?.toLowerCase();
      
      // Check if button text has changed (indicates status change)
      if (buttonText === 'pending' || buttonText === 'request sent' || 
          ariaLabel?.includes('pending') || ariaLabel?.includes('request sent')) {
        
        // Update local tracking status
        const listItem = button.closest('div[role="listitem"]');
        if (listItem) {
          const memberData = extractMemberDataWithFriendButton(button);
          if (memberData && trackedFriendRequests.has(memberData.userId)) {
            const requestData = trackedFriendRequests.get(memberData.userId);
            if (requestData.status !== 'pending') {
              requestData.status = 'pending';
              requestData.lastChecked = new Date().toISOString();
              
              // Update background script
              chrome.runtime.sendMessage({
                action: 'updateFriendRequestStatus',
                userId: memberData.userId,
                status: 'pending',
                timestamp: new Date().toISOString()
              });
              
              console.log('[Groups CRM] 📱 Friend request status updated to pending for:', memberData.name);
            }
          }
        }
      }
    });
    
  } catch (error) {
    console.error('[Groups CRM] ❌ Error checking friend request status changes:', error);
  }
}

/* ===============================
   PROFILE PICTURE EXTRACTION
   Extracts the member's avatar URL from a member row element.
   Tries SVG <image> first, then falls back to <img> tags.
   =============================== */

/**
 * Extracts profile picture URL from a group member row
 */
function extractGroupsProfilePicture($element) {
  function getImageSrc($img) {
    return $img.attr('src') || $img.attr('xlink:href') || $img.get(0).getAttributeNS('http://www.w3.org/1999/xlink', 'href') || $img.attr('href') || $img.attr('data-src');
  }
  
  let profilePicture = null;
  
  // Look for profile images (they usually have t39.30808-1 in URL)
  $element.find('img, image').each(function() {
    const src = getImageSrc($(this));
    
    if (src && src.includes('scontent') && src.includes('t39.30808-1')) {
      profilePicture = src.replace(/&amp;/g, '&');
      return false; // Break the loop
    }
  });
  
  // Fallback to any scontent image
  if (!profilePicture) {
    $element.find('img, image').each(function() {
      const src = getImageSrc($(this));
      
      if (src && (src.includes('scontent') || src.includes('fbcdn'))) {
        profilePicture = src.replace(/&amp;/g, '&');
        return false; // Break the loop
      }
    });
  }
  
  return profilePicture;
}

/* ===============================
   ENHANCED CHECKBOX INJECTION
   Prepends a CRM checkbox to each group member row. When toggled, adds/removes
   the member's data (name, userId, profileUrl, profilePicture) to/from the
   selectedGroupMembers set. Skips rows that already have a checkbox injected.
   =============================== */

async function injectCheckboxes() {
  console.log('[Groups CRM] 🔄 Injecting checkboxes...');

  const $rows = $(SELECTORS.MEMBER_ROW);
  console.log('[Groups CRM] Found', $rows.length, 'potential member rows');
  
  let processed = 0;
  let skipped = 0;
  
  $rows.each((_index, row) => {
    const $row = $(row);

    if ($row.find(SELECTORS.GROUPS_CRM_CHECKBOX).length) {
      return; // Skip if already has checkbox
    }

    const $profileLink = $row.find(SELECTORS.GROUP_PROFILE_LINK);
    if (!$profileLink.length) {
      skipped++;
      return;
    }

    let memberName = 'Unknown';
    let userId = null;
    let profilePicture = null;
    
    const ariaLabel = $profileLink.attr('aria-label');
    const linkText = $profileLink.text().trim();
    const $svg = $row.find(SELECTORS.SVG_ARIA_LABEL);
    const svgLabel = $svg.attr('aria-label');
    
    if (svgLabel && svgLabel.trim()) {
      memberName = svgLabel.trim();
    } else if (ariaLabel && ariaLabel.trim()) {
      memberName = ariaLabel.trim();
    } else if (linkText && linkText.length > 1) {
      memberName = linkText;
    }
    
    userId = extractUserId($profileLink.attr('href'));
    
    // Extract profile picture using Messenger's proven method
    profilePicture = extractGroupsProfilePicture($row);
    
    if (!userId) {
      skipped++;
      return;
    }
    
    if (memberName.toLowerCase().includes('see everyone') || 
        memberName.toLowerCase().includes('admin') ||
        memberName.length < 2) {
      skipped++;
      return;
    }
    
    const memberData = {
      name: memberName,
      userId: userId,
      profilePicture: profilePicture,
      source: 'facebook_group',
      groupId: extractGroupId(),
      // Initialize friend request status
      friendRequestStatus: {
        status: 'none',
        sentAt: null,
        respondedAt: null
      }
    };

    const $checkbox = $('<input>', {
      type: 'checkbox',
      class: 'groups-crm-checkbox',
      title: memberName
    });

    $checkbox.data('memberObject', memberData);

    $checkbox.css({
      width: '18px', height: '18px', cursor: 'pointer', accentColor: '#fb923c',
      flexShrink: '0', margin: '0 4px 0 0', alignSelf: 'center'
    });

    $checkbox.on('change', function() {
      const $cb = $(this);
      const memberObject = $cb.data('memberObject');

      if ($cb.is(':checked')) {
        window.selectedGroupMembers.add(memberObject);
      } else {
        window.selectedGroupMembers.forEach(item => {
          if (typeof item === 'object' && item.userId === memberObject.userId) {
            window.selectedGroupMembers.delete(item);
          }
        });
      }

      updateButtons();
    });

    // Insert checkbox before the avatar (first child of the row's inner flex container)
    const $innerFlex = $row.children().first();
    if ($innerFlex.length) {
      $innerFlex.css('display', 'flex');
      $innerFlex.prepend($checkbox);
    } else {
      $row.prepend($checkbox);
    }

    // Add Notes button (✏️) after the name
    const $notesBtn = $('<button>', {
      class: 'groups-crm-notes-btn',
      title: 'Notes for ' + memberName,
      html: '✏️'
    });

    $notesBtn.css({
      width: '22px', height: '22px',
      border: 'none', borderRadius: '4px',
      cursor: 'pointer', fontSize: '13px',
      background: 'transparent',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: '0', marginLeft: '4px',
      transition: 'all 0.15s', opacity: '0.6'
    });

    $notesBtn.on('mouseenter', function(e) {
      e.stopPropagation();
      $(this).css({ opacity: '1', transform: 'scale(1.15)' });
    });

    $notesBtn.on('mouseleave', function(e) {
      e.stopPropagation();
      $(this).css({ opacity: '0.6', transform: 'scale(1)' });
    });

    $notesBtn.on('mouseover mouseout focus', function(e) {
      e.stopPropagation();
    });

    $notesBtn.on('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (window.openNotesModal) {
        window.openNotesModal(memberData.userId, memberData.name, memberData.profilePicture);
      }
    });

    // Place notes button right after the name link (outside the <a> to avoid hover card)
    const $nameLink = $profileLink.filter(function() {
      return $(this).find('image, img, svg[aria-label]').length === 0 && $(this).text().trim().length > 0;
    }).first();

    if ($nameLink.length) {
      $nameLink.after($notesBtn);
    } else if ($profileLink.length > 1) {
      $profileLink.last().after($notesBtn);
    } else {
      $row.append($notesBtn);
    }
    processed++;
  });
  
  console.log('[Groups CRM] 📊 Injection complete:', { 
    total: $rows.length, processed, skipped,
    selected: window.selectedGroupMembers.size
  });
  
  updateButtons();
}

/* ===============================
   TAG MODAL
   Opens a modal overlay listing available CRM tags with checkboxes.
   The user selects tags and clicks "Save" to bulk-assign them to all
   selected group members via background.js.
   =============================== */

function openTagModal() {
  if (window.selectedGroupMembers.size === 0) {
    showToast('Please select some members first!', 'warning');
    return;
  }
  
  const existingModal = $(SELECTORS.GROUPS_CRM_MODAL);
  if (existingModal.length) existingModal.remove();
  
  const modal = $(`
    <div id="groups-crm-modal" style="
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 20000;
      display: flex; align-items: center; justify-content: center;
    ">
      <div style="
        background: white; padding: 30px; border-radius: 12px;
        max-width: 400px; width: 90%; max-height: 80vh; overflow-y: auto;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      ">
        <h2 style="margin: 0 0 20px 0; color: #333; text-align: center;">Tag Selected Members</h2>
        <div style="margin: 0 0 20px 0; text-align: center; background: #f0f8ff; padding: 15px; border-radius: 8px; border-left: 4px solid #1877f2;">
          <div style="font-size: 24px; font-weight: bold; color: #1877f2; margin-bottom: 5px;">
            ${window.selectedGroupMembers.size}
          </div>
          <div style="color: #666; font-size: 14px;">
            Members Selected
          </div>
        </div>
        <div id="tag-list" style="margin-bottom: 25px; min-height: 100px;">
          <div style="text-align: center; padding: 20px; color: #999;">
            Loading tags...
          </div>
        </div>
        <div style="display: flex; gap: 12px;">
          <button id="modal-cancel" style="
            flex: 1; padding: 14px; background: #f5f5f5; color: #666; 
            border: 1px solid #ddd; border-radius: 6px; cursor: pointer; 
            font-weight: 500; transition: all 0.2s;
          ">Cancel</button>
          <button id="modal-save" style="
            flex: 1; padding: 14px; background: #1877f2; color: white; 
            border: none; border-radius: 6px; cursor: pointer; 
            font-weight: 500; transition: all 0.2s;
          ">Save to Tags</button>
        </div>
      </div>
    </div>
  `);
  
  $('body').append(modal);

  $(SELECTORS.MODAL_CANCEL).on('click', () => modal.remove());
  $(SELECTORS.MODAL_SAVE).on('click', saveToTags);
  modal.on('click', (e) => {
    if (e.target === modal[0]) modal.remove();
  });
  
  loadTags();
}

function loadTags() {
  console.log('[Groups CRM] Loading tags via background script...');
  
  // Check if extension context is still valid
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    console.error('[Groups CRM] Extension context not available');
    showTagError();
    return;
  }
  
  try {
    chrome.runtime.sendMessage({ action: 'getTags' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Groups CRM] Error loading tags:', chrome.runtime.lastError);
        if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
          console.error('[Groups CRM] Extension was reloaded - please refresh the page');
          showExtensionReloadError();
        } else {
          showTagError();
        }
      } else if (response && response.tags) {
        console.log('[Groups CRM] Got tags:', response.tags);
        displayTags(response.tags);
      } else {
        console.log('[Groups CRM] No tags received');
        showTagError();
      }
    });
  } catch (error) {
    console.error('[Groups CRM] Exception in loadTags:', error);
    showExtensionReloadError();
  }
}

function displayTags(tags) {
  const $tagList = $(SELECTORS.TAG_LIST);
  
  if (!tags || tags.length === 0) {
    $tagList.html(`
      <div style="text-align: center; padding: 20px; color: #666; background: #f9f9f9; border-radius: 6px;">
        <div style="font-size: 20px; margin-bottom: 10px;">📋</div>
        <div>No tags available</div>
        <div style="font-size: 12px; margin-top: 5px; opacity: 0.7;">Create tags in the CRM popup first</div>
      </div>
    `);
    return;
  }
  
  const tagsHtml = tags.map(tag => {
    const safeColor = sanitizeColor(tag.color);
    const safeName = escapeHtml(tag.name);
    const safeId = escapeHtml(String(tag.id));
    return `
    <label style="
      display: flex; align-items: center; margin: 12px 0; padding: 12px;
      background: ${safeColor}08; border: 2px solid ${safeColor}20;
      border-radius: 8px; cursor: pointer; transition: all 0.2s ease;
    " class="tag-option" data-color="${safeColor}">
      <input type="checkbox" value="${safeId}" style="
        margin-right: 12px; transform: scale(1.3); accent-color: ${safeColor};
      ">
      <div style="
        width: 12px; height: 12px; background: ${safeColor}; border-radius: 50%;
        margin-right: 12px; box-shadow: 0 2px 4px ${safeColor}40;
      "></div>
      <span style="font-weight: 500; color: #333; flex: 1;">${safeName}</span>
    </label>
  `;
  }).join('');
  
  $tagList.html(tagsHtml);

  $(SELECTORS.TAG_OPTION).on('mouseenter', function() {
    const color = $(this).data('color');
    $(this).css('background', color + '15');
  }).on('mouseleave', function() {
    const color = $(this).data('color');
    $(this).css('background', color + '08');
  });
}

function showTagError() {
  $(SELECTORS.TAG_LIST).html(`
    <div style="text-align: center; padding: 20px; color: #e74c3c; background: #ffeaea; border-radius: 6px;">
      <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
      <div style="font-weight: bold; margin-bottom: 5px;">Could not load tags</div>
      <div style="font-size: 12px; opacity: 0.8;">
        Make sure the extension is installed and you've created tags
      </div>
    </div>
  `);
}

function showExtensionReloadError() {
  $(SELECTORS.TAG_LIST).html(`
    <div style="text-align: center; padding: 20px; color: #f39c12; background: #fef9e7; border-radius: 6px;">
      <div style="font-size: 24px; margin-bottom: 10px;">🔄</div>
      <div style="font-weight: bold; margin-bottom: 5px;">Extension was reloaded</div>
      <div style="font-size: 12px; opacity: 0.8;">
        Please refresh this page to continue using the extension
      </div>
    </div>
  `);
}

function saveToTags() {
  const selectedTags = [];
  $(`${SELECTORS.TAG_LIST} input[type="checkbox"]:checked`).each(function() {
    selectedTags.push($(this).val());
  });
  
  if (selectedTags.length === 0) {
    showToast('Please select at least one tag', 'warning');
    return;
  }
  
  const selectedMembers = Array.from(window.selectedGroupMembers);
  
  console.log('[Groups CRM] Saving to tags:', {
    members: selectedMembers,
    tags: selectedTags
  });
  
  const modal = $(SELECTORS.GROUPS_CRM_MODAL);
  const saveBtn = $(SELECTORS.MODAL_SAVE);
  const originalText = saveBtn.text();
  saveBtn.text('Saving...').prop('disabled', true);
  
  chrome.runtime.sendMessage({
    action: 'saveContactsToTags',
    contacts: selectedMembers,
    tagIds: selectedTags
  }, (response) => {
    saveBtn.text(originalText).prop('disabled', false);
    
    if (chrome.runtime.lastError) {
      console.error('[Groups CRM] Error saving:', chrome.runtime.lastError);
      showToast('Error saving contacts. Please try again.', 'error');
      return;
    }
    
    if (response && response.success) {
      showToast(`Successfully saved ${selectedMembers.length} members to ${selectedTags.length} tag(s)`, 'success');

      $(SELECTORS.GROUPS_CRM_CHECKBOX).prop('checked', false);
      window.selectedGroupMembers.clear();
      updateButtons();
      modal.remove();
    } else {
      showToast('Failed to save contacts: ' + (response?.error || 'Unknown error'), 'error');
    }
  });
}

/* ===============================
   MAIN LOGIC
   Core activation loop: waits for the group member list to appear in the DOM,
   then injects buttons and checkboxes. Sets up a MutationObserver and periodic
   polling to handle dynamically loaded member rows.
   =============================== */

function activate() {
  if (extensionActive) return;
  
  console.log('[Groups CRM] 🎯 Activating extension...');
  console.log('[Groups CRM] 📍 Current URL:', window.location.href);
  console.log('[Groups CRM] 🔍 Is group page:', isGroupPage());
  console.log('[Groups CRM] 👮 Has admin access:', hasAdminAccess());
  
  extensionActive = true;
  
  createButtons();
  setTimeout(injectCheckboxes, 1000);
  
  // Set up friend request tracking
  console.log('[Groups CRM] 🤝 About to set up friend request tracking...');
  setupFriendRequestTracking();
  console.log('[Groups CRM] ✅ Friend request tracking setup complete');
  
  // Set up mutation observer
  const observer = new MutationObserver(() => {
    if (extensionActive) {
      clearTimeout(window.checkboxTimeout);
      window.checkboxTimeout = setTimeout(injectCheckboxes, 800);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function deactivate() {
  if (!extensionActive) return;
  
  extensionActive = false;
  friendRequestTrackingActive = false;
  
  if (buttons) $(buttons).remove();
  $(SELECTORS.GROUPS_CRM_CHECKBOX).remove();
  $(SELECTORS.GROUPS_CRM_NOTES_BTN).remove();
  $(SELECTORS.CRM_PROCESSED).removeAttr('data-crm-processed');
  $(SELECTORS.CRM_FRIEND_REQUEST_INDICATOR).remove();
  $(SELECTORS.CRM_TRACKED).removeAttr('data-crm-tracked');
  
  window.selectedGroupMembers.clear();
  trackedFriendRequests.clear();
  
  if (loadAllState.isActive) {
    cancelLoadAll();
  }
  
  // Remove friend request tracking event listener
  document.removeEventListener('click', handleFriendRequestClick, true);
}

function checkAndActivate() {
  if (shouldActivate()) {
    activate();
  } else {
    deactivate();
  }
}

/* ===============================
   INITIALIZATION
   Entry point: validates the Facebook account via FacebookAccountValidator,
   attempts auto-link if needed, then activates the Groups CRM UI injection pipeline.
   =============================== */

/**
 * Validate Facebook account before initializing CRM
 */
async function validateAndInitialize() {
  console.log('[Groups CRM] Checking Facebook account validation...');

  // FIRST: Check if user has JWT token - if not, don't even try to validate
  const storage = await chrome.storage.local.get(['crmFixedJwtToken']);
  if (!storage.crmFixedJwtToken) {
    console.log('[Groups CRM] No JWT token found - skipping validation and initialization');
    console.log('[Groups CRM] User needs to authenticate via popup first');
    return; // Silently exit - don't show errors, don't store anything
  }

  // Validator is now loaded as a content script in manifest.json
  // Check if it's available
  if (typeof FacebookAccountValidator === 'undefined') {
    console.error('═══════════════════════════════════════════');
    console.error('[Groups CRM] ❌❌❌ VALIDATOR FAILED TO LOAD ❌❌❌');
    console.error('[Groups CRM] Extension will NOT initialize');
    console.error('═══════════════════════════════════════════');

    // Store error state for popup to display
    await chrome.storage.local.set({
      validationError: {
        error: 'Extension validation system failed to load. Please reinstall the extension.',
        code: 'VALIDATOR_LOAD_FAILED',
        timestamp: Date.now()
      }
    });

    console.error('[Groups CRM] STOPPING - Extension disabled');
    return; // Don't proceed without validator
  }

  const validation = await FacebookAccountValidator.validateAccount();

  if (!validation.valid) {
    console.error('═══════════════════════════════════════════');
    console.error('[Groups CRM] ❌❌❌ VALIDATION FAILED ❌❌❌');
    console.error('[Groups CRM] Error:', validation.error);
    console.error('[Groups CRM] Code:', validation.code);
    console.error('[Groups CRM] Extension will NOT initialize');
    console.error('═══════════════════════════════════════════');

    // Only store validation error if user has JWT token
    // If no JWT token, don't store error (let popup handle auth flow)
    const storage = await chrome.storage.local.get(['crmFixedJwtToken']);
    const hasJWT = !!storage.crmFixedJwtToken;

    if (hasJWT) {
      // User has JWT but validation failed - store error for popup
      await chrome.storage.local.set({
        validationError: {
          error: validation.error,
          code: validation.code,
          timestamp: Date.now()
        }
      });
      console.error('[Groups CRM] Validation error stored (user has JWT)');
    } else {
      console.log('[Groups CRM] No JWT token - not storing validation error');
    }

    console.error('[Groups CRM] STOPPING - Extension disabled');
    return; // Don't initialize CRM functionality
  }

  console.log('═══════════════════════════════════════════');
  console.log('[Groups CRM] ✅✅✅ VALIDATION SUCCESS ✅✅✅');
  console.log('[Groups CRM] Account:', validation.accountName);
  console.log('[Groups CRM] Proceeding with initialization...');
  console.log('═══════════════════════════════════════════');

  // Clear any previous validation errors
  await chrome.storage.local.remove(['validationError']);

  // Proceed with initialization ONLY after successful validation
  initialize();
}

function initialize() {
  console.log('[Groups CRM] 🚀 Initializing Fixed Load All Modal version...');

  setTimeout(checkAndActivate, 1000);

  // URL change monitoring
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(checkAndActivate, 1000);
    }
  }, 1000);

  // Navigation events
  window.addEventListener('popstate', () => setTimeout(checkAndActivate, 1000));

  const originalPushState = history.pushState;
  history.pushState = function() {
    originalPushState.apply(this, arguments);
    setTimeout(checkAndActivate, 1000);
  };

  // Initialize friend request cancellation monitoring
  initializeFriendRequestMonitoring();
}

/* ===============================
   FRIEND REQUEST MONITORING
   Post-initialization: listens for clicks anywhere on the page that land on
   "Add Friend" or "Cancel Request" buttons, tracks them via background.js,
   and handles messages from the popup to retrieve selected member data.
   =============================== */
function initializeFriendRequestMonitoring() {
  console.log('[Groups CRM] 🔍 Initializing friend request cancellation monitoring...');

  // Monitor for "Cancel Request" button clicks using delegation
  document.addEventListener('click', async (event) => {
    // Find if clicked element or parent is a button/link with cancel request text
    const button = event.target.closest('div[role="button"], a[role="button"], span[role="button"]');

    if (!button) return;

    const buttonText = button.textContent?.trim().toLowerCase();

    // Check if it's a cancel request button
    if (buttonText === 'cancel request' || buttonText === 'cancel' || buttonText.includes('cancel request')) {
      console.log('[Groups CRM] 🗑️ Cancel Request button clicked!');
      console.log('[Groups CRM] 🗑️ Button text:', buttonText);
      console.log('[Groups CRM] 🗑️ Button element:', button);

      // Try to find the user ID from nearby profile link
      const userId = await extractUserIdNearButton(button);

      if (userId) {
        console.log('[Groups CRM] 📍 Found user ID:', userId);

        // Wait a bit to ensure Facebook processes the cancellation
        setTimeout(async () => {
          // Send to background script to remove friend request
          chrome.runtime.sendMessage({
            action: 'removeFriendRequest',
            userId: userId
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.log('[Groups CRM] ❌ Extension error:', chrome.runtime.lastError.message);
              return;
            }

            if (response?.success) {
              console.log('[Groups CRM] ✅ Friend request removed from storage and synced to webapp');
            } else {
              console.log('[Groups CRM] ⚠️ Friend request removal response:', response);
              console.log('[Groups CRM] 💡 This friend request was not tracked by the extension.');
              console.log('[Groups CRM] 💡 Only friend requests sent through Groups CRM are tracked.');
              console.log('[Groups CRM] 💡 Use the extension popup Friend Requests tab to track existing requests.');
            }
          });
        }, 1000);
      } else {
        console.log('[Groups CRM] ⚠️ Could not find user ID for cancelled request');
      }
    }
  }, true); // Use capture phase to catch events early
}

async function extractUserIdNearButton(button) {
  try {
    // Look for profile link in parent containers
    let current = button;

    // Walk up the DOM tree to find a profile link
    for (let i = 0; i < 10; i++) {
      if (!current || !current.parentElement) break;
      current = current.parentElement;

      // Look for profile links in this container
      const profileLinks = current.querySelectorAll('a[href*="/user/"], a[href*="profile.php?id="]');

      for (const link of profileLinks) {
        const href = link.getAttribute('href');
        if (!href) continue;

        // Extract from profile.php?id= format
        const profileIdMatch = href.match(/profile\.php\?id=(\d+)/);
        if (profileIdMatch) {
          return profileIdMatch[1];
        }

        // Extract from /user/ format
        const userMatch = href.match(/\/user\/(\d+)/);
        if (userMatch) {
          return userMatch[1];
        }
      }
    }

    return null;
  } catch (error) {
    console.error('[Groups CRM] Error extracting user ID:', error);
    return null;
  }
}

// Message handling for returning selected members
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.action === 'getSelectedGroupMembers') {
      const selected = Array.from(window.selectedGroupMembers);
      console.log('[Groups CRM] Returning selected members as objects:', selected);
      reply(selected);
    }
    
    if (msg.action === 'clearGroupSelection') {
      $(SELECTORS.GROUPS_CRM_CHECKBOX).prop('checked', false);
      window.selectedGroupMembers.clear();
      updateButtons();
      reply({ status: 'cleared' });
    }
  });
}

console.log('[Groups CRM] 📜 Fixed Load All Modal script loaded');