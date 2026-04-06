/**
 * FACEBOOK MESSENGER CRM EXTENSION - CONTENT SCRIPT (jQuery Version)
 *
 * Injects CRM UI elements (Select All, Tag, Template, Notes buttons) into Facebook
 * Messenger's chat list sidebar and conversation header areas.
 *
 * Runs on: facebook.com/messages (matched via manifest.json)
 *
 * Dependencies:
 *   - jQuery: loaded via manifest.json content_scripts before this file
 *   - config.js: provides CONFIG object (API base URL, endpoints)
 *   - facebook-account-validator.js: validates linked Facebook account before activation
 *   - notesInject.js: provides window.openNotesModal() for the Notes button
 *
 * Communication:
 *   - Sends chrome.runtime.sendMessage() to background.js for all data operations
 *     (tag CRUD, template fetch, contact save) because content scripts on HTTPS pages
 *     cannot call the HTTP localhost CRM backend directly (mixed content / CSP).
 *
 * DOM Interaction:
 *   - Uses jQuery to locate the Messenger chat list ("Chats" heading) and injects
 *     Select All / Tag / Template buttons into the sidebar header area.
 *   - Injects checkboxes next to each conversation tile for multi-select.
 *   - Injects a Template button into the message composer area of the active conversation.
 *   - Injects a Notes button into the conversation header.
 *   - A MutationObserver watches for new conversation tiles and re-injects UI as needed.
 *
 * Key Features:
 *   - Select All: toggle-selects every visible conversation in the chat list
 *   - Bulk Tag Assignment: modal to assign one or more CRM tags to selected contacts
 *   - Template Insertion: modal to pick a saved template and paste it into the composer
 *   - Notes Panel: opens a per-contact notes modal via notesInject.js
 */

console.log('[CRM] Enhanced content script loaded on', location.href);

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
    console.log('[CRM] Received PING from web app, sending PONG');
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

// Add jQuery if not available
if (typeof $ !== 'undefined') {
  $(document).ready(() => {
    console.log('[CRM] jQuery already loaded, validating and initializing...');
    validateAndInitialize();
  });
} else {
  // Fallback - wait for jQuery to be available
  let checkCount = 0;
  const checkJQuery = setInterval(() => {
    checkCount++;
    if (typeof $ !== 'undefined') {
      clearInterval(checkJQuery);
      console.log('[CRM] jQuery loaded after', checkCount, 'checks');
      $(document).ready(() => validateAndInitialize());
    } else if (checkCount > 50) {
      clearInterval(checkJQuery);
      console.error('[CRM] jQuery not found after 50 checks');
    }
  }, 100);
}

/* ===============================
   GLOBAL STATE MANAGEMENT
   Tracks selected conversation users (Set of JSON-stringified objects),
   extension activation status, injected button references, and retry counters.
   =============================== */

/**
 * Global storage for selected user data and UI state
 */
window.selectedUsers = new Set();
let $selectAllButton = null;
let $tagButton = null;
let $actionButtonsContainer = null;
let $tagModal = null;
let $templateButton = null;
let $templateModal = null;

/* ===============================
   FACEBOOK DOM SELECTORS CONFIGURATION
   Centralised map of CSS selectors for Messenger DOM elements.
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
       CONVERSATION TILES & CHAT LIST
       Selectors for individual chat rows and the sidebar chat list container.
       ============================================ */

    // 🟢 Main selector for conversation links
    CONVERSATION_LINK: 'a[href*="/t/"]:not([href*="/t/user"]):not([href*="/t/group"])',

    // 🟡 Conversation name extraction
    CONVERSATION_NAME: 'span[dir="auto"] span',
    CONVERSATION_NAME_FALLBACK: 'span',

    /* ============================================
       MESSENGER UI ELEMENTS
       Selectors for the sidebar heading ("Chats"), search input, and navigation tabs.
       ============================================ */

    // 🔴 HIGH RISK - Chats title (auto-generated classes)
    CHATS_TITLE: 'span.x1lliihq.x1plvlek.xryxfnj.x1n2onr6.xyejjpt.x15dsfln.x193iq5w.xeuugli.x13faqbe.x1vvkbs.x1s928wv.xhkezso.x1gmr53x.x1cpjm7i.x1fgarty.x1943h6x.x1xmvt09.xngnso2.x1xlr1w8.xw2npq5.x14z4hjw.x3x7a5m.xq9mrsl[dir="auto"]',

    // 🟢 Fallback - More stable alternative
    CHATS_TITLE_FALLBACK: 'span[dir="auto"]',

    // 🔴 HIGH RISK - Header controls (auto-generated classes)
    HEADER_RIGHT_CONTROLS: 'div.x78zum5.x1q0g3np.x1diwwjn',

    // 🟢 Main chat container
    CHAT_CONTAINER: '[role="main"]',

    /* ============================================
       MESSAGE COMPOSER
       Selectors for the message input area where templates are inserted.
       ============================================ */

    // 🔴 HIGH RISK - Composer actions bar (auto-generated classes)
    // Use the emoji button's parent as a reliable anchor (works on facebook.com/messages)
    COMPOSER_ACTIONS: 'div.x6s0dn4.xpvyfi4.x78zum5.xl56j7k:has([aria-label="Choose an emoji"])',

    // 🟢 Message input box (multiple fallbacks for stability)
    MESSAGE_INPUT: 'div[contenteditable="true"][role="textbox"]',
    MESSAGE_INPUT_FALLBACK_1: 'div[contenteditable="true"]:not([role="button"])',
    MESSAGE_INPUT_FALLBACK_2: '[data-testid="message-input"]',
    MESSAGE_INPUT_FALLBACK_3: '.notranslate[contenteditable="true"]',

    // 🟡 Message composer paragraph structure
    MESSAGE_PARAGRAPH: 'p.xat24cr.xdj266r',

    /* ============================================
       PROFILE PICTURES
       Selectors for extracting contact avatar images from conversation tiles.
       ============================================ */

    // 🟢 Profile picture selectors (CDN URLs are stable)
    PROFILE_IMG_SCONTENT: 'img[src*="scontent"]',
    PROFILE_IMG_FBCDN: 'img[src*="fbcdn"]',
    PROFILE_IMG_DATA_SCONTENT: 'img[data-src*="scontent"]',
    PROFILE_IMG_DATA_FBCDN: 'img[data-src*="fbcdn"]',
    PROFILE_IMG_REFERRER: 'img[referrerpolicy="origin-when-cross-origin"]',
    PROFILE_BG_IMAGE: 'div[style*="background-image"]',

    /* ============================================
       CONVERSATION HEADER
       Selectors for the active conversation's top header (contact name, info link).
       ============================================ */

    // 🟢 Conversation header for name extraction
    CONVERSATION_HEADER_H1: 'h1[dir="auto"]',
    CONVERSATION_HEADER_H2: 'h2[dir="auto"]',

    /* ============================================
       EXTENSION UI ELEMENTS
       Selectors for CRM-injected elements (checkboxes, buttons, modals).
       ============================================ */

    // CRM custom selectors (created by extension)
    CRM_CHECKBOX: '.crm-check',
    CRM_NOTES_BTN: '.crm-notes-btn',
    CRM_TEMPLATE_BTN_WRAPPER: '.crm-template-button-wrapper',
    CRM_MODAL_ANIMATIONS: '#crm-modal-animations',
    CRM_TOAST_ANIMATIONS: '#crm-toast-animations',
    CRM_LOADER_ANIMATION: '#crm-loader-animation',
    CRM_TAG_COUNTER: '#crm-tag-counter',

    /* ============================================
       GENERIC SELECTORS
       General-purpose selectors reused across multiple features.
       ============================================ */

    SVG_ELEMENTS: 'svg',
    IMG_ELEMENTS: 'img',
    H1_ELEMENTS: 'h1'
};

