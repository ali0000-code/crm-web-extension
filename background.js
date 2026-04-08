/**
 * MESSENGER CRM EXTENSION - BACKGROUND SERVICE WORKER
 *
 * This is the main background service worker for the Messenger CRM browser extension.
 * It handles communication between the web app, content scripts, and manages bulk messaging operations.
 *
 * KEY RESPONSIBILITIES:
 * 1. Bulk Message Campaign Execution - Orchestrates sending messages to multiple contacts
 * 2. Data Synchronization - Syncs contacts, tags, and templates between web app and extension
 * 3. Message Routing - Routes messages between content scripts, popup, and web app
 * 4. Contact Management - Handles saving and updating contact information
 * 5. Extension Storage - Manages local storage of CRM data
 *
 * ARCHITECTURE OVERVIEW:
 * - Service Worker (this file) - Background processing and message routing
 * - Content Scripts - Inject functionality into Facebook/Messenger pages
 * - Popup - User interface for quick actions
 * - Web App Communication - Bidirectional sync with the main CRM dashboard
 *
 * SECURITY FEATURES:
 * - Origin validation for external messages
 * - Sanctum token authentication (Laravel backend)
 * - Secure data storage in Chrome extension storage
 *
 * @version 3.0.0
 * @author Messenger CRM Team
 */

// No external dependencies needed — Firebase has been fully removed

/* ===============================
   SERVICE WORKER KEEP-ALIVE (MV3)
   ===============================
   
   Chrome Manifest V3 service workers can be terminated after 30 seconds of inactivity.
   This keep-alive mechanism prevents termination during long-running operations
   like bulk messaging campaigns.
*/
let keepAlivePort;

/**
 * Establishes a keep-alive connection to prevent service worker termination
 * This is critical for bulk messaging operations that can take hours to complete
 */
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'keepAlive') {
    keepAlivePort = port;
    console.log('[Background] Keep-alive connection established');
    port.onDisconnect.addListener(() => {
      console.log('[Background] Keep-alive connection lost');
      keepAlivePort = null;
    });
  }
});

/**
 * Maintains service worker activity by creating a port connection
 * Called periodically and during long operations
 */
function stayAlive() {
  if (!keepAlivePort) chrome.runtime.connect({ name: 'keepAlive' });
}

/* ===============================
   DATA MIGRATION AND CLEANUP
   ===============================

   Removes contacts with pending friend request status from storage
   on startup.
*/

/**
 * Clean up contacts that have pending friend request status
 * These should not be in the contacts list - only accepted friends should be contacts
 */
async function cleanupPendingFriendRequestContacts() {
  try {
    const result = await chrome.storage.local.get(['contacts']);
    let contacts = result.contacts || [];
    
    const originalCount = contacts.length;
    
    // Remove contacts that have pending friend request status
    contacts = contacts.filter(contact => {
      if (contact.friendRequestStatus && contact.friendRequestStatus.status === 'pending') {
        console.log('[Background] Removing pending friend request contact:', contact.name);
        return false;
      }
      return true;
    });
    
    const removedCount = originalCount - contacts.length;
    
    if (removedCount > 0) {
      console.log(`[Background] Cleaned up ${removedCount} pending friend request contacts`);
      await chrome.storage.local.set({ contacts });
    } else {
      console.log('[Background] No pending friend request contacts found to clean up');
    }
  } catch (error) {
    console.error('[Background] Error cleaning up pending friend request contacts:', error);
  }
}

// Run cleanup on extension startup
cleanupPendingFriendRequestContacts();

/* ===============================
   BULK SEND PROGRESS STATE
   ===============================

   Tracks active campaign state (progress, counts, timing) and friend
   request refresh state; notifyProgress() broadcasts to popup + webapp.
*/
let bulkSendProgress = {
  isActive: false,
  currentIndex: 0,
  totalCount: 0,
  successCount: 0,
  failureCount: 0,
  startTime: null
};

let friendRequestRefreshState = {
  isActive: false,
  startTime: null,
  status: 'idle', // 'idle', 'checking', 'completed', 'error'
  progress: '',
  results: null,
  error: null
};

function notifyProgress() {
  // Notify popup
  chrome.runtime.sendMessage({
    type: 'BULK_PROGRESS_UPDATE',
    progress: { ...bulkSendProgress }
  }).catch(() => { /* popup closed */ });
  
  // Also sync with webapp
  syncBulkProgressToWebapp();
}

async function syncBulkProgressToWebapp() {
  console.log('[Background] 🚨🚨🚨 WEBAPP SYNC: syncBulkProgressToWebapp called with progress:', bulkSendProgress);
  try {
    // Find webapp tabs
    const tabs = await chrome.tabs.query({ url: CONFIG.WEB_APP_TAB_PATTERNS });
    
    console.log('[Background] 🔍 Tab query results for progress sync:', {
      totalTabs: tabs.length,
      tabUrls: tabs.map(tab => ({ id: tab.id, url: tab.url }))
    });
    
    // Filter to include webapp urls
    const webappTabs = tabs.filter(tab => tab.url && (
      tab.url.includes('localhost') ||
      tab.url.includes('127.0.0.1')
    ));
    
    console.log('[Background] 🎯 Filtered webapp tabs for progress sync:', {
      webappTabsCount: webappTabs.length,
      webappTabs: webappTabs.map(tab => ({ id: tab.id, url: tab.url })),
      progressData: { ...bulkSendProgress }
    });
    
    // Send progress to each webapp tab
    for (const tab of webappTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          source: 'crm-extension',
          type: 'BULK_SEND_PROGRESS_UPDATE',
          payload: { ...bulkSendProgress }
        });
        console.log('[Background] ✅ Successfully sent progress to webapp tab', tab.id);
      } catch (error) {
        // Tab might not have content script loaded yet
        console.log('[Background] ❌ Could not sync progress to webapp tab', tab.id, 'Error:', error.message);
      }
    }
  } catch (error) {
    console.log('[Background] ❌ Error syncing progress to webapp:', error);
  }
}

async function notifyWebappBulkSendStarted(data) {
  console.log('[Background] 🚨🚨🚨 WEBAPP SYNC: notifyWebappBulkSendStarted called with data:', data);
  try {
    const tabs = await chrome.tabs.query({ url: CONFIG.WEB_APP_TAB_PATTERNS });
    
    console.log('[Background] 🔍 Tab query results for bulk send started notification:', {
      totalTabs: tabs.length,
      tabUrls: tabs.map(tab => ({ id: tab.id, url: tab.url }))
    });
    
    const webappTabs = tabs.filter(tab => tab.url && (
      tab.url.includes('localhost') ||
      tab.url.includes('127.0.0.1')
    ));
    
    console.log('[Background] 🎯 Filtered webapp tabs for bulk send started notification:', {
      webappTabsCount: webappTabs.length,
      webappTabs: webappTabs.map(tab => ({ id: tab.id, url: tab.url })),
      notificationData: data
    });
    
    for (const tab of webappTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          source: 'crm-extension',
          type: 'BULK_SEND_STARTED',
          payload: data
        });
        console.log('[Background] ✅ Successfully notified webapp of bulk send start on tab', tab.id);
      } catch (error) {
        console.log('[Background] ❌ Could not notify webapp of bulk send start on tab', tab.id, 'Error:', error.message);
      }
    }
  } catch (error) {
    console.log('[Background] ❌ Error notifying webapp of bulk send start:', error);
  }
}

async function notifyWebappBulkSendComplete(stats) {
  try {
    const tabs = await chrome.tabs.query({ url: CONFIG.WEB_APP_TAB_PATTERNS });
    
    const webappTabs = tabs.filter(tab => tab.url && (
      tab.url.includes('localhost') ||
      tab.url.includes('127.0.0.1')
    ));
    
    for (const tab of webappTabs) {
      chrome.tabs.sendMessage(tab.id, {
        source: 'crm-extension',
        type: 'BULK_SEND_COMPLETE',
        payload: stats
      }).catch(() => {
        console.log('[Background] Could not notify webapp of bulk send complete on tab', tab.id);
      });
    }
  } catch (error) {
    console.log('[Background] Error notifying webapp of bulk send complete:', error);
  }
}

function resetProgress() {
  console.log('[Background] 🔄 Resetting progress from:', bulkSendProgress);
  bulkSendProgress = {
    isActive: false,
    currentIndex: 0,
    totalCount: 0,
    successCount: 0,
    failureCount: 0,
    startTime: null,
    cancelled: false  // Explicitly reset cancelled flag
  };
  console.log('[Background] 🔄 Progress reset to:', bulkSendProgress);
  notifyProgress();
}

function notifyFriendRequestProgress() {
  // Notify popup
  chrome.runtime.sendMessage({
    type: 'FRIEND_REQUEST_REFRESH_UPDATE',
    refreshState: { ...friendRequestRefreshState }
  }).catch(() => { /* popup might be closed */ });
  
  // Also sync with webapp
  syncFriendRequestProgressToWebapp();
}

async function syncFriendRequestProgressToWebapp() {
  try {
    // Find webapp tabs
    const tabs = await chrome.tabs.query({ url: CONFIG.WEB_APP_TAB_PATTERNS });
    
    console.log('[Background] 🔍 Tab query results for friend request progress sync:', {
      totalTabs: tabs.length,
      tabUrls: tabs.map(tab => ({ id: tab.id, url: tab.url }))
    });
    
    // Filter to include webapp urls
    const webappTabs = tabs.filter(tab => tab.url && (
      tab.url.includes('localhost') ||
      tab.url.includes('127.0.0.1')
    ));
    
    console.log('[Background] 🎯 Filtered webapp tabs for friend request progress sync:', {
      webappTabsCount: webappTabs.length,
      webappTabs: webappTabs.map(tab => ({ id: tab.id, url: tab.url })),
      refreshState: { ...friendRequestRefreshState }
    });
    
    // Send progress to each webapp tab
    for (const tab of webappTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          source: 'crm-extension',
          type: 'FRIEND_REQUEST_REFRESH_UPDATE',
          payload: { ...friendRequestRefreshState }
        });
        console.log('[Background] ✅ Successfully sent friend request progress to webapp tab', tab.id);
      } catch (error) {
        console.log('[Background] ❌ Could not sync friend request progress to webapp tab', tab.id, 'Error:', error.message);
      }
    }
  } catch (error) {
    console.log('[Background] ❌ Error syncing friend request progress to webapp:', error);
  }
}

function resetFriendRequestRefreshState() {
  friendRequestRefreshState = {
    isActive: false,
    startTime: null,
    status: 'idle',
    progress: '',
    results: null,
    error: null
  };
  notifyFriendRequestProgress();
}

/* ===============================
   BULK MESSAGING ENGINE
   ===============================

   Core campaign orchestrator — opens Messenger tabs, sends messages
   sequentially with configurable delay, batch size, and batch wait;
   reports progress to backend campaign endpoint; handles cancellation.
*/
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fillTemplate(tpl, { name }) {
  const [first = '', ...rest] = (name || '').trim().split(' ');
  return tpl
    .replace(/\{first_name\}/gi, first)
    .replace(/\{last_name\}/gi, rest.join(' '))
    .replace(/\{full_name\}/gi, name);
}

/* ===============================
   AUTHENTICATED API HELPER
   ===============================

   Wrapper for fetch() that attaches Bearer token from chrome.storage,
   used by all backend API calls from the service worker.
*/

async function getAuthToken() {
  const result = await chrome.storage.local.get(['crmFixedJwtToken']);
  return result.crmFixedJwtToken || null;
}

async function campaignApiCall(method, path, body) {
  const token = await getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[Background] Campaign API call failed:', path, e.message);
    return null;
  }
}

async function createAndStartCampaign(recipients, template, delaySec, selectedTagIds) {
  const name = `Extension Campaign ${new Date().toLocaleString()}`;
  const created = await campaignApiCall('POST', '/campaigns', {
    name,
    message: template,
    delay: delaySec,
    recipientContactIds: recipients.map(r => r.id || r.userId).filter(Boolean),
    selectedTagIds: selectedTagIds || [],
    totalRecipients: recipients.length,
  });
  if (!created?.success) return null;
  const campaignId = created.data?.id;
  if (!campaignId) return null;
  await campaignApiCall('POST', `/campaigns/${campaignId}/start`, null);
  return campaignId;
}

async function reportCampaignProgress(campaignId, currentIndex, successCount, failureCount) {
  if (!campaignId) return;
  await campaignApiCall('PUT', `/campaigns/${campaignId}/progress`, {
    currentIndex,
    successCount,
    failureCount,
  });
}

async function completeCampaign(campaignId, successCount, failureCount, cancelled) {
  if (!campaignId) return;
  await campaignApiCall('POST', `/campaigns/${campaignId}/complete`, {
    status: cancelled ? 'cancelled' : 'completed',
    successCount,
    failureCount,
  });
}

