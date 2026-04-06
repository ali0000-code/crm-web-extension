/**
 * WEB APP SYNC CONTENT SCRIPT
 *
 * Runs on: localhost:8000 (the CRM web application, matched via manifest.json)
 *
 * Acts as a bridge that relays data bidirectionally between the Chrome extension's
 * internal messaging system and the CRM webapp's DOM (React frontend).
 *
 * Direction 1 - Extension to Webapp (chrome.runtime.onMessage):
 *   background.js sends chrome messages to this content script, which re-posts them
 *   into the page via window.postMessage() so the React app can pick them up.
 *
 * Direction 2 - Webapp to Extension (window.addEventListener 'message'):
 *   The React app posts messages with source 'crm-extension-direct', which this
 *   script receives and can forward to the extension background via chrome.runtime.
 *
 * Data types synced:
 *   - Tags (SYNC_TAGS_FROM_EXTENSION)
 *   - Contacts (SYNC_CONTACTS_FROM_EXTENSION)
 *   - Templates (SYNC_TEMPLATES_FROM_EXTENSION)
 *   - Friend requests (SYNC_FRIEND_REQUESTS_FROM_EXTENSION, FRIEND_REQUEST_TRACKED,
 *     FRIEND_REQUEST_STATUS_UPDATED, FRIEND_REQUEST_STATUSES_UPDATED,
 *     FRIEND_REQUEST_REFRESH_UPDATE)
 *   - Bulk send progress (BULK_SEND_STARTED, BULK_SEND_PROGRESS_UPDATE,
 *     BULK_SEND_COMPLETE)
 */

console.log('[WebApp Sync] Content script loaded for CRM web app sync');

// Listen for messages from extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[WebApp Sync] Received message from extension:', message.type);
  
  if (message.source !== 'crm-extension') {
    return false; // Not from our extension
  }
  try {
    switch (message.type) {
      case 'SYNC_TAGS_FROM_EXTENSION':
        handleTagsFromExtension(message.payload);
        sendResponse({ success: true, type: 'tags' });
        break;
        
      case 'SYNC_CONTACTS_FROM_EXTENSION':
        handleContactsFromExtension(message.payload);
        sendResponse({ success: true, type: 'contacts' });
        break;
        
      case 'SYNC_TEMPLATES_FROM_EXTENSION':
        handleTemplatesFromExtension(message.payload);
        sendResponse({ success: true, type: 'templates' });
        break;
        
      case 'SYNC_FRIEND_REQUESTS_FROM_EXTENSION':
        handleFriendRequestsFromExtension(message.payload);
        sendResponse({ success: true, type: 'friendRequests' });
        break;
        
      case 'FRIEND_REQUEST_TRACKED':
        handleFriendRequestTracked(message.payload);
        sendResponse({ success: true, type: 'friendRequestTracked' });
        break;
        
      case 'FRIEND_REQUEST_STATUS_UPDATED':
        handleFriendRequestStatusUpdated(message.payload);
        sendResponse({ success: true, type: 'friendRequestStatusUpdated' });
        break;
        
      case 'FRIEND_REQUEST_STATUSES_UPDATED':
        handleFriendRequestStatusesUpdated(message.payload);
        sendResponse({ success: true, type: 'friendRequestStatusesUpdated' });
        break;

      case 'BULK_SEND_PROGRESS_UPDATE':
        handleBulkSendProgressUpdate(message.payload);
        sendResponse({ success: true, type: 'bulkSendProgressUpdate' });
        break;
        
      case 'BULK_SEND_STARTED':
        handleBulkSendStarted(message.payload);
        sendResponse({ success: true, type: 'bulkSendStarted' });
        break;
        
      case 'BULK_SEND_COMPLETE':
        handleBulkSendComplete(message.payload);
        sendResponse({ success: true, type: 'bulkSendComplete' });
        break;
        
      case 'FRIEND_REQUEST_REFRESH_UPDATE':
        handleFriendRequestRefreshUpdate(message.payload);
        sendResponse({ success: true, type: 'friendRequestRefreshUpdate' });
        break;
        
      default:
        console.log('[WebApp Sync] Unknown message type:', message.type);
        sendResponse({ success: false, error: 'Unknown message type' });
        break;
    }
  } catch (error) {
    console.error('[WebApp Sync] Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
  
  return false; // Sync response
});

function handleTagsFromExtension(tags) {
  console.log('[WebApp Sync] Handling tags from extension:', tags.length);
  
  // Send message to React app via postMessage
  window.postMessage({
    source: 'crm-extension-sync',
    type: 'SYNC_TAGS_FROM_EXTENSION',
    payload: tags
  }, window.location.origin);
}

function handleContactsFromExtension(contacts) {
  console.log('[WebApp Sync] Handling contacts from extension:', contacts.length);
  
  // Send message to React app via postMessage
  window.postMessage({
    source: 'crm-extension-sync',
    type: 'SYNC_CONTACTS_FROM_EXTENSION',
    payload: contacts
  }, window.location.origin);
}