/* ===============================
   ELEMENT DETECTION AND FILTERING
   Helpers that determine whether a DOM node is a valid Messenger conversation tile
   (as opposed to search results, stories, or other non-conversation elements).
   =============================== */

/**
 * CSS selector for targeting potential conversation links
 * Matches links containing '/t/' but excludes user and group links
 */
const USER_SELECTOR = SELECTORS.CONVERSATION_LINK;

/**
 * Enhanced validation function to ensure we only target actual conversation tiles
 */
const isValidUserTile = (tile) => {
    if (!tile.href || !tile.href.includes('/t/')) return false;

    const $tile = $(tile);

    // Exclude sidebar navigation icons — they don't contain profile <img> elements
    if (!$tile.find('img').length) return false;

    const nameEl = $tile.find(SELECTORS.CONVERSATION_NAME).first()[0] || $tile.find(SELECTORS.CONVERSATION_NAME_FALLBACK).first()[0];
    if (!nameEl || !$(nameEl).text().trim()) return false;

    if ($tile.closest(SELECTORS.SVG_ELEMENTS).length) return false;

    const rect = tile.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 30) return false;
    
    const textContent = $tile.text().trim();
    if (textContent.length < 2) return false;
    
    const svgElements = $tile.find(SELECTORS.SVG_ELEMENTS);
    const totalTextContent = $tile.text().replace(/\s+/g, ' ').trim();

    if (svgElements.length > 0 && totalTextContent.length < 3) {
        return false;
    }

    const $parent = $tile.parent();
    if ($parent.length && $parent.find(SELECTORS.SVG_ELEMENTS).length && !$parent.find(SELECTORS.IMG_ELEMENTS).length) {
        const parentRect = $parent[0].getBoundingClientRect();
        if (parentRect.width < 40 && parentRect.height < 40) {
            return false;
        }
    }
    
    return true;
};

/* ===============================
   PROFILE PICTURE EXTRACTION
   Extracts the contact's avatar URL from a conversation tile element.
   Tries SVG <image> first, then falls back to <img> tags inside the tile.
   =============================== */

/**
 * Extracts profile picture URL from a conversation tile
 */
function extractProfilePicture(tile) {
    console.log('[CRM] Extracting profile picture from tile:', tile);
    
    const $tile = $(tile);
    const selectors = [
        SELECTORS.PROFILE_IMG_SCONTENT,
        SELECTORS.PROFILE_IMG_FBCDN,
        SELECTORS.PROFILE_IMG_DATA_SCONTENT,
        SELECTORS.PROFILE_IMG_DATA_FBCDN,
        SELECTORS.PROFILE_IMG_REFERRER,
        SELECTORS.PROFILE_BG_IMAGE
    ];

    const $allImages = $tile.find(SELECTORS.IMG_ELEMENTS);
    console.log('[CRM] Found images in tile:', $allImages.length);
    
    for (const selector of selectors) {
        const $imgEl = $tile.find(selector).first();
        if ($imgEl.length) {
            console.log('[CRM] Found image with selector:', selector, $imgEl[0]);
            
            let src = $imgEl.attr('src') || $imgEl.attr('data-src');
            
            if (!src && $imgEl.css('background-image')) {
                const bgMatch = $imgEl.css('background-image').match(/url\(['"]?([^'"]+)['"]?\)/);
                if (bgMatch) src = bgMatch[1];
            }
            
            console.log('[CRM] Image src:', src);
            
            if (src && (src.includes('scontent') || src.includes('fbcdn'))) {
                let cleanUrl = src.replace(/&amp;/g, '&');
                console.log('[CRM] Found valid profile picture:', cleanUrl);
                return cleanUrl;
            }
        }
    }
    
    let fallbackUrl = null;
    $allImages.each(function() {
        const $img = $(this);
        const src = $img.attr('src') || $img.attr('data-src');
        console.log('[CRM] Checking image src:', src);
        if (src && (src.includes('scontent') || src.includes('fbcdn'))) {
            fallbackUrl = src.replace(/&amp;/g, '&');
            console.log('[CRM] Found profile picture from all images:', fallbackUrl);
            return false; // Break out of $.each
        }
    });

    if (fallbackUrl) {
        return fallbackUrl;
    }

    console.log('[CRM] No profile picture found');
    return null;
}

/* ===============================
   ACTION BUTTONS CREATION
   Builds and injects the CRM action buttons (Select All, Tag, Template, Notes)
   into the Messenger sidebar header, near the "Chats" heading.
   =============================== */

/**
 * Creates and injects the Select All and Tag buttons near the Chats title
 */
/**
 * Last-resort fallback: inject a floating toolbar fixed to the top-left of the page.
 * Used when Messenger's DOM doesn't expose a stable header to attach to.
 */
function _injectFloatingToolbar() {
    if ($actionButtonsContainer && document.body.contains($actionButtonsContainer[0])) return;

    $actionButtonsContainer = $('<div>', {
        class: 'crm-action-buttons crm-floating-toolbar',
        css: {
            position: 'fixed',
            top: '60px',
            left: '8px',
            zIndex: '99999',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '6px',
            background: 'rgba(255,255,255,0.95)',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            backdropFilter: 'blur(4px)'
        }
    });

    $selectAllButton = $('<button>', {
        class: 'crm-select-all-btn',
        text: 'Select All',
        css: {
            padding: '5px 10px',
            fontSize: '12px',
            borderRadius: '4px',
            border: '1px solid #ddd',
            background: '#fff',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
        }
    });

    $tagButton = $('<button>', {
        class: 'crm-tag-btn',
        text: 'Tag',
        css: {
            padding: '5px 10px',
            fontSize: '12px',
            borderRadius: '4px',
            border: 'none',
            background: '#1877f2',
            color: '#fff',
            cursor: 'pointer'
        }
    });

    $selectAllButton.on('click', handleSelectAll);
    $tagButton.on('click', openTagModal);

    $actionButtonsContainer.append($selectAllButton).append($tagButton);
    $('body').append($actionButtonsContainer);
    updateTagCounter();
    console.log('[CRM] Floating toolbar injected');
}

let _createActionButtonsRetries = 0;