async function sendSequentially(users, template, delaySec, batchSize = 0, batchWaitMinutes = 5, campaignId = null) {
  console.log('[Background] 🚀 sendSequentially called with', users.length, 'users');
  console.log('[Background] Template preview:', template.substring(0, 100) + '...');
  console.log('[Background] Delay between messages:', delaySec, 'seconds');
  console.log('[Background] Batch settings:', { batchSize, batchWaitMinutes });
  console.log('[Background] First user sample:', users[0]);
  stayAlive();

  bulkSendProgress = {
    isActive: true,
    currentIndex: 0,
    totalCount: users.length,
    successCount: 0,
    failureCount: 0,
    startTime: Date.now(),
    cancelled: false,
    campaignId: campaignId || null,
  };
  notifyProgress();

  // Notify webapp that bulk send started
  await notifyWebappBulkSendStarted({
    totalCount: users.length,
    startTime: bulkSendProgress.startTime,
    template: template,
    campaignId: campaignId,
  });

  for (let i = 0; i < users.length; i++) {
    // Check if cancelled before processing each user
    if (bulkSendProgress.cancelled || !bulkSendProgress.isActive) {
      console.log('[Background] 🛑 Bulk send cancelled at index', i, 'cancelled flag:', bulkSendProgress.cancelled, 'isActive:', bulkSendProgress.isActive);
      break;
    }

    const user = users[i];
    bulkSendProgress.currentIndex = i + 1;

    const personalMsg = fillTemplate(template, user);
    try {
      // Pass the entire contact object instead of just userId
      await sendToUser(user, personalMsg);
      bulkSendProgress.successCount++;
      console.log(`[Background] ✅ Sent to ${user.name} (${user.source || 'messenger'})`);
    } catch (error) {
      bulkSendProgress.failureCount++;
      console.error(`[Background] ❌ Failed for ${user.name}`, error);
    }

    notifyProgress();

    // Sync progress to backend every 10 messages (for extension-initiated campaigns)
    if (campaignId && bulkSendProgress.currentIndex % 10 === 0) {
      reportCampaignProgress(
        campaignId,
        bulkSendProgress.currentIndex,
        bulkSendProgress.successCount,
        bulkSendProgress.failureCount
      );
    }

    // Check cancellation again before delay
    if (bulkSendProgress.cancelled || !bulkSendProgress.isActive) {
      console.log('[Background] 🛑 Bulk send cancelled after sending to', user.name, 'cancelled flag:', bulkSendProgress.cancelled, 'isActive:', bulkSendProgress.isActive);
      break;
    }

    // Regular delay between messages
    if (delaySec && i < users.length - 1) {
      const jitter = Math.random() * 1000;
      await sleep(delaySec * 1000 + jitter);
    }

    // Batch waiting: if batch size is set and we've completed a batch, wait
    console.log(`[Background] 🔍 Batch check: batchSize=${batchSize}, i=${i}, (i+1)%batchSize=${(i + 1) % batchSize}`);

    if (batchSize && batchSize > 0 && (i + 1) % batchSize === 0 && i < users.length - 1) {
      const batchNumber = Math.floor((i + 1) / batchSize);
      const waitMinutes = batchWaitMinutes || 5; // Default to 5 minutes if not specified
      console.log(`[Background] 📦 Completed batch ${batchNumber}, waiting ${waitMinutes} minutes...`);
      console.log(`[Background] 📦 Current message: ${i + 1}/${users.length}`);

      // Notify progress with batch wait status
      notifyProgress();

      // Wait for the specified number of minutes
      const waitTimeMs = waitMinutes * 60 * 1000;
      console.log(`[Background] ⏳ Sleeping for ${waitTimeMs}ms (${waitMinutes} minutes)...`);
      await sleep(waitTimeMs);

      console.log(`[Background] ✅ Batch wait complete, resuming sending...`);

      // Check cancellation after batch wait
      if (bulkSendProgress.cancelled || !bulkSendProgress.isActive) {
        console.log('[Background] 🛑 Bulk send cancelled during batch wait');
        break;
      }
    }
  }

  // Update final status
  bulkSendProgress.isActive = false;
  const wasCancelled = bulkSendProgress.cancelled;
  notifyProgress();
  
  const completionStats = {
    total: bulkSendProgress.totalCount,
    success: bulkSendProgress.successCount,
    failed: bulkSendProgress.failureCount,
    duration: Date.now() - bulkSendProgress.startTime,
    cancelled: wasCancelled
  };
  
  // Notify popup
  chrome.runtime.sendMessage({
    type: 'BULK_SEND_COMPLETE',
    stats: completionStats
  }).catch(() => {});

  // Sync final counts to backend (for extension-initiated campaigns)
  if (campaignId) {
    await reportCampaignProgress(
      campaignId,
      bulkSendProgress.totalCount,
      bulkSendProgress.successCount,
      bulkSendProgress.failureCount
    );
    await completeCampaign(
      campaignId,
      bulkSendProgress.successCount,
      bulkSendProgress.failureCount,
      wasCancelled
    );
  }

  // Notify webapp
  await notifyWebappBulkSendComplete({ ...completionStats, campaignId });
}

/* ===============================
   MESSENGER TAB MANAGEMENT
   ===============================

   Opens Messenger conversation tabs and waits for page load before
   injecting messages.
*/
async function sendToUser(contact, text) {
  const messengerUrl = `https://www.facebook.com/messages/t/${contact.userId}`;
  console.log('[Background] Opening chat URL:', messengerUrl);

  const tab = await chrome.tabs.create({
    url: messengerUrl,
    active: true
  });

  await new Promise((res, rej) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      rej(new Error('Page load timeout'));
    }, 30000);
    const onUpdated = (id, info) => {
      if (id === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timeoutId);
        res();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  }).catch(err => {
    console.error(`[Background] ${err.message} for ${messengerUrl}`);
    chrome.tabs.remove(tab.id).catch(() => {});
    throw err;
  });

  // Small extra delay for Lexical editor to fully initialize
  await sleep(2000);

  // Generate unique execution ID
  const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: realSendBackground,
    args: [text, executionId, contact.userId]
  });

  await sleep(20000);
  chrome.tabs.remove(tab.id).catch(() => {});
}

/* ===============================
   FRIEND REQUEST AUTOMATION
   ===============================

   Automates sending friend requests from Facebook group pages —
   clicks Add Friend buttons, handles confirmation dialogs, tracks
   request status.
*/
function realSendBackground(rawText, executionId, userId) {
  console.log(`[CRM Send] Script started for user ${userId}, exec: ${executionId}`, { rawText });

  if (window.crmActiveExecution) {
    console.log(`[CRM Send] Another execution already running, aborting ${executionId}`);
    return;
  }
  window.crmActiveExecution = executionId;

  const TIMEOUT = 20000;
  const start = Date.now();

  const cleanup = (reason) => {
    console.log(`[CRM Send] Done (${reason}) — exec: ${executionId}`);
    if (window.crmActiveExecution === executionId) window.crmActiveExecution = null;
  };

  const simulateRealClick = (element) => {
    const rect = element.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    element.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1 }));
    element.dispatchEvent(new MouseEvent('mousedown', opts));
    element.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1 }));
    element.dispatchEvent(new MouseEvent('mouseup', opts));
    element.dispatchEvent(new MouseEvent('click', opts));
  };

  // ── Step 1: Wait for message input (with Accept/Continue button handling) ──
  const waitForMessageInput = (attempt = 0) => {
    if (window.crmActiveExecution !== executionId) return;
    if (Date.now() - start > TIMEOUT) {
      console.warn(`[CRM Send] Timeout waiting for message input`);
      cleanup('timeout');
      return;
    }

    console.log(`[CRM Send] Looking for message input (attempt ${attempt + 1})...`);

    // Check for Accept button (message request)
    if (attempt <= 2) {
      let acceptBtn = document.querySelector('[aria-label="Accept"][role="button"]');
      if (!acceptBtn) {
        const buttons = document.querySelectorAll('div[role="button"]');
        for (const btn of buttons) {
          if (btn.textContent?.trim() === 'Accept') { acceptBtn = btn; break; }
        }
      }
      if (acceptBtn) {
        console.log(`[CRM Send] Found Accept button, clicking...`);
        simulateRealClick(acceptBtn);
        setTimeout(() => waitForMessageInput(attempt + 1), 3000);
        return;
      }
    }

    // Check for Continue button
    if (attempt <= 2) {
      const allButtons = document.querySelectorAll('div[role="button"], span, button');
      for (const el of allButtons) {
        if (el.textContent?.trim() === 'Continue') {
          console.log(`[CRM Send] Found Continue button, clicking...`);
          simulateRealClick(el);
          setTimeout(() => waitForMessageInput(attempt + 1), 3000);
          return;
        }
      }
    }

    // Look for the message input
    const messageBox = document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                       document.querySelector('div[contenteditable="true"]:not([role="button"])') ||
                       document.querySelector('.notranslate[contenteditable="true"]');

    if (!messageBox) {
      setTimeout(() => waitForMessageInput(attempt + 1), 1000);
      return;
    }

    console.log(`[CRM Send] Found message input:`, messageBox.tagName, messageBox.className.substring(0, 50));
    insertAndSend(messageBox);
  };

  // ── Step 2: Insert text and send ──
  const insertAndSend = (messageBox) => {
    // Personalize the message
    let userName = 'there';
    let fullName = 'there';
    let lastName = '';
    try {
      const title = document.title || '';
      let extracted = null;
      if (title.includes(' | Messenger')) extracted = title.split(' | Messenger')[0].trim();
      else if (title.includes('—')) extracted = title.split('—')[1]?.trim();
      if (extracted && extracted !== 'Messenger' && extracted.length > 0) {
        fullName = extracted;
        const parts = extracted.split(' ');
        userName = parts[0] || 'there';
        lastName = parts.slice(1).join(' ');
      }
    } catch (e) {}

    const message = rawText
      .replace(/\{name\}/gi, userName)
      .replace(/\{first_name\}/gi, userName)
      .replace(/\{firstname\}/gi, userName)
      .replace(/\{last_name\}/gi, lastName)
      .replace(/\{lastname\}/gi, lastName)
      .replace(/\{full_name\}/gi, fullName)
      .replace(/\{fullname\}/gi, fullName);

    console.log(`[CRM Send] Message to insert:`, message);

    // Click the message box to activate Lexical focus
    simulateRealClick(messageBox);
    messageBox.focus();

    // Wait for Lexical to register focus, then insert
    setTimeout(() => {
      messageBox.focus();

      // Try each insertion method and verify after each
      tryInsertMethods(messageBox, message, 0);
    }, 500);
  };

  const insertMethods = [
    // Method 1: execCommand (works best when tab is active and focused)
    (box, msg) => {
      const result = document.execCommand('insertText', false, msg);
      console.log(`[CRM Send] execCommand insertText returned: ${result}, content: "${box.textContent.substring(0, 50)}"`);
      return box.textContent.trim().length > 0;
    },
    // Method 2: Clipboard paste (works with Lexical's paste handler)
    (box, msg) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', msg);
      const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      box.dispatchEvent(evt);
      console.log(`[CRM Send] ClipboardEvent paste dispatched, content: "${box.textContent.substring(0, 50)}"`);
      return false; // Async — check later
    },
    // Method 3: InputEvent beforeinput (Lexical's input handler)
    (box, msg) => {
      box.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: msg
      }));
      box.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertText', data: msg
      }));
      console.log(`[CRM Send] beforeinput dispatched, content: "${box.textContent.substring(0, 50)}"`);
      return box.textContent.trim().length > 0;
    },
    // Method 4: Direct DOM (last resort)
    (box, msg) => {
      box.innerHTML = '';
      msg.split('\n').forEach(line => {
        const p = document.createElement('p');
        p.setAttribute('dir', 'auto');
        p.appendChild(line.length > 0 ? document.createTextNode(line) : document.createElement('br'));
        box.appendChild(p);
      });
      box.dispatchEvent(new Event('input', { bubbles: true }));
      console.log(`[CRM Send] DOM fallback, content: "${box.textContent.substring(0, 50)}"`);
      return box.textContent.trim().length > 0;
    }
  ];

  const tryInsertMethods = (messageBox, message, methodIndex) => {
    if (methodIndex >= insertMethods.length) {
      console.log(`[CRM Send] All insertion methods exhausted. Proceeding to send anyway.`);
      setTimeout(() => trySend(messageBox, 0), 1000);
      return;
    }

    console.log(`[CRM Send] Trying insertion method ${methodIndex + 1}/${insertMethods.length}...`);

    try {
      const immediate = insertMethods[methodIndex](messageBox, message);
      if (immediate) {
        console.log(`[CRM Send] Method ${methodIndex + 1} succeeded immediately!`);
        setTimeout(() => trySend(messageBox, 0), 1000);
        return;
      }
    } catch (e) {
      console.log(`[CRM Send] Method ${methodIndex + 1} threw:`, e.message);
    }

    // Check after a delay (for async methods like paste)
    setTimeout(() => {
      if (messageBox.textContent.trim().length > 0) {
        console.log(`[CRM Send] Method ${methodIndex + 1} succeeded after delay!`);
        setTimeout(() => trySend(messageBox, 0), 1000);
      } else {
        console.log(`[CRM Send] Method ${methodIndex + 1} did not insert text, trying next...`);
        tryInsertMethods(messageBox, message, methodIndex + 1);
      }
    }, 500);
  };

  // ── Step 3: Find and click send button ──
  const trySend = (messageBox, attempt) => {
    if (window.crmActiveExecution !== executionId) return;
    console.log(`[CRM Send] Looking for send button (attempt ${attempt + 1}/5)...`);

    let sendButton = null;

    // Find SVG with "Press enter to send" title
    const svgTitles = document.querySelectorAll('svg title');
    for (const title of svgTitles) {
      if (title.textContent?.trim().toLowerCase().includes('press enter to send')) {
        let parent = title.closest('svg')?.parentElement;
        while (parent && parent !== document.body) {
          if (parent.getAttribute('role') === 'button' || parent.tagName === 'BUTTON') {
            sendButton = parent;
            break;
          }
          parent = parent.parentElement;
        }
        if (!sendButton) sendButton = title.closest('svg')?.parentElement;
        break;
      }
    }

    if (!sendButton) {
      sendButton = document.querySelector('[aria-label*="Press enter to send"]') ||
                   document.querySelector('[aria-label*="Send"]') ||
                   document.querySelector('[data-testid="send-button"]');
    }

    if (sendButton) {
      console.log(`[CRM Send] Found send button, clicking...`);
      simulateRealClick(sendButton);
      cleanup('message sent');
      return;
    }

    if (attempt < 4) {
      setTimeout(() => trySend(messageBox, attempt + 1), 1000);
      return;
    }

    // Final fallback: Enter key
    console.log(`[CRM Send] Send button not found, trying Enter key...`);
    messageBox.focus();
    const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    messageBox.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    messageBox.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    messageBox.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
    cleanup('enter key sent');
  };

  // ── Start ──
  // Small delay for page to settle
  setTimeout(() => waitForMessageInput(0), 1500);
}

/* ===============================
   FRIEND REQUEST TRACKING
   ===============================

   Persists friend request data to chrome.storage and syncs to
   backend; handles status transitions (pending -> accepted/declined);
   updates associated contacts.
*/

/**
 * Track a new friend request
 */