function handleTemplatesFromExtension(templates) {
  console.log('[WebApp Sync] Handling templates from extension:', templates.length);
  
  // Send message to React app via postMessage
  window.postMessage({
    source: 'crm-extension-sync',
    type: 'SYNC_TEMPLATES_FROM_EXTENSION',
    payload: templates
  }, window.location.origin);
}

function handleFriendRequestsFromExtension(friendRequests) {
  console.log('[WebApp Sync] Handling friend requests from extension:', friendRequests.length);
  
  // Send message to React app via postMessage
  window.postMessage({
    source: 'crm-extension-sync',
    type: 'SYNC_FRIEND_REQUESTS_FROM_EXTENSION',
    payload: friendRequests
  }, window.location.origin);
}

function handleFriendRequestTracked(friendRequest) {
  console.log('[WebApp Sync] Handling friend request tracked:', friendRequest.name);
  
  // Send message to React app via postMessage
  window.postMessage({
    source: 'crm-extension-sync',
    type: 'FRIEND_REQUEST_TRACKED',
    payload: friendRequest
  }, window.location.origin);
}

function handleFriendRequestStatusUpdated(data) {
  console.log('[WebApp Sync] Handling friend request status updated:', data);
  
  // Send message to React app via postMessage
  window.postMessage({
    source: 'crm-extension-sync',
    type: 'FRIEND_REQUEST_STATUS_UPDATED',
    payload: data
  }, window.location.origin);
}

function handleFriendRequestStatusesUpdated(data) {
  console.log('[WebApp Sync] Handling friend request statuses updated:', data);

  // Send message to React app via postMessage
  window.postMessage({
    source: 'crm-extension-sync',
    type: 'FRIEND_REQUEST_STATUSES_UPDATED',
    payload: data
  }, window.location.origin);
}

function handleBulkSendProgressUpdate(progress) {
  console.log('[WebApp Sync] 🚨🚨🚨 PROGRESS UPDATE RECEIVED:', progress);
  
  // Send message to React app via postMessage
  window.postMessage({
    source: 'crm-extension-sync',
    type: 'BULK_SEND_PROGRESS_UPDATE',
    payload: progress
  }, window.location.origin);
  
  console.log('[WebApp Sync] ✅ Posted progress update to React app');
}

function handleBulkSendStarted(data) {
  console.log('[WebApp Sync] 🚨🚨🚨 BULK SEND STARTED RECEIVED:', data);
  
  // Send message to React app via postMessage
  window.postMessage({
    source: 'crm-extension-sync',
    type: 'BULK_SEND_STARTED',
    payload: data
  }, window.location.origin);
  
  console.log('[WebApp Sync] ✅ Posted bulk send started to React app');
}

function handleBulkSendComplete(stats) {
  console.log('[WebApp Sync] Handling bulk send complete:', stats);
  
  // Send message to React app via postMessage
  window.postMessage({
    source: 'crm-extension-sync',
    type: 'BULK_SEND_COMPLETE',
    payload: stats
  }, window.location.origin);
}

function handleFriendRequestRefreshUpdate(refreshState) {
  console.log('[WebApp Sync] 🚨🚨🚨 FRIEND REQUEST REFRESH UPDATE RECEIVED:', refreshState);
  
  // Send message to React app via postMessage
  window.postMessage({
    source: 'crm-extension-sync',
    type: 'FRIEND_REQUEST_REFRESH_UPDATE',
    payload: refreshState
  }, window.location.origin);
  
  console.log('[WebApp Sync] ✅ Posted friend request refresh update to React app');
}

// Also listen for window messages (alternative communication method)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;

  if (event.data?.source === 'crm-extension-direct') {
    // Handle direct extension messages
    const { type, payload } = event.data;
    
    switch (type) {
      case 'SYNC_TAGS_FROM_EXTENSION':
        handleTagsFromExtension(payload);
        break;
      case 'SYNC_CONTACTS_FROM_EXTENSION':
        handleContactsFromExtension(payload);
        break;
      case 'SYNC_TEMPLATES_FROM_EXTENSION':
        handleTemplatesFromExtension(payload);
        break;
      case 'SYNC_FRIEND_REQUESTS_FROM_EXTENSION':
        handleFriendRequestsFromExtension(payload);
        break;
      case 'FRIEND_REQUEST_TRACKED':
        handleFriendRequestTracked(payload);
        break;
      case 'FRIEND_REQUEST_STATUS_UPDATED':
        handleFriendRequestStatusUpdated(payload);
        break;
      case 'FRIEND_REQUEST_STATUSES_UPDATED':
        handleFriendRequestStatusesUpdated(payload);
        break;
      case 'BULK_SEND_PROGRESS_UPDATE':
        handleBulkSendProgressUpdate(payload);
        break;
      case 'BULK_SEND_STARTED':
        handleBulkSendStarted(payload);
        break;
      case 'BULK_SEND_COMPLETE':
        handleBulkSendComplete(payload);
        break;
      case 'FRIEND_REQUEST_REFRESH_UPDATE':
        handleFriendRequestRefreshUpdate(payload);
        break;
    }
  }
});

console.log('[WebApp Sync] Content script ready for bidirectional sync');