function createActionButtons() {
    // Remove existing buttons if they exist
    if ($actionButtonsContainer) {
        $actionButtonsContainer.remove();
        $actionButtonsContainer = null;
        $selectAllButton = null;
        $tagButton = null;
    }

    // Find the Chats title element
    let $chatsTitle = $(SELECTORS.CHATS_TITLE).filter(function() {
        return $(this).text().includes('Chats');
    });

    if (!$chatsTitle.length) {
        console.log('[CRM] Chats title not found with specific selector, trying alternative...');

        // Alternative: Find any span with "Chats" text (any language: Chats/Messages/等)
        $chatsTitle = $(SELECTORS.CHATS_TITLE_FALLBACK).filter(function() {
            return $(this).text().trim() === 'Chats';
        }).first();
    }

    // If still not found, use any navigation/sidebar header as anchor
    if (!$chatsTitle.length) {
        _createActionButtonsRetries++;
        if (_createActionButtonsRetries <= 5) {
            console.log('[CRM] No Chats title found, retrying in 2 seconds... (attempt ' + _createActionButtonsRetries + ')');
            setTimeout(createActionButtons, 2000);
            return;
        }
        // After 5 retries, inject as a floating fixed-position toolbar
        console.log('[CRM] Chats title never found — injecting floating toolbar');
        _injectFloatingToolbar();
        return;
    }

    _createActionButtonsRetries = 0;
    
    console.log('[CRM] Found Chats title:', $chatsTitle[0]);
    
    // Find the header container - look for the parent div that contains both the title and the right-side controls
    let $headerContainer = $chatsTitle;
    
    // Traverse up to find the main header container
    while ($headerContainer.length && $headerContainer.parent().length) {
        const $parent = $headerContainer.parent();
        
        // Look for a container that has both the title area and action area
        if ($parent.find(SELECTORS.H1_ELEMENTS).length && $parent.children().length >= 2) {
            $headerContainer = $parent;
            break;
        }
        
        $headerContainer = $parent;
        
        // Safety check to avoid going too far up
        if ($headerContainer.is('body') || $headerContainer.attr('id') === 'mount_0_0') {
            break;
        }
    }
    
    console.log('[CRM] Using header container:', $headerContainer[0]);
    
    // Create container for action buttons
    $actionButtonsContainer = $('<div>', {
        class: 'crm-action-buttons',
        css: {
            display: 'flex',
            gap: '8px',
            marginLeft: '12px',
            alignItems: 'center',
            position: 'relative',
            zIndex: '1000'
        }
    });
    
    // Create Select All button
    $selectAllButton = $('<button>', {
        class: 'crm-select-all-btn',
        html: `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 11l3 3 8-8"></path>
                <path d="M21 12c0 1-.25 2.05-.7 3-.45.95-1.1 1.8-1.9 2.5-.8.7-1.75 1.25-2.85 1.6C14.45 19.6 13.25 19.8 12 19.8c-1.25 0-2.45-.2-3.55-.55C7.35 18.9 6.4 18.35 5.6 17.65c-.8-.7-1.45-1.55-1.9-2.5C3.25 14.05 3 13 3 12s.25-2.05.7-3c.45-.95 1.1-1.8 1.9-2.5.8-.7 1.75-1.25 2.85-1.6C9.55 4.4 10.75 4.2 12 4.2c1.25 0 2.45.2 3.55.55"></path>
            </svg>
            <span>Select All</span>
        `,
        css: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            background: '#1877f2',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
        }
    });
    
    // Create Tag button
    $tagButton = $('<button>', {
        class: 'crm-tag-btn',
        html: `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                <line x1="7" y1="7" x2="7.01" y2="7"></line>
            </svg>
            <span id="crm-tag-counter">Tag (0)</span>
        `,
        css: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            background: '#42b883',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
        }
    });
    
    // Add hover effects
    $selectAllButton.on('mouseenter', function() {
        $(this).css({
            background: '#166fe5',
            transform: 'translateY(-1px)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.15)'
        });
    }).on('mouseleave', function() {
        $(this).css({
            background: '#1877f2',
            transform: 'translateY(0)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
        });
    });
    
    $tagButton.on('mouseenter', function() {
        $(this).css({
            background: '#369870',
            transform: 'translateY(-1px)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.15)'
        });
    }).on('mouseleave', function() {
        $(this).css({
            background: '#42b883',
            transform: 'translateY(0)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
        });
    });
    
    // Add click handlers
    $selectAllButton.on('click', handleSelectAll);
    $tagButton.on('click', openTagModal);
    
    // Append buttons to container
    $actionButtonsContainer.append($selectAllButton);
    $actionButtonsContainer.append($tagButton);
    
    // Try different insertion strategies
    let inserted = false;
    
    // Strategy 1: Try to insert next to the right-side controls
    const $rightControls = $headerContainer.find(SELECTORS.HEADER_RIGHT_CONTROLS);
    if ($rightControls.length && !inserted) {
        $rightControls.css({
            display: 'flex',
            alignItems: 'center'
        });
        $rightControls.append($actionButtonsContainer);
        inserted = true;
        console.log('[CRM] Buttons inserted into right controls area');
    }
    
    // Strategy 2: Insert as a new flex item in the header
    if (!inserted && $headerContainer.children().length >= 2) {
        $headerContainer.append($actionButtonsContainer);
        inserted = true;
        console.log('[CRM] Buttons appended to header container');
    }
    
    // Strategy 3: Create a wrapper and insert after the title
    if (!inserted) {
        const $titleContainer = $chatsTitle.closest('h1');
        const $targetContainer = $titleContainer.length ? $titleContainer : $chatsTitle.parent();
        
        if ($targetContainer.length && $targetContainer.parent().length) {
            // Create a wrapper for the buttons positioned absolutely
            const $wrapper = $('<div>', {
                css: {
                    position: 'absolute',
                    top: '50%',
                    right: '16px',
                    transform: 'translateY(-50%)',
                    zIndex: '1000'
                }
            });
            
            $wrapper.append($actionButtonsContainer);
            
            // Make parent container relative
            $targetContainer.parent().css('position', 'relative');
            $targetContainer.parent().append($wrapper);
            inserted = true;
            console.log('[CRM] Buttons inserted with absolute positioning');
        }
    }
    
    if (inserted) {
        console.log('[CRM] Action buttons created and inserted successfully');
        updateTagCounter();
    } else {
        console.log('[CRM] Failed to insert buttons, retrying...');
        setTimeout(createActionButtons, 3000);
    }
}

/* ===============================
   SELECT ALL FUNCTIONALITY
   Toggles all visible conversation checkboxes on/off and updates
   the global selectedUsers set accordingly.
   =============================== */

/**
 * Handles the Select All button click
 */
function handleSelectAll() {
    const $checkboxes = $(SELECTORS.CRM_CHECKBOX);
    const allChecked = $checkboxes.length > 0 && $checkboxes.filter(':checked').length === $checkboxes.length;
    
    // Toggle all checkboxes
    $checkboxes.each(function() {
        const $checkbox = $(this);
        $checkbox.prop('checked', !allChecked);
        
        // Trigger the change event to update selectedUsers
        $checkbox.trigger('change');
    });
    
    // Update button text
    const $buttonText = $selectAllButton.find('span');
    if ($buttonText.length) {
        $buttonText.text(allChecked ? 'Select All' : 'Deselect All');
    }
    
    updateTagCounter();
    console.log('[CRM] Select all toggled:', !allChecked);
}

/* ===============================
   TAG COUNTER UPDATE
   Refreshes the tag count badge on the Tag button to reflect
   the number of currently selected conversations.
   =============================== */

/**
 * Updates the tag button counter with current selection count
 */
function updateTagCounter() {
    const $counter = $(SELECTORS.CRM_TAG_COUNTER);
    if ($counter.length) {
        const selectedCount = window.selectedUsers.size;
        $counter.text(`Tag (${selectedCount})`);
        
        // Update button appearance based on selection
        if (selectedCount > 0) {
            $tagButton.css({
                background: '#42b883',
                opacity: '1'
            });
        } else {
            $tagButton.css({
                background: '#94a3b8',
                opacity: '0.7'
            });
        }
    }
}

/* ===============================
   TAG DATA FETCHING
   Retrieves the list of available CRM tags from background.js,
   which in turn calls the CRM backend API.
   =============================== */

/**
 * Requests tags from the extension popup/background
 * @returns {Promise<Array>} Promise that resolves to array of tags
 */
async function requestTags() {
  console.log('[CRM] Requesting tags from local storage...');
  const result = await chrome.storage.local.get(['tags']);
  const tags = result.tags || [];
  console.log('[CRM] Got tags:', tags.length);
  return tags;
}

/* ===============================
   TAG MODAL CREATION
   Opens a modal overlay listing available tags with checkboxes.
   The user selects tags and clicks "Save" to bulk-assign them
   to all selected Messenger contacts.
   =============================== */

/**
 * Creates and opens the tagging modal
 */