async function handleTrackFriendRequest(requestData, sendResponse) {
  try {
    console.log('[Background] 🤝 Tracking friend request:', requestData);
    
    // Load existing friend requests and contacts
    const result = await chrome.storage.local.get(['friendRequests', 'contacts', 'friendRequestStats']);
    let friendRequests = result.friendRequests || [];
    let contacts = result.contacts || [];
    let stats = result.friendRequestStats || {
      total: 0,
      pending: 0,
      accepted: 0
    };
    
    // Check if this friend request is already tracked
    const existingRequest = friendRequests.find(req => req.userId === requestData.userId);
    if (existingRequest) {
      console.log('[Background] ⚠️ Friend request already tracked for user:', requestData.userId);
      sendResponse({ success: false, error: 'Friend request already tracked' });
      return;
    }
    
    // Create friend request record
    const friendRequest = {
      id: 'fr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      userId: requestData.userId,
      name: requestData.name,
      profilePicture: requestData.profilePicture,
      groupId: requestData.groupId,
      status: requestData.status,
      sentAt: requestData.sentAt,
      respondedAt: requestData.respondedAt || null,
      lastChecked: new Date().toISOString()
    };
    
    // Add to friend requests
    friendRequests.push(friendRequest);
    
    // Update stats
    stats.total++;
    if (requestData.status === 'pending') {
      stats.pending++;
    }
    
    // Update or create contact with friend request status
    let contact = contacts.find(c => c.userId === requestData.userId);
    if (contact) {
      // Update existing contact
      contact.friendRequestStatus = {
        status: requestData.status,
        sentAt: requestData.sentAt,
        respondedAt: requestData.respondedAt
      };
      if (requestData.profilePicture) {
        contact.profilePicture = requestData.profilePicture;
      }
    } else if (requestData.status === 'accepted') {
      // Only create new contact if friend request is accepted
      contact = {
        id: generateId(),
        name: requestData.name,
        userId: requestData.userId,
        profilePicture: requestData.profilePicture,
        source: 'facebook_group',
        groupId: requestData.groupId,
        tags: [],
        friendRequestStatus: {
          status: requestData.status,
          sentAt: requestData.sentAt,
          respondedAt: requestData.respondedAt
        }
      };
      contacts.push(contact);
    }
    // For pending requests, we only track in friendRequests, not in contacts
    
    // Save to storage
    await chrome.storage.local.set({
      friendRequests,
      contacts,
      friendRequestStats: stats,
      lastLocalUpdate: Date.now()
    });

    console.log('[Background] ✅ Friend request tracked successfully:', friendRequest.id);

    sendResponse({
      success: true,
      friendRequestId: friendRequest.id,
      message: 'Friend request tracked successfully'
    });
    
    // Notify popup if open
    chrome.runtime.sendMessage({
      type: 'FRIEND_REQUEST_TRACKED',
      friendRequest: friendRequest,
      stats: stats
    }).catch(() => {
      // Popup might not be open
    });
    
    // Sync friend request to backend API
    try {
      const tokenResult = await chrome.storage.local.get(['crmFixedJwtToken']);
      const token = tokenResult.crmFixedJwtToken;
      if (token) {
        await fetch(`${CONFIG.API_BASE_URL}/friend-requests/sync`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ friendRequests: [friendRequest] }),
        });
        console.log('[Background] Friend request synced to backend');
      }
    } catch (error) {
      console.warn('[Background] Failed to sync friend request to backend:', error.message);
    }

    // Notify webapp tabs about new friend request
    try {
      const tabs = await chrome.tabs.query({ url: ['*://localhost/*'] });
      const webappTabs = tabs.filter(tab => tab.url && (
        tab.url.includes('localhost') ||
        tab.url.includes('127.0.0.1')
      ));

      if (webappTabs.length > 0) {
        console.log('[Background] Sending FRIEND_REQUEST_TRACKED to', webappTabs.length, 'webapp tabs');
        const syncPromises = webappTabs.map(tab =>
          chrome.tabs.sendMessage(tab.id, {
            type: 'FRIEND_REQUEST_TRACKED',
            payload: friendRequest,
            source: 'crm-extension'
          }).catch(error => {
            console.log('[Background] Could not send FRIEND_REQUEST_TRACKED to tab', tab.id, ':', error.message);
          })
        );
        await Promise.all(syncPromises);
      }
    } catch (error) {
      console.error('[Background] Error notifying webapp about friend request:', error);
    }
    
  } catch (error) {
    console.error('[Background] ❌ Error tracking friend request:', error);
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

/**
 * Update friend request status
 */
async function handleUpdateFriendRequestStatus(userId, status, timestamp, sendResponse) {
  try {
    console.log('[Background] 📱 Updating friend request status:', { userId, status, timestamp });
    
    // Load existing data
    const result = await chrome.storage.local.get(['friendRequests', 'contacts', 'friendRequestStats']);
    let friendRequests = result.friendRequests || [];
    let contacts = result.contacts || [];
    let stats = result.friendRequestStats || {
      total: 0,
      pending: 0,
      accepted: 0
    };
    
    // Find friend request
    const requestIndex = friendRequests.findIndex(req => req.userId === userId);
    if (requestIndex === -1) {
      console.log('[Background] ⚠️ Friend request not found for user:', userId);
      sendResponse({ success: false, error: 'Friend request not found' });
      return;
    }
    
    const oldStatus = friendRequests[requestIndex].status;
    
    // Update friend request
    friendRequests[requestIndex].status = status;
    friendRequests[requestIndex].lastChecked = timestamp;
    if (status === 'accepted') {
      friendRequests[requestIndex].respondedAt = timestamp;
    }
    
    // Update or create contact based on status
    let contact = contacts.find(c => c.userId === userId);
    
    if (status === 'accepted') {
      if (contact) {
        // Update existing contact
        if (contact.friendRequestStatus) {
          contact.friendRequestStatus.status = status;
          contact.friendRequestStatus.respondedAt = timestamp;
        }
      } else {
        // Create new contact when friend request is accepted
        const friendRequest = friendRequests.find(fr => fr.userId === userId);
        if (friendRequest) {
          contact = {
            id: generateId(),
            name: friendRequest.name,
            userId: friendRequest.userId,
            profilePicture: friendRequest.profilePicture,
            source: 'facebook_group',
            groupId: friendRequest.groupId,
            tags: [],
            friendRequestStatus: {
              status: status,
              sentAt: friendRequest.sentAt,
              respondedAt: timestamp
            }
          };
          contacts.push(contact);
        }
      }
    } else if (contact && contact.friendRequestStatus) {
      // Update existing contact for non-accepted statuses
      contact.friendRequestStatus.status = status;
    }
    
    // Update stats
    if (oldStatus !== status) {
      // Decrement old status count
      if (oldStatus === 'pending') stats.pending--;
      else if (oldStatus === 'accepted') stats.accepted--;
      
      // Increment new status count
      if (status === 'pending') stats.pending++;
      else if (status === 'accepted') stats.accepted++;
    }
    
    // Save to storage
    await chrome.storage.local.set({
      friendRequests,
      contacts,
      friendRequestStats: stats,
      lastLocalUpdate: Date.now()
    });
    
    console.log('[Background] ✅ Friend request status updated successfully');
    sendResponse({
      success: true,
      message: 'Friend request status updated'
    });

    // Notify popup if open
    chrome.runtime.sendMessage({
      type: 'FRIEND_REQUEST_STATUS_UPDATED',
      userId: userId,
      status: status,
      stats: stats
    }).catch(() => {
      // Popup might not be open
    });

    // Sync status update to backend API
    try {
      const tokenResult = await chrome.storage.local.get(['crmFixedJwtToken']);
      const token = tokenResult.crmFixedJwtToken;
      if (token) {
        await fetch(`${CONFIG.API_BASE_URL}/friend-requests/bulk-update-status`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ updates: [{ userId, status }] }),
        });
        console.log('[Background] Friend request status synced to backend');
      }
    } catch (error) {
      console.warn('[Background] Failed to sync friend request status to backend:', error.message);
    }

    // Notify webapp tabs about status update
    try {
      const tabs = await chrome.tabs.query({ url: ['*://localhost/*'] });
      const webappTabs = tabs.filter(tab => tab.url && (
        tab.url.includes('localhost') ||
        tab.url.includes('127.0.0.1')
      ));

      if (webappTabs.length > 0) {
        console.log('[Background] 📤 Sending FRIEND_REQUEST_STATUS_UPDATED to', webappTabs.length, 'webapp tabs');
        const syncPromises = webappTabs.map(tab =>
          chrome.tabs.sendMessage(tab.id, {
            type: 'FRIEND_REQUEST_STATUS_UPDATED',
            payload: { userId, status, timestamp },
            source: 'crm-extension'
          }).catch(error => {
            console.log('[Background] Could not send FRIEND_REQUEST_STATUS_UPDATED to tab', tab.id, ':', error.message);
          })
        );
        await Promise.all(syncPromises);
      }
    } catch (error) {
      console.error('[Background] Error notifying webapp about status update:', error);
    }
    
  } catch (error) {
    console.error('[Background] ❌ Error updating friend request status:', error);
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

/**
 * Remove friend request (cancellation)
 */
async function handleRemoveFriendRequest(userId, sendResponse) {
  try {
    console.log('[Background] 🗑️ Removing friend request:', userId);
    
    // Load existing data
    const result = await chrome.storage.local.get(['friendRequests', 'contacts', 'friendRequestStats']);
    let friendRequests = result.friendRequests || [];
    let contacts = result.contacts || [];
    let stats = result.friendRequestStats || {
      total: 0,
      pending: 0,
      accepted: 0
    };
    
    // Find and remove friend request
    const requestIndex = friendRequests.findIndex(req => req.userId === userId);
    if (requestIndex === -1) {
      console.log('[Background] ⚠️ Friend request not found for removal:', userId);
      sendResponse({ success: false, error: 'Friend request not found' });
      return;
    }
    
    const removedRequest = friendRequests[requestIndex];
    friendRequests.splice(requestIndex, 1);
    
    // Update stats - remove from pending count and total
    if (removedRequest.status === 'pending') {
      stats.pending = Math.max(0, stats.pending - 1);
    }
    stats.total = Math.max(0, stats.total - 1);
    
    // Remove contact completely when friend request is cancelled
    console.log('[Background] 🔍 Looking for contact to remove with userId:', userId);
    
    const contactIndex = contacts.findIndex(c => c.userId === userId);
    if (contactIndex !== -1) {
      const removedContact = contacts[contactIndex];
      contacts.splice(contactIndex, 1);
      console.log('[Background] 🗑️ Removed contact completely:', removedContact.name);
    } else {
      // Try string comparison in case of type mismatch
      const contactWithStringIndex = contacts.findIndex(c => String(c.userId) === String(userId));
      if (contactWithStringIndex !== -1) {
        const removedContact = contacts[contactWithStringIndex];
        contacts.splice(contactWithStringIndex, 1);
        console.log('[Background] 🗑️ Removed contact with string match:', removedContact.name);
      } else {
        console.log('[Background] ⚠️ Contact not found for removal:', userId);
      }
    }
    
    // Save updated data
    await chrome.storage.local.set({
      friendRequests: friendRequests,
      contacts: contacts,
      friendRequestStats: stats
    });
    
    console.log('[Background] ✅ Friend request removed successfully');

    // Sync cancellation to backend API
    try {
      const tokenResult = await chrome.storage.local.get(['crmFixedJwtToken']);
      const token = tokenResult.crmFixedJwtToken;
      if (token) {
        await fetch(`${CONFIG.API_BASE_URL}/friend-requests/bulk-update-status`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ updates: [{ userId, status: 'cancelled' }] }),
        });
        console.log('[Background] Friend request cancellation synced to backend');
      }
    } catch (error) {
      console.warn('[Background] Failed to sync friend request cancellation to backend:', error.message);
    }

    // Notify popup if open
    chrome.runtime.sendMessage({
      type: 'FRIEND_REQUEST_REMOVED',
      removedRequest: removedRequest,
      stats: stats
    }).catch(() => {
      // Popup might not be open
    });

    sendResponse({
      success: true,
      removedRequest: removedRequest
    });
    
  } catch (error) {
    console.error('[Background] ❌ Error removing friend request:', error);
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

/* ===============================
   FRIEND REQUEST STATUS CHECKING
   ===============================

   Bulk-checks pending friend requests by navigating to Facebook
   profiles and detecting friendship status changes.
*/

/**
 * Check friend request statuses via friends list
 */
/**
 * Check friend request statuses via friends list
 */
async function handleCheckFriendRequestStatuses(sendResponse) {
  // Check if refresh is already running
  if (friendRequestRefreshState.isActive) {
    console.log('[Background] Friend request refresh already in progress');
    sendResponse({ 
      success: false, 
      error: 'Friend request refresh already in progress',
      isActive: true,
      refreshState: friendRequestRefreshState
    });
    return;
  }

  // Send immediate response to popup that refresh has started
  sendResponse({ 
    success: true, 
    message: 'Friend request refresh started',
    started: true,
    refreshState: friendRequestRefreshState
  });

  // Start the async refresh process
  startFriendRequestRefresh();
}

/**
 * Start the friend request refresh process asynchronously
 */
async function startFriendRequestRefresh() {
  try {
    console.log('[Background] 🔍 Starting friend request status check...');
    
    // Update state
    friendRequestRefreshState = {
      isActive: true,
      startTime: Date.now(),
      status: 'checking',
      progress: 'Loading pending friend requests...',
      results: null,
      error: null
    };
    notifyFriendRequestProgress();
    
    // Load pending friend requests
    const result = await chrome.storage.local.get(['friendRequests']);
    const friendRequests = result.friendRequests || [];
    
    const pendingRequests = friendRequests.filter(req => req.status === 'pending');
    
    if (pendingRequests.length === 0) {
      console.log('[Background] No pending friend requests to check');
      
      friendRequestRefreshState = {
        isActive: false,
        startTime: friendRequestRefreshState.startTime,
        status: 'completed',
        progress: 'Complete',
        results: {
          success: true,
          message: 'No pending friend requests to check',
          updatedCount: 0
        },
        error: null
      };
      
      // Save timestamp for last status check
      chrome.storage.local.set({ 
        lastStatusCheck: new Date().toISOString() 
      });
      
      notifyFriendRequestProgress();
      return;
    }
    
    console.log('[Background] Found', pendingRequests.length, 'pending requests to check');
    console.log('[Background] 🎯 Target names:', pendingRequests.map(req => req.name));
    
    // Update progress
    friendRequestRefreshState.progress = 'Opening Facebook friends list...';
    notifyFriendRequestProgress();
    
    // Open friends list and extract friend data
    const friendsListTab = await openFriendsListTab();
    
    if (!friendsListTab) {
      throw new Error('Failed to open friends list page');
    }
    
    console.log('[Background] ✅ Friends list tab opened:', friendsListTab.id);
    
    // Update progress
    friendRequestRefreshState.progress = 'Loading friends list data...';
    notifyFriendRequestProgress();
    
    // ADD DELAY to ensure page is fully loaded
    console.log('[Background] ⏳ Waiting additional 5 seconds for page to fully load...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Update progress
    friendRequestRefreshState.progress = 'Scanning for accepted friends...';
    notifyFriendRequestProgress();

    // Extract friends and keep tab open longer for debugging - PASS FULL REQUESTS
    const foundFriends = await extractFriendsFromList(friendsListTab.id, pendingRequests);

    console.log('[Background] 📊 Extraction results:', {
      foundFriends: foundFriends?.length || 0,
      friendsData: foundFriends
    });

    // Keep tab open for 10 seconds to inspect
    console.log('[Background] 🔍 Keeping tab open for 10 seconds for inspection...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Close the tab
    await chrome.tabs.remove(friendsListTab.id);
    console.log('[Background] 🗑️ Tab closed');

    // Update progress - check for cancelled requests
    friendRequestRefreshState.progress = 'Checking for cancelled requests...';
    notifyFriendRequestProgress();

    // Check sent requests page to see which are still pending
    const sentRequestsTab = await openSentRequestsTab();

    if (sentRequestsTab) {
      console.log('[Background] ✅ Sent requests tab opened:', sentRequestsTab.id);

      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Extract currently pending requests from the page
      const stillPendingUserIds = await extractSentRequestUserIds(sentRequestsTab.id);
      console.log('[Background] 📊 Still pending user IDs:', stillPendingUserIds);

      // Close the tab
      await chrome.tabs.remove(sentRequestsTab.id);

      // Only process cancellations if we successfully extracted data
      // If extraction failed or returned empty, DON'T mark anything as cancelled
      if (stillPendingUserIds.length === 0 && pendingRequests.length > 0) {
        console.log('[Background] ⚠️ Extracted 0 pending requests but we have', pendingRequests.length, 'in storage');
        console.log('[Background] ⚠️ This likely means extraction failed - NOT marking anything as cancelled');
      } else {
        // Find cancelled requests (pending in our data but not in sent requests page)
        const cancelledRequests = pendingRequests.filter(req =>
          !stillPendingUserIds.includes(req.userId)
        );

        console.log('[Background] 🗑️ Cancelled requests found:', cancelledRequests.length);

        // Remove cancelled requests
        if (cancelledRequests.length > 0) {
        for (const req of cancelledRequests) {
          console.log('[Background] 🗑️ Removing cancelled request:', req.name, req.userId);
          await handleRemoveFriendRequest(req.userId, () => {});
        }

        // Notify webapp about removals
        const webappTabs = await chrome.tabs.query({ url: ['*://localhost/*'] });
        if (webappTabs.length > 0) {
          for (const req of cancelledRequests) {
            const syncPromises = webappTabs.map(tab =>
              chrome.tabs.sendMessage(tab.id, {
                type: 'FRIEND_REQUEST_REMOVED',
                payload: { userId: req.userId },
                source: 'crm-extension'
              }).catch(error => {
                console.log('[Background] ❌ Could not send removal to webapp tab', tab.id);
              })
            );
            await Promise.all(syncPromises);
          }
          console.log('[Background] ✅ Notified webapp of', cancelledRequests.length, 'cancelled requests');
        }
        }
      }
    } else {
      console.log('[Background] ⚠️ Could not open sent requests tab, skipping cancellation check');
    }

    if (!foundFriends || foundFriends.length === 0) {
      console.log('[Background] ❌ No accepted friends found - they may still be pending');

      friendRequestRefreshState = {
        isActive: false,
        startTime: friendRequestRefreshState.startTime,
        status: 'completed',
        progress: 'Complete',
        results: {
          success: true,
          message: 'No new acceptances found - requests may still be pending',
          updatedCount: 0
        },
        error: null
      };

      // Save timestamp for last status check
      chrome.storage.local.set({
        lastStatusCheck: new Date().toISOString()
      });

      notifyFriendRequestProgress();
      return;
    }

    // Update progress
    friendRequestRefreshState.progress = 'Processing accepted friends...';
    notifyFriendRequestProgress();

    // Process the results and update statuses
    const updateResults = await processFriendStatusResults(foundFriends, pendingRequests);
    
    console.log('[Background] ✅ Status check complete:', updateResults);
    
    // Update final state
    friendRequestRefreshState = {
      isActive: false,
      startTime: friendRequestRefreshState.startTime,
      status: 'completed',
      progress: 'Complete',
      results: {
        success: true,
        message: `${updateResults.updatedCount} friend request(s) accepted!`,
        updatedCount: updateResults.updatedCount,
        acceptedFriends: updateResults.acceptedFriends,
        showTagAssignmentModal: updateResults.updatedCount > 0
      },
      error: null
    };
    
    // Save timestamp for last status check
    chrome.storage.local.set({ 
      lastStatusCheck: new Date().toISOString()
    });
    
    notifyFriendRequestProgress();
    
  } catch (error) {
    console.error('[Background] ❌ Friend request status check failed:', error);
    
    friendRequestRefreshState = {
      isActive: false,
      startTime: friendRequestRefreshState.startTime,
      status: 'error',
      progress: 'Failed',
      results: null,
      error: error.message
    };
    
    // Save timestamp for last status check (even if failed)
    chrome.storage.local.set({ 
      lastStatusCheck: new Date().toISOString() 
    });
    
    notifyFriendRequestProgress();
  }
}

/**
 * Opens Facebook friends list in background tab
 */
async function openSentRequestsTab() {
  try {
    console.log('[Background] Opening sent requests tab...');

    const tab = await chrome.tabs.create({
      url: 'https://www.facebook.com/friends/requests/sent',
      active: false
    });

    // Wait for page to load
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Page load timeout'));
      }, 15000); // 15 second timeout

      const onUpdated = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          clearTimeout(timeoutId);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
    });

    console.log('[Background] Sent requests page loaded');
    return tab;

  } catch (error) {
    console.error('[Background] Failed to open sent requests tab:', error);
    return null;
  }
}