function openTagModal() {
    const selectedCount = window.selectedUsers.size;
    if (selectedCount === 0) {
        showToast('Please select contacts first', 'warning');
        return;
    }
    
    // Remove existing modal if it exists
    if ($tagModal) {
        $tagModal.remove();
    }
    
    // Create modal backdrop
    $tagModal = $('<div>', {
        class: 'crm-tag-modal',
        css: {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '10000',
            backdropFilter: 'blur(4px)',
            animation: 'modalFadeIn 0.2s ease-out'
        }
    });
    
    // Create modal content
    const $modalContent = $('<div>', {
        css: {
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            width: '90%',
            maxWidth: '400px',
            maxHeight: '80vh',
            overflow: 'hidden',
            animation: 'modalSlideIn 0.2s ease-out'
        }
    });
    
    // Create modal header
    const $modalHeader = $('<div>', {
        css: {
            padding: '24px 24px 16px 24px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
        },
        html: `
            <div>
                <h2 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 4px 0;">
                    Tag Contacts
                </h2>
                <p style="font-size: 14px; color: #6b7280; margin: 0;">
                    Add ${selectedCount} selected contact${selectedCount > 1 ? 's' : ''} to tags
                </p>
            </div>
            <button class="crm-modal-close" style="
                width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
                background: #f3f4f6; border: none; border-radius: 6px; color: #6b7280;
                cursor: pointer; transition: all 0.15s ease;
            ">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6L18 18"></path>
                </svg>
            </button>
        `
    });
    
    // Create modal body
    const $modalBody = $('<div>', {
        css: {
            padding: '16px 24px',
            maxHeight: '300px',
            overflowY: 'auto'
        }
    });
    
    // Request tags from popup/background
    requestTags().then(tags => {
        if (tags && tags.length > 0) {
            renderTagList($modalBody, tags);
        } else {
            $modalBody.html(`
                <div style="text-align: center; padding: 20px; color: #6b7280;">
                    <p>No tags available. Create tags in the CRM popup first.</p>
                </div>
            `);
        }
    }).catch(error => {
        console.error('[CRM] Error fetching tags:', error);
        $modalBody.html(`
            <div style="text-align: center; padding: 20px; color: #ef4444;">
                <p>Error loading tags. Please try again.</p>
            </div>
        `);
    });
    
    // Create modal footer
    const $modalFooter = $('<div>', {
        css: {
            padding: '16px 24px 24px 24px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            gap: '12px'
        },
        html: `
            <button class="crm-modal-cancel" style="
                flex: 1; padding: 10px 16px; background: white; color: #374151;
                border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;
                font-weight: 500; cursor: pointer; transition: all 0.15s ease;
            ">Cancel</button>
            <button class="crm-modal-save" style="
                flex: 1; padding: 10px 16px; background: #1877f2; color: white;
                border: none; border-radius: 6px; font-size: 14px;
                font-weight: 500; cursor: pointer; transition: all 0.15s ease;
            ">Save to Tags</button>
        `
    });
    
    // Assemble modal
    $modalContent.append($modalHeader);
    $modalContent.append($modalBody);
    $modalContent.append($modalFooter);
    $tagModal.append($modalContent);
    
    // Add event listeners
    const $closeBtn = $modalHeader.find('.crm-modal-close');
    const $cancelBtn = $modalFooter.find('.crm-modal-cancel');
    const $saveBtn = $modalFooter.find('.crm-modal-save');
    
    $closeBtn.on('click', closeTagModal);
    $cancelBtn.on('click', closeTagModal);
    $saveBtn.on('click', saveToTags);
    
    // Close modal when clicking backdrop
    $tagModal.on('click', function(e) {
        if (e.target === $tagModal[0]) {
            closeTagModal();
        }
    });
    
    // Add CSS animations
    if (!$(SELECTORS.CRM_MODAL_ANIMATIONS).length) {
        $('<style id="crm-modal-animations">').text(`
            @keyframes modalFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes modalSlideIn {
                from { opacity: 0; transform: scale(0.95) translateY(-10px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
        `).appendTo('head');
    }
    
    // Append to body
    $('body').append($tagModal);
}

/**
 * Renders the tag list in the modal
 */
function renderTagList($container, tags) {
    $container.empty();
    
    if (!tags || tags.length === 0) {
        $container.html(`
            <div style="text-align: center; padding: 20px; color: #6b7280;">
                <p>No tags available. Create tags in the CRM popup first.</p>
            </div>
        `);
        return;
    }
    
    const $tagGrid = $('<div>', {
        css: {
            display: 'grid',
            gap: '8px'
        }
    });
    
    tags.forEach(tag => {
        const $tagRow = $('<label>', {
            css: {
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                background: tag.color + '15',
                border: '2px solid transparent',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
            },
            html: `
                <input type="checkbox" value="${tag.id}" style="
                    accent-color: ${tag.color};
                    cursor: pointer;
                ">
                <div style="
                    width: 12px; height: 12px; background: ${tag.color};
                    border-radius: 3px; flex-shrink: 0;
                "></div>
                <span style="
                    flex: 1; font-weight: 500; color: #374151;
                ">${tag.name}</span>
            `
        });
        
        // Add hover effect
        $tagRow.on('mouseenter', function() {
            $(this).css({
                borderColor: tag.color + '40',
                background: tag.color + '25'
            });
        }).on('mouseleave', function() {
            $(this).css({
                borderColor: 'transparent',
                background: tag.color + '15'
            });
        });
        
        $tagGrid.append($tagRow);
    });
    
    $container.append($tagGrid);
}

/**
 * Closes the tag modal
 */
function closeTagModal() {
    if ($tagModal) {
        $tagModal.css('animation', 'modalFadeOut 0.2s ease-out');
        setTimeout(() => {
            if ($tagModal) {
                $tagModal.remove();
                $tagModal = null;
            }
        }, 200);
    }
}

/**
 * Saves selected contacts to chosen tags — runs entirely in the content script,
 * no background service worker needed.
 */
async function saveToTags() {
  const selectedTagIds = [];
  $tagModal.find('input[type="checkbox"]:checked').each(function() {
    selectedTagIds.push($(this).val());
  });

  if (selectedTagIds.length === 0) {
    showToast('Please select at least one tag', 'warning');
    return;
  }

  const selectedContacts = Array.from(window.selectedUsers).map(JSON.parse);
  console.log('[CRM] Saving', selectedContacts.length, 'contacts to tags:', selectedTagIds);

  try {
    // Use the same saveContactsToTags flow as Groups for consistency.
    // Background.js handles storage, dedup, and backend sync in one place.
    const contacts = selectedContacts.map(c => ({
      name: c.name || 'Unknown',
      userId: c.userId || null,
      profilePicture: c.profilePicture || null,
      source: 'messenger'
    }));

    chrome.runtime.sendMessage({
      action: 'saveContactsToTags',
      contacts,
      tagIds: selectedTagIds
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[CRM] Error saving:', chrome.runtime.lastError);
        showToast('Error saving contacts. Please try again.', 'error');
        return;
      }
      if (response && response.success) {
        showToast(`${selectedContacts.length} contact(s) saved to ${selectedTagIds.length} tag(s)`, 'success');
      } else {
        showToast('Failed to save contacts: ' + (response?.error || 'Unknown error'), 'error');
      }
    });

    $(SELECTORS.CRM_CHECKBOX).prop('checked', false);
    window.selectedUsers.clear();
    updateTagCounter();
    closeTagModal();

  } catch (error) {
    console.error('[CRM] Error saving contacts:', error);
    showToast('Error saving contacts. Please try again.', 'error');
  }
}

/* ===============================
   TOAST NOTIFICATIONS
   Displays temporary slide-in toast messages (success, warning, error)
   at the top-right of the page for user feedback.
   =============================== */

/**
 * Shows toast notifications
 */
function showToast(message, type = 'info') {
    const $toast = $('<div>', {
        css: {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            padding: '12px 16px',
            borderRadius: '8px',
            color: 'white',
            fontSize: '14px',
            fontWeight: '500',
            zIndex: '10001',
            animation: 'toastSlideIn 0.3s ease-out',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        },
        text: message
    });
    
    let backgroundColor;
    switch (type) {
        case 'success':
            backgroundColor = '#10b981';
            break;
        case 'error':
            backgroundColor = '#ef4444';
            break;
        case 'warning':
            backgroundColor = '#f59e0b';
            break;
        default:
            backgroundColor = '#6b7280';
    }
    
    $toast.css('background', backgroundColor);
    
    // Add animation CSS if not exists
    if (!$(SELECTORS.CRM_TOAST_ANIMATIONS).length) {
        $('<style id="crm-toast-animations">').text(`
            @keyframes toastSlideIn {
                from { opacity: 0; transform: translateX(100%); }
                to { opacity: 1; transform: translateX(0); }
            }
        `).appendTo('head');
    }
    
    $('body').append($toast);
    
    setTimeout(() => {
        $toast.css('animation', 'toastSlideOut 0.3s ease-out');
        setTimeout(() => $toast.remove(), 300);
    }, 3000);
}

/* ===============================
   TEMPLATE BUTTON INJECTION
   Injects a "Template" button into the active conversation's message composer area.
   When clicked, opens a modal listing saved message templates; selecting one inserts
   the template text into the composer. Re-checks periodically since Messenger
   replaces the composer DOM when switching conversations.
   =============================== */

/**
 * Injects template button into message composer
 */
function injectTemplateButton() {
    console.log('[CRM] Injecting template button into message composer');

    // Check if button already exists and is in DOM
    if ($templateButton && document.body.contains($templateButton[0])) {
        console.log('[CRM] Template button already exists, skipping injection');
        return;
    }

    // Remove existing button if present but not in DOM
    if ($templateButton) {
        $templateButton.remove();
        $templateButton = null;
    }

    // Find the message composer actions area
    // This is where the emoji button and other actions are located
    const $composerActions = $(SELECTORS.COMPOSER_ACTIONS);

    if (!$composerActions.length) {
        console.log('[CRM] Message composer actions not found, retrying...');
        setTimeout(injectTemplateButton, 1000);
        return;
    }

    // Check if button already exists in the container
    if ($composerActions.find(SELECTORS.CRM_TEMPLATE_BTN_WRAPPER).length > 0) {
        console.log('[CRM] Template button already exists in composer');
        return;
    }

    console.log('[CRM] Found message composer actions:', $composerActions[0]);

    // Create template button (similar style to emoji button)
    $templateButton = $('<span>', {
        class: 'html-span xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x1hl2dhg x16tdsg8 x1vvkbs x4k7w5x x1h91t0o x1h9r5lt x1jfb8zj xv2umb2 x1beo9mf xaigb6o x12ejxvf x3igimt xarpa2k xedcshv x1lytzrv x1t2pt76 x7ja8zs x1qrby5j crm-template-button-wrapper',
        html: `
            <div aria-label="Choose a template" class="x1i10hfl x1qjc9v5 xjbqb8w xjqpnuy xc5r6h4 xqeqjp1 x1phubyo x13fuv20 x18b5jzi x1q0q8m5 x1t7ytsu x972fbf x10w94by x1qhh985 x14e42zd x9f619 x1ypdohk xdl72j9 x2lah0s x3ct3a4 xdj266r x14z9mp xat24cr x1lziwak x2lwn1j xeuugli x1n2onr6 x16tdsg8 x1hl2dhg xggy1nq x1ja2u2z x1t137rt x1fmog5m xu25z0z x140muxe xo1y3bh x3nfvp2 x1q0g3np x87ps6o x1lku1pv x1a2a7pz x1y1aw1k xf159sx xwib8y2 xmzvs34 crm-template-btn" role="button" tabindex="0" style="cursor: pointer;">
                <svg class="x1lliihq x1tzjh5l x1rdy4ex x1lxpwgx x4vbgl9 x165d6jo xsrhx6k" height="28px" viewBox="0 0 36 36" width="28px">
                    <path d="M7 8h22M7 16h22M7 24h22" stroke="var(--chat-composer-button-color)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
                    <circle cx="4" cy="8" r="1.5" fill="var(--chat-composer-button-color)"/>
                    <circle cx="4" cy="16" r="1.5" fill="var(--chat-composer-button-color)"/>
                    <circle cx="4" cy="24" r="1.5" fill="var(--chat-composer-button-color)"/>
                </svg>
                <div class="x1ey2m1c xtijo5x x1o0tod xg01cxk x47corl x10l6tqk x13vifvy x1ebt8du x19991ni x1dhq9h x1iwo8zk x1033uif x179ill4 x1b60jn0" role="none" data-visualcompletion="ignore"></div>
            </div>
        `
    });

    // Add click handler using native addEventListener (more reliable than jQuery .on)
    const btnElement = $templateButton.find('.crm-template-btn')[0];
    if (btnElement) {
        btnElement.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[CRM] Template button clicked (native)');
            openTemplatePickerModal();
        }, true); // Use capture phase
    }

    // Insert button before the emoji button
    $composerActions.prepend($templateButton);

    console.log('[CRM] Template button injected successfully');
}

/**
 * Aggressively monitor for template button and re-inject if needed
 */
function startTemplateButtonMonitoring() {
    console.log('[CRM] Starting aggressive template button monitoring');

    // Check every 2 seconds
    setInterval(() => {
        const $composerActions = $(SELECTORS.COMPOSER_ACTIONS);

        if ($composerActions.length > 0) {
            // Check if our wrapper exists in the current DOM
            const $existingWrapper = $composerActions.find(SELECTORS.CRM_TEMPLATE_BTN_WRAPPER);

            if ($existingWrapper.length === 0) {
                console.log('[CRM] Template button missing, re-injecting...');
                $templateButton = null; // Reset reference so injectTemplateButton creates a fresh one
                injectTemplateButton();
            }
        }
    }, 2000);

    // Also monitor URL changes for chat switches
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            console.log('[CRM] URL changed, re-injecting template button');
            lastUrl = location.href;
            setTimeout(injectTemplateButton, 500);
        }
    }, 500);
}

/**
 * Request templates from background script (same pattern as requestTags)
 * @returns {Promise<Array>} Promise that resolves to array of templates
 */
async function requestTemplates() {
    console.log('[CRM] Requesting templates from local storage...');
    const result = await chrome.storage.local.get(['templates']);
    let templates = result.templates || [];
    // Normalize: storage may be { templates: [...] } or [...] directly
    if (!Array.isArray(templates) && templates.templates) {
        templates = templates.templates;
    }
    console.log('[CRM] Got templates:', templates.length);
    return templates;
}

/**
 * Opens template picker modal
 */