async function extractSentRequestUserIds(tabId) {
  try {
    console.log('[Background] Extracting sent request user IDs from tab:', tabId);

    // Inject and execute extraction script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // Find all profile links in sent requests
        const userIds = new Set();

        // Look for profile links in the sent requests section
        const profileLinks = document.querySelectorAll('a[href*="/user/"], a[href*="facebook.com/profile.php?id="]');

        profileLinks.forEach(link => {
          const href = link.getAttribute('href');
          if (!href) return;

          // Extract user ID from profile.php?id= format
          const profileIdMatch = href.match(/profile\.php\?id=(\d+)/);
          if (profileIdMatch) {
            userIds.add(profileIdMatch[1]);
            return;
          }

          // Extract user ID from /user/ format
          const userMatch = href.match(/\/user\/(\d+)/);
          if (userMatch) {
            userIds.add(userMatch[1]);
          }
        });

        console.log('[Content Script] Found user IDs:', Array.from(userIds));
        return Array.from(userIds);
      }
    });

    if (results && results[0] && results[0].result) {
      console.log('[Background] ✅ Extracted user IDs:', results[0].result);
      return results[0].result;
    }

    return [];

  } catch (error) {
    console.error('[Background] Failed to extract sent request user IDs:', error);
    return [];
  }
}

async function openFriendsListTab() {
  try {
    console.log('[Background] Opening friends list tab...');

    const tab = await chrome.tabs.create({
      url: 'https://www.facebook.com/friends/list',
      active: false
    });

    // Wait for page to load
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Page load timeout'));
      }, 15000); // 15 second timeout

      const onUpdated = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          clearTimeout(timeoutId);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
    });

    console.log('[Background] Friends list page loaded');
    return tab;

  } catch (error) {
    console.error('[Background] Failed to open friends list tab:', error);
    throw error;
  }
}

/**
 * Extracts friends data from the friends list page
 */
async function extractFriendsFromList(tabId, pendingRequests) {
  try {
    console.log('[Background] 🔄 Extracting friends from list...');
    console.log('[Background] 🎯 Looking for friend requests:', pendingRequests.map(req => req.name));
    
    // First, check if the page loaded correctly
    const pageCheck = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const allLinks = document.querySelectorAll('a[href*="facebook.com"], a[href^="/"]');
        const friendLinks = Array.from(allLinks).filter(link => {
          const href = link.getAttribute('href');
          return href && (
            href.includes('profile.php?id=') || 
            (href.includes('facebook.com/') && !href.includes('/groups/'))
          );
        });
        
        return {
          url: window.location.href,
          title: document.title,
          totalLinks: allLinks.length,
          friendLinks: friendLinks.length,
          hasLoginForm: !!document.querySelector('input[type="password"]'),
          sampleLinks: Array.from(allLinks).slice(0, 5).map(a => a.getAttribute('href'))
        };
      }
    });
    
    console.log('[Background] 📋 Page check results:', pageCheck[0]?.result);
    
    // If login form detected, abort
    if (pageCheck[0]?.result?.hasLoginForm) {
      throw new Error('Facebook login required - not logged in');
    }
    
    // Inject and execute the extraction script with longer timeout
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: extractFriendsData,
      args: [pendingRequests] // Pass full request objects with names
    });
    
    if (!results || !results[0]) {
      throw new Error('Failed to execute extraction script');
    }
    
    // Wait for the promise to resolve
    const foundFriends = await results[0].result;
    
    console.log('[Background] 📊 Extraction complete:', {
      found: foundFriends?.length || 0,
      friends: foundFriends
    });
    
    return foundFriends || [];
    
  } catch (error) {
    console.error('[Background] ❌ Failed to extract friends data:', error);
    throw error;
  }
}

/**
 * Processes friend status results and updates storage
 */
/**
 * Processes friend status results and updates storage
 */