function openTemplatePickerModal() {
    console.log('[CRM] Opening template picker modal');

    // Remove existing modal if it exists
    if ($templateModal) {
        $templateModal.remove();
    }

    // Create modal backdrop
    $templateModal = $('<div>', {
        class: 'crm-template-modal',
        css: {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '10000',
            backdropFilter: 'blur(4px)',
            animation: 'modalFadeIn 0.2s ease-out'
        }
    });

    // Create modal content
    const $modalContent = $('<div>', {
        css: {
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            width: '90%',
            maxWidth: '500px',
            maxHeight: '80vh',
            overflow: 'hidden',
            animation: 'modalSlideIn 0.2s ease-out'
        }
    });

    // Create modal header
    const $modalHeader = $('<div>', {
        css: {
            padding: '24px 24px 16px 24px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
        },
        html: `
            <div>
                <h2 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 4px 0;">
                    Choose a Template
                </h2>
                <p style="font-size: 14px; color: #6b7280; margin: 0 0 8px 0;">
                    Click on a template to insert it
                </p>
                <div style="display: inline-flex; gap: 6px; flex-wrap: wrap; align-items: center;">
                    <span style="font-size: 11px; padding: 2px 6px; background: #eff6ff; color: #1d4ed8; border-radius: 4px; border: 1px solid #bfdbfe;">
                        {name}
                    </span>
                    <span style="font-size: 11px; padding: 2px 6px; background: #eff6ff; color: #1d4ed8; border-radius: 4px; border: 1px solid #bfdbfe;">
                        {last_name}
                    </span>
                    <span style="font-size: 11px; padding: 2px 6px; background: #eff6ff; color: #1d4ed8; border-radius: 4px; border: 1px solid #bfdbfe;">
                        {full_name}
                    </span>
                    <span style="font-size: 11px; color: #9ca3af;">auto-replaced</span>
                </div>
            </div>
            <button class="crm-modal-close" style="
                width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
                background: #f3f4f6; border: none; border-radius: 6px; color: #6b7280;
                cursor: pointer; transition: all 0.15s ease;
            ">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6L18 18"></path>
                </svg>
            </button>
        `
    });

    // Create modal body with loading state
    const $modalBody = $('<div>', {
        css: {
            padding: '16px 24px',
            maxHeight: '400px',
            overflowY: 'auto'
        },
        html: `
            <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; animation: spin 1s linear infinite;">
                    <circle cx="12" cy="12" r="10" opacity="0.25"/>
                    <path d="M12 2a10 10 0 0110 10" opacity="0.75"/>
                </svg>
                <p style="font-size: 14px; margin: 0;">Loading templates...</p>
            </div>
        `
    });

    // Add spinning animation for loader
    if (!$(SELECTORS.CRM_LOADER_ANIMATION).length) {
        $('<style id="crm-loader-animation">').text(`
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `).appendTo('head');
    }

    // Load templates
    console.log('[CRM] Starting template fetch...');
    requestTemplates().then(templates => {
        console.log('[CRM] Templates loaded:', templates?.length || 0, templates);

        if (templates && templates.length > 0) {
            console.log('[CRM] Rendering template list...');
            renderTemplateList($modalBody, templates);
        } else {
            console.log('[CRM] No templates found, showing empty state');
            $modalBody.html(`
                <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 16px;">
                        <path d="M9 12h6M9 16h6M9 8h6M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                    </svg>
                    <p style="font-size: 16px; font-weight: 500; margin: 0 0 8px 0;">No templates available</p>
                    <p style="font-size: 14px; margin: 0;">Create templates in the CRM extension popup first.</p>
                </div>
            `);
        }
    }).catch(error => {
        console.error('[CRM] Error fetching templates:', error);
        $modalBody.html(`
            <div style="text-align: center; padding: 40px 20px; color: #ef4444;">
                <p style="font-size: 16px; font-weight: 500; margin: 0 0 8px 0;">Error loading templates</p>
                <p style="font-size: 14px; margin: 0;">${escapeHtml(error.message || 'Unknown error')}</p>
            </div>
        `);
    });

    // Assemble modal
    $modalContent.append($modalHeader);
    $modalContent.append($modalBody);
    $templateModal.append($modalContent);

    // Add event listeners
    const $closeBtn = $modalHeader.find('.crm-modal-close');
    $closeBtn.on('click', closeTemplateModal);

    // Close modal when clicking backdrop
    $templateModal.on('click', function(e) {
        if (e.target === $templateModal[0]) {
            closeTemplateModal();
        }
    });

    // Append to body
    $('body').append($templateModal);
}

/**
 * Renders the template list in the modal
 */
function renderTemplateList($container, templates) {
    $container.empty();

    if (!templates || templates.length === 0) {
        return;
    }

    const $templateList = $('<div>', {
        css: {
            display: 'grid',
            gap: '8px'
        }
    });

    templates.forEach(template => {
        const $templateItem = $('<div>', {
            class: 'crm-template-item',
            css: {
                padding: '16px',
                background: '#f9fafb',
                border: '2px solid transparent',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
            },
            html: `
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <h3 style="font-size: 15px; font-weight: 600; color: #111827; margin: 0;">
                        ${escapeHtml(template.name)}
                    </h3>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </div>
                <p style="font-size: 14px; color: #6b7280; margin: 0; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                    ${escapeHtml(template.body)}
                </p>
            `
        });

        // Add hover effect
        $templateItem.on('mouseenter', function() {
            $(this).css({
                borderColor: '#1877f2',
                background: '#eff6ff',
                transform: 'translateX(4px)'
            });
        }).on('mouseleave', function() {
            $(this).css({
                borderColor: 'transparent',
                background: '#f9fafb',
                transform: 'translateX(0)'
            });
        });

        // Add click handler to send template
        $templateItem.on('click', function() {
            console.log('[CRM] Template selected:', template.name);
            insertTemplateIntoMessageBox(template.body);
            closeTemplateModal();
        });

        $templateList.append($templateItem);
    });

    $container.append($templateList);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Inserts template text into the message box
 */
function insertTemplateIntoMessageBox(templateBody) {
    console.log('[CRM] Inserting template into message box:', templateBody);

    // Find the message input box
    const messageBox = document.querySelector(SELECTORS.MESSAGE_INPUT) ||
                       document.querySelector(SELECTORS.MESSAGE_INPUT_FALLBACK_1) ||
                       document.querySelector(SELECTORS.MESSAGE_INPUT_FALLBACK_2) ||
                       document.querySelector(SELECTORS.MESSAGE_INPUT_FALLBACK_3);

    if (!messageBox) {
        console.error('[CRM] Message box not found');
        showToast('Could not find message input box', 'error');
        return;
    }

    console.log('[CRM] Found message box:', messageBox);

    try {
        // Get current user name for personalization
        let firstName = 'there';
        let fullName = 'there';
        let lastName = '';

        try {
            // Method 1: Parse document title - MOST RELIABLE
            if (document.title) {
                let titleName = null;

                if (document.title.includes(' | Messenger')) {
                    titleName = document.title.split(' | Messenger')[0].trim();
                } else if (document.title.includes('—')) {
                    titleName = document.title.split('—')[1]?.trim();
                } else if (document.title !== 'Messenger') {
                    titleName = document.title.trim();
                }

                if (titleName && titleName !== 'Messenger' && titleName.length > 0) {
                    fullName = titleName;
                    const nameParts = titleName.split(' ');
                    firstName = nameParts[0] || 'there';
                    lastName = nameParts.slice(1).join(' ');
                    console.log('[CRM] Extracted name from title:', { firstName, lastName, fullName });
                }
            }

            // Method 2: Try h2 header
            if (fullName === 'there') {
                let $h2Headers = $(SELECTORS.CONVERSATION_HEADER_H2);
                if ($h2Headers.length > 0) {
                    for (let i = 0; i < $h2Headers.length; i++) {
                        const headerName = $($h2Headers[i]).text().trim();
                        if (headerName && headerName !== 'Chats' && headerName !== 'Aa' &&
                            !headerName.includes('unread') && !headerName.includes('·') &&
                            headerName.length > 1 && headerName.length < 100) {
                            fullName = headerName;
                            const nameParts = headerName.split(' ');
                            firstName = nameParts[0] || 'there';
                            lastName = nameParts.slice(1).join(' ');
                            console.log('[CRM] Extracted name from h2:', { firstName, lastName, fullName });
                            break;
                        }
                    }
                }
            }

            // Method 3: Try h1 selectors
            if (fullName === 'there') {
                let $conversationHeader = $(SELECTORS.CONVERSATION_HEADER_H1);
                if ($conversationHeader.length) {
                    for (let i = 0; i < $conversationHeader.length; i++) {
                        const headerName = $($conversationHeader[i]).text().trim();
                        if (headerName && headerName !== 'Chats' && headerName.length > 1) {
                            fullName = headerName;
                            const nameParts = headerName.split(' ');
                            firstName = nameParts[0] || 'there';
                            lastName = nameParts.slice(1).join(' ');
                            console.log('[CRM] Extracted name from h1:', { firstName, lastName, fullName });
                            break;
                        }
                    }
                }
            }

            console.log('[CRM] Final names:', { firstName, lastName, fullName });
        } catch (e) {
            console.error('[CRM] Error extracting user name:', e);
        }

        // Personalize template with all placeholders
        let personalizedMessage = templateBody;
        personalizedMessage = personalizedMessage.replace(/{full_name}/gi, fullName);
        personalizedMessage = personalizedMessage.replace(/{fullname}/gi, fullName);
        personalizedMessage = personalizedMessage.replace(/{full name}/gi, fullName);
        personalizedMessage = personalizedMessage.replace(/{first_name}/gi, firstName);
        personalizedMessage = personalizedMessage.replace(/{firstname}/gi, firstName);
        personalizedMessage = personalizedMessage.replace(/{last_name}/gi, lastName);
        personalizedMessage = personalizedMessage.replace(/{lastname}/gi, lastName);
        personalizedMessage = personalizedMessage.replace(/{name}/gi, firstName);

        console.log('[CRM] Personalized message:', personalizedMessage);

        // Focus the message box
        messageBox.focus();

        // Use clipboard-based paste — works reliably with Lexical/React editors
        // because it goes through the browser's native paste handling
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', personalizedMessage);

        // Select all existing content first (to replace it)
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(messageBox);
        selection.removeAllRanges();
        selection.addRange(range);

        const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboardData,
        });

        const pasted = messageBox.dispatchEvent(pasteEvent);
        console.log('[CRM] Paste event dispatched, default prevented:', !pasted);

        if (!pasted) {
            // Lexical handled the paste event — we're done
            console.log('[CRM] Template pasted via ClipboardEvent (Lexical handled it)');
        } else {
            // Paste event was not handled by the editor — fallback to execCommand
            console.log('[CRM] Paste not handled, trying execCommand fallback');
            messageBox.focus();

            // Select all and delete existing content
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);

            // Insert text line by line to preserve newlines
            const lines = personalizedMessage.split('\n');
            lines.forEach((line, index) => {
                if (index > 0) {
                    document.execCommand('insertParagraph', false, null);
                }
                if (line.length > 0) {
                    document.execCommand('insertText', false, line);
                }
            });

            console.log('[CRM] Template inserted via execCommand fallback');
        }

        // Move cursor to end
        setTimeout(() => {
            messageBox.focus();
            const sel = window.getSelection();
            const endRange = document.createRange();
            endRange.selectNodeContents(messageBox);
            endRange.collapse(false);
            sel.removeAllRanges();
            sel.addRange(endRange);
        }, 50);

        console.log('[CRM] Template inserted successfully');
        showToast('Template inserted! Click send to deliver.', 'success');

    } catch (error) {
        console.error('[CRM] Error inserting template:', error);
        showToast('Error inserting template', 'error');
    }
}

/**
 * Closes the template modal
 */
function closeTemplateModal() {
    if ($templateModal) {
        $templateModal.css('animation', 'modalFadeOut 0.2s ease-out');
        setTimeout(() => {
            if ($templateModal) {
                $templateModal.remove();
                $templateModal = null;
            }
        }, 200);
    }
}

/* ===============================
   DOM MONITORING AND PROCESSING
   Uses MutationObserver and periodic polling to detect newly rendered conversation
   tiles, then injects CRM checkboxes and extracts contact data from each tile.
   =============================== */

/**
 * Sets up a MutationObserver to watch for new conversation tiles
 */
// Add this throttle utility at the top of the file
function throttle(func, wait) {
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

// Global observer management
let globalObserver = null;
let observerCallbacks = new Map();

const waitForNodes = (selector, cb) => {
    console.log('[CRM] waiting for nodes matching', selector);
    
    // Clean up existing observer if needed
    if (globalObserver) {
        globalObserver.disconnect();
        globalObserver = null;
    }
    
    // Store callback for this selector
    observerCallbacks.set(selector, cb);
    
    const processNodes = throttle(() => {
        observerCallbacks.forEach((callback, sel) => {
            const nodes = document.querySelectorAll(sel);
            const newNodes = Array.from(nodes).filter(node => !node.hasAttribute('data-crm'));
            
            newNodes.forEach(node => {
                if (sel === USER_SELECTOR && !isValidUserTile(node)) return;
                
                node.setAttribute('data-crm', 'true');
                callback(node);
            });
        });
        
        // Check if action buttons need to be created/recreated
        if (!$actionButtonsContainer || !document.body.contains($actionButtonsContainer[0])) {
            _createActionButtonsRetries = 0; // Reset so it retries finding the header
            createActionButtons();
        }

        // Check if template button needs to be created/recreated
        if (!$templateButton || !document.body.contains($templateButton[0])) {
            injectTemplateButton();
        }
    }, 300);
    
    // Create single observer for all selectors
    globalObserver = new MutationObserver((mutations) => {
        let shouldProcess = false;
        
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if any of our selectors match
                        for (const selector of observerCallbacks.keys()) {
                            if (node.matches?.(selector) || node.querySelector?.(selector)) {
                                shouldProcess = true;
                                break;
                            }
                        }
                        if (shouldProcess) break;
                    }
                }
                if (shouldProcess) break;
            }
        }
        
        if (shouldProcess) {
            processNodes();
        }
    });
    
    // Observe with minimal scope
    const chatContainer = document.querySelector(SELECTORS.CHAT_CONTAINER) || document.body;
    globalObserver.observe(chatContainer, { 
        childList: true, 
        subtree: true,
        attributes: false,
        characterData: false
    });
    
    // Initial run
    processNodes();
};


function cleanup() {
    if (globalObserver) {
        globalObserver.disconnect();
        globalObserver = null;
    }
    $(document).off('click', '.crm-check'); // Remove delegated events
    // Clean up other event listeners
}

window.addEventListener('beforeunload', cleanup);
window.addEventListener('pagehide', cleanup);

/* ===============================
   CHECKBOX INJECTION AND EVENT HANDLING
   Prepends a CRM checkbox to each conversation tile. When toggled, adds/removes
   the contact's data (name, userId, profilePicture) to/from the selectedUsers set.
   Also injects a Notes button into the conversation header of the active chat.
   =============================== */

/**
 * Processes each detected conversation tile by adding a selection checkbox
 */