async function processFriendStatusResults(foundFriends, pendingRequests) {
  try {
    console.log('[Background] Processing friend status results...');
    
    const updatedRequests = [];
    const acceptedFriends = [];
    
    // Match found friends against pending requests BY NAME
    for (const friend of foundFriends) {
      // Find the original request by userId (stored in foundFriend)
      const pendingRequest = pendingRequests.find(req => req.userId === friend.userId);
      
      if (pendingRequest) {
        // Update the request status
        const updatedRequest = {
          ...pendingRequest,
          status: 'accepted',
          respondedAt: new Date().toISOString(),
          lastStatusCheck: new Date().toISOString(),
          verificationMethod: 'friends_list_name_match',
          friendsListName: friend.name // Store the name found in friends list
        };
        
        updatedRequests.push(updatedRequest);
        acceptedFriends.push({
          name: pendingRequest.name,
          userId: pendingRequest.userId,
          friendsListName: friend.name,
          profilePicture: pendingRequest.profilePicture || ''
        });
        
        console.log('[Background] 🖼️ Profile picture debug for accepted friend:', {
          name: pendingRequest.name,
          userId: pendingRequest.userId,
          originalProfilePicture: pendingRequest.profilePicture,
          finalProfilePicture: pendingRequest.profilePicture || ''
        });
        
        console.log('[Background] ✅ Friend request accepted:', {
          originalName: pendingRequest.name,
          friendsListName: friend.name,
          userId: pendingRequest.userId
        });
      }
    }
    
    // Always get current data - even if no updates
    const result = await chrome.storage.local.get(['friendRequests', 'friendRequestStats']);
    let allRequests = result.friendRequests || [];
    let stats = result.friendRequestStats || {
      total: 0,
      pending: 0,
      accepted: 0
    };

    // If no friends were accepted, still update lastStatusCheck but DON'T change stats
    if (updatedRequests.length === 0) {
      // Just update the timestamp, preserve all stats
      await chrome.storage.local.set({
        lastStatusCheck: new Date().toISOString()
      });

      console.log('[Background] No acceptances found, stats preserved:', stats);
      return { updatedCount: 0, acceptedFriends: [] };
    }
    
    // Update the requests array
    updatedRequests.forEach(updatedReq => {
      const index = allRequests.findIndex(req => req.userId === updatedReq.userId);
      if (index !== -1) {
        allRequests[index] = updatedReq;
      }
    });
    
    // Recalculate statistics
    stats.pending = allRequests.filter(req => req.status === 'pending').length;
    stats.accepted = allRequests.filter(req => req.status === 'accepted').length;
    stats.total = allRequests.length;
    
    // Save updated data
    await chrome.storage.local.set({
      friendRequests: allRequests,
      friendRequestStats: stats,
      lastStatusCheck: new Date().toISOString()
    });
    
    // Create contacts for newly accepted friend requests and sync to webapp
    if (acceptedFriends.length > 0) {
      try {
        // Get existing contacts to avoid duplicates
        const contactResult = await chrome.storage.local.get(['contacts']);
        let contacts = contactResult.contacts || [];
        
        // Create contacts for newly accepted friends (avoid duplicates)
        for (const friend of acceptedFriends) {
          const existingContact = contacts.find(c => c.userId === friend.userId);
          if (!existingContact) {
            const newContact = {
              id: `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              userId: friend.userId,
              name: friend.name,
              profilePicture: friend.profilePicture || '',
              tags: [], // No tags initially - user can assign them via tag assignment modal
              createdAt: new Date().toISOString(),
              source: 'friend_request_accepted'
            };
            contacts.push(newContact);
            console.log('[Background] ✅ Created contact for accepted friend:', {
              name: friend.name,
              userId: friend.userId,
              profilePictureFromFriend: friend.profilePicture,
              finalProfilePicture: newContact.profilePicture,
              contactId: newContact.id
            });
          }
        }
        
        // Save updated contacts
        await chrome.storage.local.set({ contacts });
        
        // Sync everything to webapp
        const webappTabs = await chrome.tabs.query({ url: ['*://localhost/*'] });
        if (webappTabs.length > 0) {
          console.log('[Background] 📤 Syncing updated data to', webappTabs.length, 'webapp tabs');
          
          // Sync updated friend requests and contacts
          await Promise.all([
            syncDataToWebAppTabs('SYNC_FRIEND_REQUESTS_FROM_EXTENSION', allRequests, webappTabs),
            syncDataToWebAppTabs('SYNC_CONTACTS_FROM_EXTENSION', contacts, webappTabs)
          ]);
          
          // Also send specific status update messages
          const syncPromises = webappTabs.map(tab => 
            chrome.tabs.sendMessage(tab.id, {
              type: 'FRIEND_REQUEST_STATUSES_UPDATED',
              payload: { acceptedFriends, updatedCount: updatedRequests.length },
              source: 'crm-extension'
            }).catch(error => {
              console.log('[Background] ❌ Could not send status update to webapp tab', tab.id, 'Error:', error.message);
            })
          );
          await Promise.all(syncPromises);
          console.log('[Background] ✅ Successfully synced friend request and contact updates to webapp');
        }
      } catch (error) {
        console.log('[Background] ❌ Error creating contacts and syncing to webapp:', error);
      }
    } else {
      // No accepted friends, just sync friend requests
      try {
        const webappTabs = await chrome.tabs.query({ url: ['*://localhost/*'] });
        if (webappTabs.length > 0) {
          console.log('[Background] 📤 Syncing updated friend requests to', webappTabs.length, 'webapp tabs');
          await syncDataToWebAppTabs('SYNC_FRIEND_REQUESTS_FROM_EXTENSION', allRequests, webappTabs);
          console.log('[Background] ✅ Successfully synced friend request updates to webapp');
        }
      } catch (error) {
        console.log('[Background] ❌ Error syncing friend request updates to webapp:', error);
      }
    }
    
    // Notify popup if open and trigger tag assignment modal
    chrome.runtime.sendMessage({
      type: 'FRIEND_REQUEST_STATUSES_UPDATED',
      updatedCount: updatedRequests.length,
      acceptedFriends: acceptedFriends,
      stats: stats,
      showTagAssignmentModal: acceptedFriends.length > 0
    }).catch(() => {
      // Popup not open - store pending modal for when it reopens
      if (acceptedFriends.length > 0) {
        console.log('[Background] Popup not open, storing pending tag assignment modal for', acceptedFriends.length, 'accepted friends');
        chrome.storage.local.set({
          pendingTagAssignmentModal: {
            acceptedFriends: acceptedFriends,
            timestamp: Date.now()
          }
        });
      }
    });
    
    return {
      updatedCount: updatedRequests.length,
      acceptedFriends: acceptedFriends
    };
    
  } catch (error) {
    console.error('[Background] Failed to process friend status results:', error);
    throw error;
  }
}

/**
 * Function to be injected into friends list page
 */
/**
 * Function to be injected into friends list page - UPDATED FOR FRIENDS LIST
 */
/**
 * Function to be injected into friends list page - NAME MATCHING VERSION
 */
function extractFriendsData(targetFriendRequests) {
  console.log('[Friends Extractor] Scanning friends list for friend requests:', targetFriendRequests);

  const foundFriends = [];

  // Normalize name for matching
  function normalizeNameForMatching(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Check if two names match
  function namesMatch(name1, name2) {
    if (!name1 || !name2) return false;

    const norm1 = normalizeNameForMatching(name1);
    const norm2 = normalizeNameForMatching(name2);

    // Exact match
    if (norm1 === norm2) return true;

    // Check partial matches for longer names
    const words1 = norm1.split(' ').filter(w => w.length > 1);
    const words2 = norm2.split(' ').filter(w => w.length > 1);

    if (words1.length >= 2 && words2.length >= 2) {
      const commonWords = words1.filter(word => words2.includes(word));
      return commonWords.length >= 2;
    }

    return norm1 === norm2;
  }

  // Scroll to load all friends
  async function scrollToLoadAll() {
    console.log('[Friends Extractor] Starting auto-scroll to load all friends...');

    // Find the scrollable container - look for the parent of the scrollbar thumb
    // The scrollbar thumb has [data-thumb="1"], its parent is the scrollable div
    const scrollThumb = document.querySelector('[data-visualcompletion="ignore"][data-thumb="1"]');
    let scrollContainer = null;

    if (scrollThumb) {
      // Get the parent element that is scrollable
      scrollContainer = scrollThumb.parentElement;
      console.log('[Friends Extractor] Found scrollbar thumb, using parent as scroll container');
    }

    // Fallback options if we can't find via scrollbar
    if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
      // Try to find a div with overflow and scrollable content
      const allDivs = document.querySelectorAll('div');
      for (const div of allDivs) {
        const style = window.getComputedStyle(div);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            div.scrollHeight > div.clientHeight) {
          scrollContainer = div;
          console.log('[Friends Extractor] Found scrollable container by overflow style');
          break;
        }
      }
    }

    if (!scrollContainer) {
      console.warn('[Friends Extractor] Could not find scroll container, using document');
      scrollContainer = document.documentElement;
    }

    console.log('[Friends Extractor] Using scroll container:', {
      tagName: scrollContainer.tagName,
      scrollHeight: scrollContainer.scrollHeight,
      clientHeight: scrollContainer.clientHeight,
      hasThumb: !!scrollThumb
    });

    let lastScrollHeight = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 50; // Increased attempts
    let noChangeCount = 0;

    while (scrollAttempts < maxScrollAttempts) {
      // Get current scroll height
      const currentScrollHeight = scrollContainer.scrollHeight;

      // Scroll to bottom
      if (scrollContainer === document.documentElement) {
        window.scrollTo(0, document.body.scrollHeight);
      } else {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }

      console.log(`[Friends Extractor] Scroll attempt ${scrollAttempts + 1}/${maxScrollAttempts} - Height: ${currentScrollHeight}, ScrollTop: ${scrollContainer.scrollTop}`);

      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 800)); // Increased delay

      // Check if we've reached the bottom (no new content loaded)
      const newScrollHeight = scrollContainer.scrollHeight;
      if (newScrollHeight === lastScrollHeight) {
        noChangeCount++;
        console.log(`[Friends Extractor] No height change (${noChangeCount}/3)`);

        // Need 3 consecutive attempts with no change to confirm we're at bottom
        if (noChangeCount >= 3) {
          console.log('[Friends Extractor] Reached bottom - no more content to load');
          break;
        }
      } else {
        noChangeCount = 0; // Reset counter if height changed
      }

      lastScrollHeight = newScrollHeight;
      scrollAttempts++;
    }

    console.log(`[Friends Extractor] Scrolling complete after ${scrollAttempts} attempts`);

    // Scroll back to top
    if (scrollContainer === document.documentElement) {
      window.scrollTo(0, 0);
    } else {
      scrollContainer.scrollTop = 0;
    }

    // Wait a bit for any final renders
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  try {
    // Wait for content to load
    let attempts = 0;
    const maxAttempts = 10;

    async function waitForContent() {
      const allLinks = document.querySelectorAll('a[href*="facebook.com"], a[href^="/"]');
      const friendLinks = Array.from(allLinks).filter(link => {
        const href = link.getAttribute('href');
        return href && (
          href.includes('profile.php?id=') ||
          (href.includes('facebook.com/') && !href.includes('/groups/') && !href.includes('/pages/')) ||
          (href.startsWith('/') && !href.startsWith('/groups/') && !href.startsWith('/pages/'))
        );
      });

      console.log('[Friends Extractor] Attempt', attempts + 1, '- Found', friendLinks.length, 'potential friend links');

      if (friendLinks.length > 0 || attempts >= maxAttempts) {
        // First scroll to load all friends
        await scrollToLoadAll();

        // Then process all loaded friend links
        const allLinksAfterScroll = document.querySelectorAll('a[href*="facebook.com"], a[href^="/"]');
        const friendLinksAfterScroll = Array.from(allLinksAfterScroll).filter(link => {
          const href = link.getAttribute('href');
          return href && (
            href.includes('profile.php?id=') ||
            (href.includes('facebook.com/') && !href.includes('/groups/') && !href.includes('/pages/')) ||
            (href.startsWith('/') && !href.startsWith('/groups/') && !href.startsWith('/pages/'))
          );
        });

        console.log('[Friends Extractor] After scrolling - Found', friendLinksAfterScroll.length, 'friend links');
        processFriendLinks(friendLinksAfterScroll);
      } else {
        attempts++;
        setTimeout(waitForContent, 1000);
      }
    }
    
    function processFriendLinks(friendLinks) {
      console.log('[Friends Extractor] Processing', friendLinks.length, 'friend links');
      console.log('[Friends Extractor] Looking for these names:', targetFriendRequests.map(req => req.name));
      
      friendLinks.forEach((link, index) => {
        const href = link.getAttribute('href');
        let friendName = 'Unknown';
        
        // Extract name from multiple sources
        const ariaLabel = link.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.trim() && !ariaLabel.toLowerCase().includes('more')) {
          friendName = ariaLabel.trim();
        }
        
        if (friendName === 'Unknown') {
          const container = link.closest('[data-visualcompletion="ignore-dynamic"]') || 
                          link.closest('div[role="listitem"]') ||
                          link.parentElement;
          
          if (container) {
            const svg = container.querySelector('svg[aria-label]');
            if (svg) {
              const svgLabel = svg.getAttribute('aria-label')?.trim();
              if (svgLabel && !svgLabel.toLowerCase().includes('more')) {
                friendName = svgLabel;
              }
            }
          }
        }
        
        if (friendName === 'Unknown') {
          const container = link.closest('[data-visualcompletion="ignore-dynamic"]') || 
                          link.closest('div[role="listitem"]') ||
                          link.closest('div');
          
          if (container) {
            const nameSpans = container.querySelectorAll('span');
            for (const span of nameSpans) {
              const text = span.textContent?.trim();
              if (text && 
                  text.length > 1 && 
                  text.length < 50 &&
                  !text.includes('•') && 
                  !text.includes('friends') &&
                  !text.includes('Joined') &&
                  !text.includes('ago') &&
                  !text.includes('More') &&
                  text.split(' ').length <= 4) {
                friendName = text;
                break;
              }
            }
          }
        }
        
        // Debug first few links
        if (index < 10) {
          console.log('[Friends Extractor] Link', index, ':', { 
            href, 
            extractedName: friendName,
            linkText: link.textContent?.trim().substring(0, 30)
          });
        }
        
        // NOW MATCH BY NAME instead of userId
        if (friendName !== 'Unknown') {
          const matchingRequest = targetFriendRequests.find(req => 
            namesMatch(friendName, req.name)
          );
          
          if (matchingRequest) {
            const foundFriend = {
              userId: matchingRequest.userId, // Use original userId from request
              name: friendName,
              originalRequestName: matchingRequest.name,
              profileUrl: href.startsWith('http') ? href : `https://www.facebook.com${href}`
            };
            
            foundFriends.push(foundFriend);
            console.log('[Friends Extractor] ✅ Found matching friend by NAME:', {
              friendsListName: friendName,
              originalRequestName: matchingRequest.name,
              match: 'SUCCESS'
            });
          }
        }
      });
      
      console.log('[Friends Extractor] Extraction complete. Found', foundFriends.length, 'matching friends by name');
      console.log('[Friends Extractor] Target names:', targetFriendRequests.map(req => req.name));
      console.log('[Friends Extractor] Found matches:', foundFriends.map(f => f.name));
    }
    
    // Start the process
    waitForContent();
    
    return new Promise((resolve) => {
      const checkResults = () => {
        if (foundFriends.length > 0 || attempts >= maxAttempts) {
          resolve(foundFriends);
        } else {
          setTimeout(checkResults, 500);
        }
      };
      
      setTimeout(checkResults, 2000);
      setTimeout(() => resolve(foundFriends), 15000);
    });
    
  } catch (error) {
    console.error('[Friends Extractor] Error during extraction:', error);
    return [];
  }
}

/* ===============================
   NOTES API PROXY
   ===============================

   Proxies notes CRUD operations from content scripts (which can't
   call localhost due to mixed content) through the service worker
   which has host_permissions.
*/

/**
 * Validate that an ID is safe for URL interpolation (alphanumeric, hyphens, underscores only).
 */
function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Load notes for a specific contact
 */