function initializeCheckboxInjection() {
    waitForNodes(USER_SELECTOR, (tile) => {
        console.log('[CRM] processing tile', tile);
        
        const $tile = $(tile);
        const href = tile.href;
        const userId = href.split('/t/')[1]?.split('/')[0] || 'unknown';
        const $nameEl = $tile.find(SELECTORS.CONVERSATION_NAME).first();
        const nameElFallback = $tile.find(SELECTORS.CONVERSATION_NAME_FALLBACK).first();
        const name = ($nameEl.length ? $nameEl : nameElFallback).text().trim() || 'Unknown';
        
        const profilePicture = extractProfilePicture(tile);
        
        console.log('[CRM] extracted data:', { userId, name, profilePicture });
        
        const $cb = $('<input>', {
            type: 'checkbox',
            class: 'crm-check',
            css: {
                position: 'absolute',
                top: '4px',
                left: '4px',
                zIndex: '999',
                width: '16px',
                height: '16px',
                accentColor: '#1877f2',
                pointerEvents: 'auto',
                cursor: 'pointer'
            }
        });
        
        $cb.data('userId', userId);
        $cb.data('name', name);
        $cb.data('profilePicture', profilePicture || '');
        
        /**
         * Handle checkbox click events for user selection
         */
        $cb.on('click', function(e) {
            e.stopPropagation();
            
            const payload = JSON.stringify({ 
                userId, 
                name,
                profilePicture: profilePicture || null
            });
            
            console.log('[CRM] checkbox clicked, payload:', payload);
            
            if ($(this).is(':checked')) {
                window.selectedUsers.add(payload);
            } else {
                window.selectedUsers.delete(payload);
            }
            
            updateTagCounter();
            console.log('[CRM] selectedUsers', Array.from(window.selectedUsers));
        });
        
        /**
         * Alternative event handler for more reliable state tracking
         */
        $cb.on('change', function(e) {
            e.stopPropagation();
            
            const payload = JSON.stringify({ 
                userId, 
                name,
                profilePicture: profilePicture || null
            });
            
            if ($(this).is(':checked')) {
                window.selectedUsers.add(payload);
            } else {
                window.selectedUsers.delete(payload);
            }
            
            updateTagCounter();
            console.log('[CRM] checkbox changed', { userId, name, profilePicture, checked: $(this).is(':checked') });
        });
        
        // Create Notes button
        const $notesBtn = $('<button>', {
            class: 'crm-notes-btn',
            html: '📝',
            css: {
                position: 'absolute',
                top: '4px',
                right: '4px',
                zIndex: '999',
                width: '18px',
                height: '18px',
                background: 'transparent',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                lineHeight: '18px',
                padding: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: '0.7',
                transition: 'opacity 0.2s ease',
                pointerEvents: 'auto'
            },
            title: `Notes for ${name}`
        });

        // Notes button hover effect
        $notesBtn.on('mouseenter', function() {
            $(this).css({ opacity: '1' });
        });

        $notesBtn.on('mouseleave', function() {
            $(this).css({ opacity: '0.7' });
        });

        // Notes button click handler
        $notesBtn.on('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();

            console.log('[CRM] Notes button clicked for:', name, userId);

            // Function to try opening notes modal
            const tryOpenModal = () => {
                if (typeof window.openNotesModal === 'function') {
                    console.log('[CRM] Opening notes modal directly');
                    window.openNotesModal(userId, name, profilePicture);
                    return true;
                }
                return false;
            };

            // Try to open immediately
            if (tryOpenModal()) {
                return;
            }

            // If not available, wait and retry
            console.log('[CRM] Notes modal function not immediately available, retrying...');
            showToast('Loading notes...', 'info');

            // Retry with exponential backoff
            let retries = 0;
            const maxRetries = 5;
            const retryInterval = setInterval(() => {
                retries++;
                console.log(`[CRM] Retry attempt ${retries}/${maxRetries}`);

                if (tryOpenModal()) {
                    clearInterval(retryInterval);
                    console.log('[CRM] Notes modal opened successfully after retry');
                } else if (retries >= maxRetries) {
                    clearInterval(retryInterval);
                    console.error('[CRM] Notes modal function not available after retries');
                    showToast('Please refresh the page and try again', 'error');
                }
            }, 200);
        });

        // Ensure proper positioning
        $tile.css('position', 'relative');
        $tile.append($cb);
        $tile.append($notesBtn);

        console.log('[CRM] checkbox and notes button attached with profile picture data');
    });
}

/* ===============================
   COMMUNICATION WITH POPUP
   Listens for chrome.runtime.onMessage from the extension popup to handle actions
   like clearing selection, getting selected users, and adding tags to selected contacts.
   =============================== */

/**
 * Handle requests from popup to clear all selections
 */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.action === 'clearSelection') {
        $(SELECTORS.CRM_CHECKBOX).prop('checked', false);
        window.selectedUsers.clear();
        updateTagCounter();
        reply({ status: 'cleared' });
    }
});

/**
 * Handle various requests from the popup interface
 */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    console.log('[CRM] message from popup', msg);
    
    if (msg.action === 'getSelectedUsers') {
        const selectedData = Array.from(window.selectedUsers).map(JSON.parse);
        console.log('[CRM] returning selected users with profile pictures', selectedData);
        reply(selectedData);
    }
    
    if (msg.action === 'addSelectedToTags' && msg.tags.length) {
        const selected = Array.from(window.selectedUsers).map(JSON.parse);
        selected.forEach(u => {
            msg.tags.forEach(tagId => {
                console.log('[CRM] adding', u.name, 'with profile picture to tag', tagId);
            });
        });
        reply({ status: 'ok', added: selected.length });
    }
});

/* ===============================
   INITIALIZATION
   Entry point: validates the Facebook account via FacebookAccountValidator,
   attempts auto-link if needed, then activates the CRM UI injection pipeline.
   =============================== */

/**
 * Validate Facebook account before initializing CRM
 */
async function validateAndInitialize() {
    console.log('[CRM] Checking Facebook account validation...');

    // FIRST: Check if user has JWT token - if not, don't even try to validate
    const storage = await chrome.storage.local.get(['crmFixedJwtToken']);
    if (!storage.crmFixedJwtToken) {
        console.log('[CRM] No JWT token found - skipping validation and initialization');
        console.log('[CRM] User needs to authenticate via popup first');
        return; // Silently exit - don't show errors, don't store anything
    }

    // Validator is now loaded as a content script in manifest.json
    // Check if it's available
    if (typeof FacebookAccountValidator === 'undefined') {
        console.error('═══════════════════════════════════════════');
        console.error('[CRM] ❌❌❌ VALIDATOR FAILED TO LOAD ❌❌❌');
        console.error('[CRM] Extension will NOT initialize');
        console.error('═══════════════════════════════════════════');

        // Store error state for popup to display
        await chrome.storage.local.set({
            validationError: {
                error: 'Extension validation system failed to load. Please reinstall the extension.',
                code: 'VALIDATOR_LOAD_FAILED',
                timestamp: Date.now()
            }
        });

        console.error('[CRM] STOPPING - Extension disabled');
        return; // Don't proceed without validator
    }

    let validation = await FacebookAccountValidator.validateAccount();

    // If account is not linked, try to auto-link it now using the c_user cookie
    if (!validation.valid && validation.code === 'ACCOUNT_NOT_LINKED') {
        console.log('[CRM] Account not linked — attempting auto-link from Messenger page...');
        const facebookUserId = FacebookAccountValidator.getFacebookUserId();

        if (facebookUserId) {
            try {
                const linkResult = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({
                        action: 'autoLinkFacebookAccount',
                        facebookUserId,
                        facebookName: 'Facebook User'
                    }, (response) => {
                        resolve(response || { success: false });
                    });
                });

                if (linkResult.success) {
                    console.log('[CRM] ✅ Auto-link succeeded, re-validating...');
                    validation = await FacebookAccountValidator.validateAccount();
                } else {
                    console.warn('[CRM] Auto-link failed:', linkResult.error);
                }
            } catch (e) {
                console.warn('[CRM] Auto-link error:', e.message);
            }
        }
    }

    if (!validation.valid) {
        console.error('[CRM] Validation failed:', validation.code, validation.error);

        const storage = await chrome.storage.local.get(['crmFixedJwtToken']);
        if (storage.crmFixedJwtToken) {
            await chrome.storage.local.set({
                validationError: {
                    error: validation.error,
                    code: validation.code,
                    timestamp: Date.now()
                }
            });
        }

        console.error('[CRM] STOPPING - Extension disabled');
        return;
    }

    console.log('═══════════════════════════════════════════');
    console.log('[CRM] ✅✅✅ VALIDATION SUCCESS ✅✅✅');
    console.log('[CRM] Account:', validation.accountName);
    console.log('[CRM] Proceeding with initialization...');
    console.log('═══════════════════════════════════════════');

    // Clear any previous validation errors
    await chrome.storage.local.remove(['validationError']);

    // Proceed with initialization ONLY after successful validation
    initializeMessengerCRM();
}

function initializeMessengerCRM() {
    console.log('[CRM] Initializing Messenger CRM with jQuery...');

    // Initialize action buttons when DOM is ready
    createActionButtons();

    // Initialize checkbox injection
    initializeCheckboxInjection();

    // Initialize template button in message composer
    injectTemplateButton();

    // Start aggressive template button monitoring
    startTemplateButtonMonitoring();

    // Document-level delegated click handler for template button
    // This catches clicks even if the button DOM node was replaced by React re-renders
    document.addEventListener('click', function(e) {
        const templateBtn = e.target.closest('.crm-template-btn');
        if (templateBtn) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[CRM] Template button clicked (delegated)');
            openTemplatePickerModal();
        }
    }, true); // Capture phase to fire before Facebook's handlers

    // Also try to create buttons after a delay to handle dynamic loading
    setTimeout(createActionButtons, 2000);
    setTimeout(injectTemplateButton, 2000);

    console.log('[CRM] Messenger CRM initialized successfully');
}