async function handleLoadNotes(contactUserId, sendResponse) {
  try {
    // Get JWT token from Chrome storage
    const result = await chrome.storage.local.get(['crmFixedJwtToken']);
    const jwtToken = result.crmFixedJwtToken;

    if (!jwtToken) {
      throw new Error('No authenticated user - Please ensure you are logged in to the extension');
    }

    if (!isValidId(String(contactUserId))) {
      throw new Error('Invalid contact user ID');
    }

    console.log('[Background] Loading notes for contact:', contactUserId);

    const response = await fetch(`${CONFIG.API_BASE_URL}/notes/${contactUserId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to load notes');
    }

    console.log(`[Background] Loaded ${data.data.length} notes for contact ${contactUserId}`);
    sendResponse({ success: true, data: data.data });
  } catch (error) {
    console.error('[Background] Error loading notes:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Add a new note
 */
async function handleAddNote(payload, sendResponse) {
  try {
    // Get JWT token from Chrome storage
    const result = await chrome.storage.local.get(['crmFixedJwtToken']);
    const jwtToken = result.crmFixedJwtToken;

    if (!jwtToken) {
      throw new Error('No authenticated user - Please ensure you are logged in to the extension');
    }

    const { contactUserId, contactName, noteText, profilePicture } = payload;
    console.log('[Background] Adding note for contact:', contactUserId);

    const requestBody = {
      contactUserId,
      contactName,
      noteText
    };

    if (profilePicture) {
      requestBody.profilePicture = profilePicture;
    }

    const response = await fetch(`${CONFIG.API_BASE_URL}/notes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to add note');
    }

    console.log('[Background] Note added successfully');
    sendResponse({ success: true, data: data.data });
  } catch (error) {
    console.error('[Background] Error adding note:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Update an existing note
 */
async function handleUpdateNote(payload, sendResponse) {
  try {
    // Get JWT token from Chrome storage
    const result = await chrome.storage.local.get(['crmFixedJwtToken']);
    const jwtToken = result.crmFixedJwtToken;

    if (!jwtToken) {
      throw new Error('No authenticated user - Please ensure you are logged in to the extension');
    }

    const { contactUserId, noteId, noteText } = payload;
    if (!isValidId(String(contactUserId)) || !isValidId(String(noteId))) {
      throw new Error('Invalid contact user ID or note ID');
    }
    console.log('[Background] Updating note:', noteId);

    const response = await fetch(`${CONFIG.API_BASE_URL}/notes/${contactUserId}/${noteId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        noteText
      })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to update note');
    }

    console.log('[Background] Note updated successfully');
    sendResponse({ success: true, data: data.data });
  } catch (error) {
    console.error('[Background] Error updating note:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Delete a note
 */
async function handleDeleteNote(payload, sendResponse) {
  try {
    // Get JWT token from Chrome storage
    const result = await chrome.storage.local.get(['crmFixedJwtToken']);
    const jwtToken = result.crmFixedJwtToken;

    if (!jwtToken) {
      throw new Error('No authenticated user - Please ensure you are logged in to the extension');
    }

    const { contactUserId, noteId } = payload;
    if (!isValidId(String(contactUserId)) || !isValidId(String(noteId))) {
      throw new Error('Invalid contact user ID or note ID');
    }
    console.log('[Background] Deleting note:', noteId);

    const response = await fetch(`${CONFIG.API_BASE_URL}/notes/${contactUserId}/${noteId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to delete note');
    }

    console.log('[Background] Note deleted successfully');
    sendResponse({ success: true, data: data.data });
  } catch (error) {
    console.error('[Background] Error deleting note:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Get all contacts that have notes
 */
async function handleGetAllContactsWithNotes(sendResponse) {
  try {
    // Get JWT token from Chrome storage
    const result = await chrome.storage.local.get(['crmFixedJwtToken']);
    const jwtToken = result.crmFixedJwtToken;

    if (!jwtToken) {
      throw new Error('No authenticated user - Please ensure you are logged in to the extension');
    }

    console.log('[Background] Getting all contacts with notes');

    const response = await fetch(`${CONFIG.API_BASE_URL}/notes/contacts/all`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    console.log('[Background] API response:', data);

    if (!data.success) {
      throw new Error(data.error || 'Failed to get contacts with notes');
    }

    console.log(`[Background] Found ${data.data.length} contacts with notes:`, data.data);
    console.log('[Background] Sending response to content script:', { success: true, data: data.data });
    sendResponse({ success: true, data: data.data });
  } catch (error) {
    console.error('[Background] Error getting contacts with notes:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/* ===============================
   MESSAGE LISTENER (ENHANCED)
   ===============================

   Main internal message router — handles messages from popup, content
   scripts, and webapp sync; dispatches to appropriate handlers; sender
   validated to own extension ID only.
*/
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own extension (content scripts, popup, etc.)
  if (sender.id !== chrome.runtime.id) {
    console.warn('[Background] Rejected message from unknown sender:', sender.id);
    return false;
  }

  console.log('[Background] Received message:', msg);

  // Handle PING requests from web app (for connection testing)
  if (msg.type === 'PING') {
    console.log('[Background] Received PING from web app, sending PONG');
    sendResponse({ type: 'PONG', success: true, timestamp: Date.now() });
    return false; // Sync response
  }

  // Handle friend request tracking
  if (msg.action === 'trackFriendRequest') {
    console.log('[Background] 🤝 Handling trackFriendRequest');
    handleTrackFriendRequest(msg.requestData, sendResponse);
    return true; // Async response
  }

  // Handle friend request status updates
  if (msg.action === 'updateFriendRequestStatus') {
    console.log('[Background] 📱 Handling updateFriendRequestStatus');
    handleUpdateFriendRequestStatus(msg.userId, msg.status, msg.timestamp, sendResponse);
    return true; // Async response
  }

  // Handle friend request removal (cancellation)
  if (msg.action === 'removeFriendRequest') {
    console.log('[Background] 🗑️ Handling removeFriendRequest');
    handleRemoveFriendRequest(msg.userId, sendResponse);
    return true; // Async response
  }

  // Handle friend request status checking
if (msg.action === 'checkFriendRequestStatuses') {
  console.log('[Background] 🔍 Handling checkFriendRequestStatuses');
  handleCheckFriendRequestStatuses(sendResponse);
  return true; // Async response
}

  // Handle getting friend request refresh state
  if (msg.action === 'getFriendRequestRefreshState') {
    sendResponse({ 
      success: true, 
      refreshState: friendRequestRefreshState 
    });
    return false; // Sync response
  }

  // Handle tag requests from content scripts
  if (msg.action === 'getTags') {
    chrome.storage.local.get(['tags'], (result) => {
      const tags = result.tags || [];
      console.log('[Background] Sending tags to content script:', tags);
      sendResponse({ tags: tags });
    });
    return true; // Keep message channel open for async response
  }

  // Handle template requests from content scripts
  if (msg.action === 'getTemplates') {
    chrome.storage.local.get(['templates'], (result) => {
      let templates = [];

      // Handle different storage formats
      if (result.templates) {
        if (Array.isArray(result.templates)) {
          templates = result.templates;
        } else if (result.templates.templates && Array.isArray(result.templates.templates)) {
          templates = result.templates.templates;
        }
      }

      console.log('[Background] Sending templates to content script:', templates);
      sendResponse({ templates: templates });
    });
    return true; // Keep message channel open for async response
  }

  // Handle saving contacts to tags
  if (msg.action === 'saveContactsToTags') {
    console.log('[Background] 💾 Handling saveContactsToTags from content script, contacts:', msg.contacts?.length);
    handleSaveContactsToTags(msg, sendResponse);
    return true; // Keep message channel open for async response
  }

  // Handle creating new tags
  if (msg.action === 'createTag') {
    console.log('[Background] 🏷️ Handling createTag:', msg.tagData);
    handleCreateTag(msg.tagData, sendResponse);
    return true; // Keep message channel open for async response
  }

  // Handle bulk send progress requests
  if (msg.type === 'GET_BULK_PROGRESS') {
    sendResponse({ progress: { ...bulkSendProgress } });
    return false; // Sync response
  }

  // Handle bulk send cancellation from popup
  if (msg.type === 'CANCEL_BULK_SEND') {
    console.log('[Background] 🛑 CANCEL_BULK_SEND received from popup, current progress:', bulkSendProgress);
    
    if (bulkSendProgress.isActive) {
      console.log('[Background] 🛑 Cancelling active bulk send operation from popup');
      bulkSendProgress.cancelled = true;  // Set cancelled flag
      bulkSendProgress.isActive = false;
      
      console.log('[Background] 🛑 Bulk send marked as cancelled:', bulkSendProgress);
      sendResponse({ cancelled: true });
      
      // Don't reset progress immediately - let the bulk send loop handle completion
      // The bulk send loop will detect the cancelled flag and complete normally
    } else {
      console.log('[Background] 🛑 No active bulk send to cancel from popup');
      sendResponse({ cancelled: false, reason: 'No active operation' });
    }
    return false;
  }

  // Handle bulk send start
  if (msg.type === 'BULK_SEND') {
    console.log('🎯 [Background] Received BULK_SEND message:', {
      type: msg.type,
      payload: msg.payload ? {
        recipients: msg.payload.recipients?.length,
        template: msg.payload.template?.substring(0, 50) + '...',
        delay: msg.payload.delaySec,
        batchSize: msg.payload.batchSize,
        batchWaitMinutes: msg.payload.batchWaitMinutes,
        campaignId: msg.payload.campaignId
      } : 'No payload'
    });

    const { recipients, template, delaySec, batchSize, batchWaitMinutes, selectedTagIds } = msg.payload;
    if (bulkSendProgress.isActive) {
      console.log('❌ [Background] Bulk send already running');
      sendResponse({ status: 'error', message: 'Already running' });
      return false;
    }
    console.log('✅ [Background] Starting bulk send process...', {
      count: recipients.length,
      batchSize: batchSize || 0,
      batchWaitMinutes: batchWaitMinutes || 0
    });
    // Create campaign in backend so webapp can track it
    (async () => {
      const campaignId = await createAndStartCampaign(recipients, template, delaySec, selectedTagIds || []);
      console.log('[Background] Extension campaign created:', campaignId);
      sendSequentially(recipients, template, delaySec, batchSize, batchWaitMinutes, campaignId);
    })();
    const response = { status: 'started', count: recipients.length };
    console.log('📤 [Background] Sending response back to webapp:', response);
    sendResponse(response);
    return false; // Sync response
  }

  // Handle sync requests from web app
  if (msg.type === 'SYNC_CONTACTS_TO_EXTENSION') {
    console.log('[Background] Syncing contacts from web app:', msg.payload?.contacts?.length);
    if (msg.payload?.contacts) {
      // Normalize tags to plain string IDs (webapp may send objects with id+pivot)
      const incomingContacts = msg.payload.contacts.map(c => ({
        ...c,
        tags: Array.isArray(c.tags) ? c.tags.map(t => typeof t === 'object' && t !== null ? t.id : t).filter(Boolean) : []
      }));
      // Merge: preserve local tag assignments not yet in backend
      chrome.storage.local.get(['contacts'], (result) => {
        const localContacts = result.contacts || [];
        const localMap = new Map();
        for (const lc of localContacts) {
          if (lc.userId) localMap.set(lc.userId, lc);
          if (lc.name) localMap.set('n:' + lc.name, lc);
        }
        // Merge local tags into incoming contacts
        for (const ic of incomingContacts) {
          const local = (ic.userId && localMap.get(ic.userId)) || localMap.get('n:' + ic.name);
          if (local && Array.isArray(local.tags)) {
            local.tags.forEach(t => {
              if (!ic.tags.includes(t)) ic.tags.push(t);
            });
          }
        }
        // Include local-only contacts not in webapp
        const incomingIds = new Set(incomingContacts.map(c => c.id));
        const incomingUserIds = new Set(incomingContacts.map(c => c.userId).filter(Boolean));
        const localOnly = localContacts.filter(c =>
          !incomingIds.has(c.id) && !(c.userId && incomingUserIds.has(c.userId))
        );
        const merged = [...incomingContacts, ...localOnly];
        chrome.storage.local.set({
          contacts: merged,
          lastWebUpdate: Date.now()
        }, () => {
          sendResponse({ success: true, count: merged.length });
        });
      });
      return true; // Async response
    }
    sendResponse({ success: false, error: 'No contacts provided' });
    return false;
  }

  if (msg.type === 'SYNC_TAGS_TO_EXTENSION') {
    console.log('[Background] Syncing tags from web app:', msg.payload?.tags?.length);
    if (msg.payload?.tags) {
      // Merge: preserve local-only tags not yet in backend
      chrome.storage.local.get(['tags'], (result) => {
        const localTags = result.tags || [];
        const incomingIds = new Set(msg.payload.tags.map(t => t.id));
        const incomingNames = new Set(msg.payload.tags.map(t => (t.name || '').toLowerCase()));
        const localOnly = localTags.filter(t =>
          !incomingIds.has(t.id) && !incomingNames.has((t.name || '').toLowerCase())
        );
        const merged = [...msg.payload.tags, ...localOnly];
        chrome.storage.local.set({
          tags: merged,
          lastWebUpdate: Date.now()
        }, () => {
          sendResponse({ success: true, count: merged.length });
        });
      });
      return true; // Async response
    }
    sendResponse({ success: false, error: 'No tags provided' });
    return false;
  }

  if (msg.type === 'SYNC_TEMPLATES_TO_EXTENSION') {
    console.log('[Background] Syncing templates from web app:', msg.payload?.templates?.length);
    if (msg.payload?.templates) {
      chrome.storage.local.set({ 
        templates: msg.payload.templates,
        lastWebUpdate: Date.now()
      }, () => {
        sendResponse({ success: true, count: msg.payload.templates.length });
      });
      return true; // Async response
    }
    sendResponse({ success: false, error: 'No templates provided' });
    return false;
  }

  // Handle data changes from popup - sync to webapp
  if (msg.type === 'DATA_CHANGED') {
    console.log('[Background] Data changed, syncing to web app...');
    handleDataChangeSync(msg.payload);
    sendResponse({ success: true });
    return false;
  }

  // Handle contacts sync from messenger content script (can't fetch localhost directly due to CSP)
  if (msg.type === 'SYNC_CONTACTS_TO_BACKEND') {
    console.log('[Background] Syncing contacts to backend from content script');
    (async () => {
      try {
        const result = await chrome.storage.local.get(['crmFixedJwtToken', 'tags']);
        const token = result.crmFixedJwtToken;
        if (!token) {
          sendResponse({ success: false, error: 'No auth token' });
          return;
        }

        // Sync tags FIRST so the backend knows about them before contacts reference them
        const tags = result.tags || [];
        if (tags.length > 0) {
          console.log('[Background] Syncing', tags.length, 'tags to backend before contacts...');
          const tagResponse = await fetch(`${CONFIG.API_BASE_URL}/tags/sync`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ tags, fullSync: false }),
          });
          if (!tagResponse.ok) {
            console.warn('[Background] Tag pre-sync failed:', tagResponse.status);
          } else {
            console.log('[Background] Tags pre-synced successfully');
          }
        }

        // Now sync contacts (tags exist in backend, so tag assignments will work)
        const contacts = msg.payload?.contacts || [];
        const response = await fetch(`${CONFIG.API_BASE_URL}/contacts/sync`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ contacts, fullSync: false }),
        });
        if (!response.ok) {
          const text = await response.text();
          console.error('[Background] Contacts sync failed:', response.status, text);
          sendResponse({ success: false, error: `API error ${response.status}` });
          return;
        }
        console.log('[Background] Contacts synced to backend, notifying webapp tabs');
        // Notify any open dashboard tabs to refresh
        handleDataChangeSync({ contacts, tags });
        sendResponse({ success: true });
      } catch (err) {
        console.error('[Background] SYNC_CONTACTS_TO_BACKEND error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Async response
  }

  // Handle get data requests from web app
  if (msg.type === 'GET_CONTACTS_FROM_EXTENSION') {
    chrome.storage.local.get(['contacts'], (result) => {
      sendResponse({ payload: result.contacts || [] });
    });
    return true; // Async response
  }

  if (msg.type === 'GET_TAGS_FROM_EXTENSION') {
    chrome.storage.local.get(['tags'], (result) => {
      sendResponse({ payload: result.tags || [] });
    });
    return true; // Async response
  }

  if (msg.type === 'GET_TEMPLATES_FROM_EXTENSION') {
    chrome.storage.local.get(['templates'], (result) => {
      sendResponse({ payload: result.templates || [] });
    });
    return true; // Async response
  }

  // Handle Notes operations
  if (msg.type === 'NOTES_LOAD') {
    console.log('[Background] 📝 Loading notes for contact:', msg.payload?.contactUserId);
    handleLoadNotes(msg.payload?.contactUserId, sendResponse).catch(err => {
      console.error('[Background] handleLoadNotes failed:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // Async response
  }

  if (msg.type === 'NOTES_ADD') {
    console.log('[Background] 📝 Adding note for contact:', msg.payload?.contactName);
    handleAddNote(msg.payload, sendResponse).catch(err => {
      console.error('[Background] handleAddNote failed:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // Async response
  }

  if (msg.type === 'NOTES_UPDATE') {
    console.log('[Background] 📝 Updating note:', msg.payload?.noteId);
    handleUpdateNote(msg.payload, sendResponse).catch(err => {
      console.error('[Background] handleUpdateNote failed:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // Async response
  }

  if (msg.type === 'NOTES_DELETE') {
    console.log('[Background] 📝 Deleting note:', msg.payload?.noteId);
    handleDeleteNote(msg.payload, sendResponse).catch(err => {
      console.error('[Background] handleDeleteNote failed:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // Async response
  }

  if (msg.type === 'NOTES_GET_ALL_CONTACTS') {
    console.log('[Background] 📝 Getting all contacts with notes');
    handleGetAllContactsWithNotes(sendResponse).catch(err => {
      console.error('[Background] handleGetAllContactsWithNotes failed:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // Async response
  }

  // Handle get Facebook cookies request
  if (msg.action === 'getFacebookCookies') {
    chrome.cookies.get({ url: 'https://www.facebook.com', name: 'c_user' }, (cookie) => {
      sendResponse(cookie ? { c_user: cookie.value } : {});
    });
    return true; // Async response
  }

  // Handle Facebook account validation (route through background to avoid CORS)
  if (msg.action === 'validateFacebookAccount') {
    console.log('[Background] Validating Facebook account:', msg.facebookUserId);

    const validateAccount = async () => {
      try {
        // Read token from storage instead of trusting caller-supplied value
        const storage = await chrome.storage.local.get(['crmFixedJwtToken']);
        const token = storage.crmFixedJwtToken;
        if (!token) {
          sendResponse({ success: false, error: 'Not authenticated', code: 'UNAUTHENTICATED' });
          return;
        }

        const response = await fetch(`${CONFIG.API_BASE_URL}/facebook-accounts/validate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            facebookUserId: msg.facebookUserId
          })
        });

        const result = await response.json();
        console.log('[Background] Validation response:', result);
        sendResponse(result);
      } catch (error) {
        console.error('[Background] Error validating Facebook account:', error);
        sendResponse({
          success: false,
          error: 'Failed to validate account: ' + error.message,
          code: 'VALIDATION_ERROR'
        });
      }
    };

    validateAccount();
    return true; // Async response
  }

  // Handle auto-link Facebook account
  if (msg.action === 'autoLinkFacebookAccount') {
    console.log('[Background] Auto-linking Facebook account:', msg.facebookUserId);

    const linkAccount = async () => {
      try {
        // Read token from storage instead of trusting caller-supplied value
        const storage = await chrome.storage.local.get(['crmFixedJwtToken']);
        const token = storage.crmFixedJwtToken;
        if (!token) {
          sendResponse({ success: false, error: 'Not authenticated', code: 'UNAUTHENTICATED' });
          return;
        }

        const response = await fetch(`${CONFIG.API_BASE_URL}/facebook-accounts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            facebookUserId: msg.facebookUserId,
            facebookName: msg.facebookName,
            profileUrl: `https://www.facebook.com/profile.php?id=${msg.facebookUserId}`
          })
        });

        const result = await response.json();

        if (result.success) {
          console.log('[Background] ✅ Facebook account linked successfully');
          sendResponse({ success: true });
        } else {
          console.log('[Background] ❌ Failed to link Facebook account:', result.error);
          sendResponse({ success: false, error: result.error });
        }
      } catch (error) {
        console.error('[Background] Error linking Facebook account:', error);
        sendResponse({ success: false, error: error.message });
      }
    };

    linkAccount();
    return true; // Async response
  }

  return false; // No async response needed
});

/* ===============================
   EXTERNAL MESSAGE LISTENER
   ===============================

   Handles messages from webapp via chrome.runtime.sendMessageExternal
   (externally_connectable); validates sender origin against
   CONFIG.ALLOWED_ORIGINS.
*/
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  console.log('[Background] Received external message from:', sender.origin, msg);

  // Verify sender is from allowed origins
  if (!CONFIG.ALLOWED_ORIGINS.some(o => sender.origin === o)) {
    console.log('[Background] Rejected message from unauthorized origin:', sender.origin);
    sendResponse({ error: 'Unauthorized origin' });
    return false;
  }

  // Handle PING requests from web app (for connection testing)
  if (msg.type === 'PING') {
    console.log('[Background] Received external PING from web app, sending PONG');
    sendResponse({ type: 'PONG', success: true, timestamp: Date.now() });
    return false; // Sync response
  }

  // Handle sync requests from web app
  if (msg.type === 'SYNC_CONTACTS_TO_EXTENSION') {
    console.log('[Background] External sync contacts from web app:', msg.payload?.contacts?.length, 'contacts');
    if (msg.payload?.contacts) {
      const incomingContacts = msg.payload.contacts.map(c => ({
        ...c,
        tags: Array.isArray(c.tags) ? c.tags.map(t => typeof t === 'object' && t !== null ? t.id : t).filter(Boolean) : []
      }));
      // Merge: preserve local tag assignments not yet in backend
      chrome.storage.local.get(['contacts'], (result) => {
        const localContacts = result.contacts || [];
        const localMap = new Map();
        for (const lc of localContacts) {
          if (lc.userId) localMap.set(lc.userId, lc);
          if (lc.name) localMap.set('n:' + lc.name, lc);
        }
        for (const ic of incomingContacts) {
          const local = (ic.userId && localMap.get(ic.userId)) || localMap.get('n:' + ic.name);
          if (local && Array.isArray(local.tags)) {
            local.tags.forEach(t => {
              if (!ic.tags.includes(t)) ic.tags.push(t);
            });
          }
        }
        const incomingIds = new Set(incomingContacts.map(c => c.id));
        const incomingUserIds = new Set(incomingContacts.map(c => c.userId).filter(Boolean));
        const localOnly = localContacts.filter(c =>
          !incomingIds.has(c.id) && !(c.userId && incomingUserIds.has(c.userId))
        );
        const merged = [...incomingContacts, ...localOnly];
        chrome.storage.local.set({
          contacts: merged,
          lastWebUpdate: Date.now()
        }, () => {
          sendResponse({ success: true, count: merged.length });
        });
      });
      return true; // Async response
    }
    sendResponse({ success: false, error: 'No contacts provided' });
    return false;
  }

  if (msg.type === 'SYNC_TAGS_TO_EXTENSION') {
    console.log('[Background] External sync tags from web app:', msg.payload?.tags?.length, 'tags');
    if (msg.payload?.tags) {
      chrome.storage.local.get(['tags'], (result) => {
        const localTags = result.tags || [];
        const incomingIds = new Set(msg.payload.tags.map(t => t.id));
        const incomingNames = new Set(msg.payload.tags.map(t => (t.name || '').toLowerCase()));
        const localOnly = localTags.filter(t =>
          !incomingIds.has(t.id) && !incomingNames.has((t.name || '').toLowerCase())
        );
        const merged = [...msg.payload.tags, ...localOnly];
        chrome.storage.local.set({
          tags: merged,
          lastWebUpdate: Date.now()
        }, () => {
          sendResponse({ success: true, count: merged.length });
        });
      });
      return true; // Async response
    }
    sendResponse({ success: false, error: 'No tags provided' });
    return false;
  }

  if (msg.type === 'SYNC_TEMPLATES_TO_EXTENSION') {
    console.log('[Background] 🔄 External sync templates from web app:', msg.payload?.templates?.length, 'templates');
    if (msg.payload?.templates) {
      chrome.storage.local.set({ 
        templates: msg.payload.templates,
        lastWebUpdate: Date.now()
      }, () => {
        console.log('[Background] ✅ Templates synced to extension storage');
        sendResponse({ success: true, count: msg.payload.templates.length });
      });
      return true; // Async response
    }
    console.log('[Background] ❌ No templates provided in sync request');
    sendResponse({ success: false, error: 'No templates provided' });
    return false;
  }

  if (msg.type === 'SYNC_FRIEND_REQUESTS_TO_EXTENSION') {
    console.log('[Background] 🔄 External sync friend requests from web app:', msg.payload?.friendRequests?.length, 'friend requests');
    if (msg.payload?.friendRequests) {
      chrome.storage.local.set({ 
        webappFriendRequests: msg.payload.friendRequests,
        lastWebUpdate: Date.now()
      }, () => {
        console.log('[Background] ✅ Friend requests synced to extension storage');
        sendResponse({ success: true, count: msg.payload.friendRequests.length });
      });
      return true; // Async response
    }
    console.log('[Background] ❌ No friend requests provided in sync request');
    sendResponse({ success: false, error: 'No friend requests provided' });
    return false;
  }

  // Handle get data requests from web app
  if (msg.type === 'GET_CONTACTS_FROM_EXTENSION') {
    chrome.storage.local.get(['contacts'], (result) => {
      sendResponse({ payload: result.contacts || [] });
    });
    return true; // Async response
  }

  if (msg.type === 'GET_TAGS_FROM_EXTENSION') {
    chrome.storage.local.get(['tags'], (result) => {
      sendResponse({ payload: result.tags || [] });
    });
    return true; // Async response
  }

  if (msg.type === 'GET_TEMPLATES_FROM_EXTENSION') {
    chrome.storage.local.get(['templates'], (result) => {
      sendResponse({ payload: result.templates || [] });
    });
    return true; // Async response
  }

  if (msg.type === 'GET_FRIENDREQUESTS_FROM_EXTENSION') {
    chrome.storage.local.get(['friendRequests', 'friendRequestStats'], (result) => {
      sendResponse({ 
        payload: {
          friendRequests: result.friendRequests || [],
          stats: result.friendRequestStats || { total: 0, pending: 0, accepted: 0 }
        }
      });
    });
    return true; // Async response
  }

  // Handle Facebook account deletion from webapp
  if (msg.type === 'FACEBOOK_ACCOUNT_DELETED') {
    console.log('[Background] Facebook account deleted from webapp, clearing cache');
    chrome.storage.local.remove(['validatedFacebookAccount', 'facebookAccountLinked'], () => {
      console.log('[Background] ✅ Facebook account cache cleared');
      sendResponse({ success: true });
    });
    return true; // Async response
  }

  // Handle bulk send start from external web app
  if (msg.type === 'BULK_SEND') {
    console.log('🎯 [Background] Received external BULK_SEND message:', {
      type: msg.type,
      payload: msg.payload ? {
        recipients: msg.payload.recipients?.length,
        template: msg.payload.template?.substring(0, 50) + '...',
        delay: msg.payload.delaySec,
        batchSize: msg.payload.batchSize,
        batchWaitMinutes: msg.payload.batchWaitMinutes,
        campaignId: msg.payload.campaignId
      } : 'No payload'
    });

    const { recipients, template, delaySec, batchSize, batchWaitMinutes } = msg.payload;
    if (bulkSendProgress.isActive) {
      console.log('❌ [Background] Bulk send already running');
      sendResponse({ status: 'error', message: 'Already running' });
      return false;
    }
    console.log('✅ [Background] Starting external bulk send process...', {
      count: recipients.length,
      batchSize: batchSize || 0,
      batchWaitMinutes: batchWaitMinutes || 0
    });
    sendSequentially(recipients, template, delaySec, batchSize, batchWaitMinutes);
    const response = { status: 'started', count: recipients.length };
    console.log('📤 [Background] Sending response back to webapp:', response);
    sendResponse(response);
    return false; // Sync response
  }

  // Handle bulk send progress requests from external web app
  if (msg.type === 'GET_BULK_PROGRESS') {
    sendResponse({ progress: { ...bulkSendProgress } });
    return false; // Sync response
  }

  // Handle bulk send cancellation from external web app
  if (msg.type === 'CANCEL_BULK_SEND') {
    console.log('[Background] 🛑 CANCEL_BULK_SEND received, current progress:', bulkSendProgress);
    
    if (bulkSendProgress.isActive) {
      console.log('[Background] 🛑 Cancelling active bulk send operation');
      bulkSendProgress.cancelled = true;  // Set cancelled flag
      bulkSendProgress.isActive = false;
      
      console.log('[Background] 🛑 Bulk send marked as cancelled:', bulkSendProgress);
      sendResponse({ cancelled: true });
      
      // Don't reset progress immediately - let the bulk send loop handle completion
      // The bulk send loop will detect the cancelled flag and complete normally
    } else {
      console.log('[Background] 🛑 No active bulk send to cancel');
      sendResponse({ cancelled: false, reason: 'No active operation' });
    }
    return false;
  }

  // Handle friend request status refresh from external web app
  if (msg.type === 'checkFriendRequestStatuses') {
    console.log('[Background] 🔍 External checkFriendRequestStatuses request received');
    handleCheckFriendRequestStatuses(sendResponse);
    return true; // Async response
  }

  // Unknown message type
  console.log('[Background] Unknown external message type:', msg.type);
  sendResponse({ error: 'Unknown message type' });
  return false;
});

/* ===============================
   PERIODIC BACKEND SYNC
   ===============================

   Polls backend /api/poll endpoint every 10 seconds for incremental
   data changes; syncs tags/contacts/templates/campaigns/friendRequests
   to extension storage.
*/
async function handleDataChangeSync(data) {
    try {
        console.log('[Background] Handling data change sync to web app:', Object.keys(data));
        
        // Check if web app is open (match both localhost and 127.0.0.1)
        const tabs = await chrome.tabs.query({ url: CONFIG.WEB_APP_TAB_PATTERNS });
        const webappTabs = tabs.filter(tab => tab.url);
        
        if (webappTabs.length === 0) {
            console.log('[Background] ❌ Web app not open, skipping sync');
            return;
        }
        
        console.log('[Background] ✅ Found', webappTabs.length, 'web app tabs, syncing...');
        
        // Send sync messages to web app tabs
        // IMPORTANT: Tags must be sent BEFORE contacts, because the webapp
        // needs tags in the DB before it can assign them to contacts.
        if (data.tags) {
            await syncDataToWebAppTabs('SYNC_TAGS_FROM_EXTENSION', data.tags, webappTabs);
        }

        // Small delay to ensure tag message is processed before contacts
        if (data.tags && data.contacts) {
            await new Promise(r => setTimeout(r, 200));
        }

        const syncPromises = [];

        if (data.contacts) {
            syncPromises.push(syncDataToWebAppTabs('SYNC_CONTACTS_FROM_EXTENSION', data.contacts, webappTabs));
        }

        if (data.templates) {
            syncPromises.push(syncDataToWebAppTabs('SYNC_TEMPLATES_FROM_EXTENSION', data.templates, webappTabs));
        }

        if (data.friendRequests) {
            syncPromises.push(syncDataToWebAppTabs('SYNC_FRIEND_REQUESTS_FROM_EXTENSION', data.friendRequests, webappTabs));
        }

        await Promise.all(syncPromises);
        console.log('[Background] ✅ Successfully synced all data changes to web app');
        
    } catch (error) {
        console.error('[Background] ❌ Failed to sync data changes to web app:', error);
    }
}

async function syncDataToWebAppTabs(messageType, data, tabs) {
    try {
        console.log(`[Background] 📤 Sending ${messageType} with ${data.length} items to ${tabs.length} tabs`);
        
        const syncPromises = tabs.map(tab => 
            chrome.tabs.sendMessage(tab.id, {
                type: messageType,
                payload: data,
                source: 'crm-extension'
            }).catch(error => {
                console.log(`[Background] ❌ Could not send ${messageType} to tab ${tab.id}:`, error.message);
            })
        );
        
        await Promise.all(syncPromises);
        console.log(`[Background] ✅ Sent ${messageType} to all web app tabs`);
        
    } catch (error) {
        console.error(`[Background] ❌ Error syncing ${messageType}:`, error);
    }
}

/* ===============================
   CLEANUP STALE DATA
   ===============================

   Periodic cleanup of stale friend request data and orphaned
   contacts.
*/
async function handleCreateTag(tagData, sendResponse) {
  console.log('[Background] Creating new tag:', tagData);
  
  try {
    // Get existing data
    const result = await chrome.storage.local.get(['tags']);
    let tags = result.tags || [];
    
    // Create new tag
    const newTag = {
      id: generateId(),
      name: tagData.name,
      color: tagData.color,
      contactCount: 0
    };
    
    // Add to tags array
    tags.push(newTag);
    
    // Save to storage
    await chrome.storage.local.set({ 
      tags: tags,
      lastLocalUpdate: Date.now()
    });
    
    console.log('[Background] Tag created successfully:', newTag.id);
    sendResponse({ 
      success: true, 
      tagId: newTag.id,
      message: 'Tag created successfully'
    });
    
    // Sync with webapp
    const friendRequestsResult = await chrome.storage.local.get(['friendRequests', 'contacts']);
    await handleDataChangeSync({
      tags: tags,
      contacts: friendRequestsResult.contacts || [],
      friendRequests: friendRequestsResult.friendRequests || []
    });
    
  } catch (error) {
    console.error('[Background] Error creating tag:', error);
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

/* ===============================
   CONTACT MANAGEMENT HELPERS
   ===============================

   Handles saveContactsToTags from content scripts — merges new
   contacts into storage, deduplicates by userId/name, preserves
   existing tags.
*/
async function handleSaveContactsToTags(msg, sendResponse) {
  console.log('[Background] Starting save operation for contacts:', msg.contacts.length);
  console.log('[Background] New contacts data:', msg.contacts);
  console.log('[Background] Tag IDs to assign:', msg.tagIds);
  
  try {
    const { contacts: newContacts, tagIds } = msg;
    
    // Get existing data
    const result = await chrome.storage.local.get(['contacts', 'tags']);
    let contacts = result.contacts || [];
    const tags = result.tags || [];
    
    console.log('[Background] Existing contacts count:', contacts.length);
    console.log('[Background] Available tags:', tags.map(t => ({ id: t.id, name: t.name })));

    // Process contacts
    for (const newContact of newContacts) {
      console.log('[Background] Processing contact:', newContact);

      let existing = contacts.find(
        c => (newContact.userId && c.userId === newContact.userId) ||
        (newContact.name && c.name === newContact.name)
      );

      // Additional debugging for contact matching
      if (!existing && newContact.userId) {
        console.log('[Background] No exact match found, checking all contacts with userId:',
          contacts.filter(c => c.userId).map(c => ({ name: c.name, userId: c.userId })));
      }

      if (existing) {
        // Normalize existing tags to plain string IDs (may contain objects from webapp sync)
        if (Array.isArray(existing.tags)) {
          existing.tags = existing.tags.map(t => typeof t === 'object' && t !== null ? t.id : t).filter(Boolean);
        } else {
          existing.tags = [];
        }
        console.log('[Background] Found existing contact:', existing.name, 'with current tags:', existing.tags);

        if (newContact.profilePicture && newContact.profilePicture !== 'null') {
          existing.profilePicture = newContact.profilePicture;
        }
        if (newContact.source === 'facebook_group') {
          existing.source = 'facebook_group';
          existing.groupId = newContact.groupId;
        }
        // Add tags without duplicates
        tagIds.forEach(tagId => {
          if (!existing.tags.includes(tagId)) {
            existing.tags.push(tagId);
            console.log('[Background] Added tag', tagId, 'to existing contact', existing.name);
          } else {
            console.log('[Background] Tag', tagId, 'already exists for contact', existing.name);
          }
        });

        console.log('[Background] Updated existing contact tags:', existing.tags);
      } else {
        const newContactData = {
          id: generateId(),
          name: newContact.name || 'Unknown',
          userId: newContact.userId || null,
          profilePicture: newContact.profilePicture || null,
          source: newContact.source || 'messenger',
          groupId: newContact.groupId || null,
          tags: [...tagIds]
        };

        console.log('[Background] Creating new contact:', newContactData);
        contacts.push(newContactData);
      }
    }

    // Save both contacts and tags to ensure consistency
    await chrome.storage.local.set({
      contacts: contacts,
      tags: tags, // Include tags to ensure they're available
      lastLocalUpdate: Date.now()
    });

    console.log('[Background] Saved to local storage:', {
      contacts: contacts.length,
      newCount: newContacts.length
    });

    // Debug: Show contacts with their tags
    const contactsWithTags = contacts.filter(c => c.tags && c.tags.length > 0);
    console.log('[Background] Contacts with tags after save:', contactsWithTags.map(c => ({
      name: c.name,
      userId: c.userId,
      tags: c.tags
    })));

    // Send success response
    sendResponse({
      success: true,
      message: `Saved ${newContacts.length} contacts successfully`,
      totalContacts: contacts.length
    });

    // Sync directly to backend API (works even if webapp is closed)
    try {
      const tokenResult = await chrome.storage.local.get(['crmFixedJwtToken']);
      const token = tokenResult.crmFixedJwtToken;
      if (token) {
        const headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        };
        // Tags first, wait for completion
        if (tags.length > 0) {
          const tagResp = await fetch(`${CONFIG.API_BASE_URL}/tags/sync`, {
            method: 'POST', headers,
            body: JSON.stringify({ tags }),
          });
          await tagResp.json();
        }
        // Then contacts (tags now exist in backend)
        if (contacts.length > 0) {
          await fetch(`${CONFIG.API_BASE_URL}/contacts/sync`, {
            method: 'POST', headers,
            body: JSON.stringify({ contacts }),
          });
        }
        console.log('[Background] Backend sync completed after saveContactsToTags');
      }
    } catch (err) {
      console.warn('[Background] Backend sync failed:', err.message);
    }

    // Also sync to open webapp tabs for live updates
    const friendRequestsResult = await chrome.storage.local.get(['friendRequests']);
    await handleDataChangeSync({
      contacts: contacts,
      tags: tags,
      friendRequests: friendRequestsResult.friendRequests || []
    });

    // Try to notify popup if it's open
    chrome.runtime.sendMessage({
      type: 'CONTACTS_UPDATED',
      contacts: contacts,
      requiresSync: true
    }).catch(() => {
      console.log('[Background] Popup not open, data saved locally but synced to webapp');
    });

  } catch (error) {
    console.error('[Background] Error in save operation:', error);
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

/* ===============================
   STORAGE CHANGE LISTENER
   ===============================

   Watches chrome.storage.onChanged for tag/contact/template updates
   and pushes changes to webapp tabs in real-time.
*/
function generateId() {
  return 'c' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/* ===============================
   STARTUP / INSTALL HANDLERS
   =============================== */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[Background] Extension started');
  stayAlive();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Extension installed/updated');
  stayAlive();
});

/* ===============================
   COOKIE CHANGE LISTENER
   ===============================

   Monitors Facebook c_user cookie changes to detect account switches
   or logouts; clears cached validation when cookie changes.
*/

/**
 * Monitor Facebook c_user cookie changes to detect account switches
 * Clear validation cache when user logs out or switches accounts
 */
let lastKnownFacebookUserId = null;

// Check Facebook cookie on startup
chrome.storage.local.get(['validatedFacebookAccount'], (result) => {
  if (result.validatedFacebookAccount) {
    lastKnownFacebookUserId = result.validatedFacebookAccount.facebookUserId;
    console.log('[Background] Tracking Facebook account:', lastKnownFacebookUserId);
  }
});

// Listen for cookie changes on Facebook domains
if (chrome.cookies && chrome.cookies.onChanged) {
  chrome.cookies.onChanged.addListener(async (changeInfo) => {
    // Only monitor c_user cookie on Facebook domains
    if (changeInfo.cookie.name === 'c_user' &&
        (changeInfo.cookie.domain.includes('facebook.com') || changeInfo.cookie.domain.includes('.fb.com'))) {

      if (changeInfo.removed) {
        // Cookie was removed (user logged out)
        console.log('[Background] 🔓 Facebook cookie removed - user logged out');
        console.log('[Background] Clearing validation cache...');

        // Clear validation cache
        await chrome.storage.local.remove(['validatedFacebookAccount', 'validationError']);
        lastKnownFacebookUserId = null;

        console.log('[Background] ✅ Validation cache cleared');
      } else if (changeInfo.cookie.value) {
        // Cookie was added or changed
        const newFacebookUserId = changeInfo.cookie.value;

        if (lastKnownFacebookUserId && lastKnownFacebookUserId !== newFacebookUserId) {
          // Account switched
          console.log('[Background] 🔄 Facebook account switched');
          console.log('[Background] Old:', lastKnownFacebookUserId);
          console.log('[Background] New:', newFacebookUserId);
          console.log('[Background] Clearing old validation cache...');

          // Clear old validation cache
          await chrome.storage.local.remove(['validatedFacebookAccount', 'validationError']);

          console.log('[Background] ✅ Old validation cleared - user will need to re-validate');
        }

        // Update tracked user ID
        lastKnownFacebookUserId = newFacebookUserId;
      }
    }
  });

  console.log('[Background] Facebook cookie monitor enabled');
}

/* ===============================
   SPA NAVIGATION DETECTION
   ===============================

   Facebook is a Single Page Application. When a user navigates from
   facebook.com to facebook.com/messages/* via client-side routing,
   Chrome does NOT inject the manifest content_scripts for /messages/*.
   This listener detects that URL change and programmatically injects
   messengerInject.js so the Messenger CRM UI always loads.
*/
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only care about URL changes to facebook.com/messages (www, web, or bare domain)
  if (!changeInfo.url) return;
  if (!/^https?:\/\/(www\.|web\.)?facebook\.com\/messages(\/|$|\?)/.test(changeInfo.url)) return;

  // Check if messengerInject is already loaded in this tab
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => !!window.__CRM_MESSENGER_LOADED,
  }).then(results => {
    if (results?.[0]?.result) return; // already loaded, nothing to do

    // Inject messengerInject.js (dependencies like config, jQuery, validator
    // are already present from the facebook.com/* content scripts)
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['messengerInject.js'],
    }).then(() => {
      console.log('[Background] Injected messengerInject.js via SPA navigation detection');
    }).catch(err => {
      console.error('[Background] Failed to inject messengerInject.js:', err);
    });
  }).catch(() => {
    // Tab may not be accessible (e.g. discarded or devtools)
  });
});

/* ===============================
   STARTUP
   ===============================

   Runs on service worker startup — initializes periodic sync and
   cleanup intervals.
*/
setInterval(stayAlive, 20000);

console.log('[Background] Service worker loaded and ready');