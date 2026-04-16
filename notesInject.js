/**
 * MESSENGER NOTES FEATURE - CONTENT SCRIPT
 *
 * Injects a "Notes" button into Messenger conversation headers and provides
 * a modal interface for managing per-contact notes (create, read, update, delete).
 *
 * Runs on: facebook.com/messages (matched via manifest.json)
 *
 * How it works:
 *   - messengerInject.js detects the active conversation and calls
 *     window.openNotesModal(userId, userName, profilePicture) exposed by this script.
 *   - The modal shows existing notes for the contact and lets the user add, edit,
 *     or delete notes. Each note is stored per-contact in the CRM backend.
 *
 * Communication:
 *   - All API calls are proxied through background.js via chrome.runtime.sendMessage()
 *     because content scripts running on HTTPS facebook.com cannot
 *     directly fetch the HTTP localhost CRM backend (mixed content / CSP restrictions).
 *   - Message types: NOTES_LOAD, NOTES_ADD, NOTES_UPDATE, NOTES_DELETE,
 *     NOTES_GET_ALL_CONTACTS.
 *   - Includes automatic retry logic to handle service worker wake-up latency.
 *
 * Also listens for chrome.runtime.onMessage from the extension popup:
 *   - OPEN_NOTES_MODAL: opens the notes modal for a given contact
 *   - GET_CONTACTS_WITH_NOTES: returns all contacts that have notes (for popup list)
 */

console.log('[Notes] Notes content script loaded');

/* ===============================
   GLOBAL STATE
   Tracks the currently open contact (userId, name, profilePicture),
   the modal DOM reference, and the note ID being edited (if any).
   =============================== */
let currentContactUserId = null;
let currentContactName = null;
let currentContactProfilePicture = null;
let notesModal = null;
let editingNoteId = null;

/* ===============================
   BACKGROUND SERVICE WORKER COMMUNICATION
   Content scripts on HTTPS pages (facebook.com) cannot fetch HTTP localhost due
   to mixed content / CSP restrictions. All note CRUD API calls are routed through
   background.js, which runs in the extension's own context with full host_permissions.
   Includes timeout + automatic retry to handle service worker wake-up latency.
   =============================== */

/**
 * Send a single message attempt to background.js with timeout.
 */
function _sendOnce(type, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response?.error || 'Unknown error'));
        }
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

/**
 * Send a message to background.js with automatic retry.
 * First attempt uses a shorter timeout; if the service worker was asleep
 * the wake-up may cause the first call to be lost — the retry handles that.
 */
async function sendToBackground(type, payload = {}) {
  try {
    return await _sendOnce(type, payload, 8000);
  } catch (firstErr) {
    console.log(`[Notes] First attempt for ${type} failed (${firstErr.message}), retrying...`);
    return await _sendOnce(type, payload, 15000);
  }
}

/**
 * Load notes for a specific contact
 */
async function loadNotesForContact(contactUserId) {
  try {
    console.log('[Notes] Loading notes for contact:', contactUserId);
    const notes = await sendToBackground('NOTES_LOAD', { contactUserId });
    console.log(`[Notes] Loaded ${notes?.length || 0} notes`);
    return notes || [];
  } catch (error) {
    console.error('[Notes] Error loading notes:', error);
    return [];
  }
}

/**
 * Add a new note
 */
async function addNote(contactUserId, contactName, noteText, profilePicture = null) {
  console.log('[Notes] Adding note for:', contactName);
  const note = await sendToBackground('NOTES_ADD', { contactUserId, contactName, noteText, profilePicture });
  console.log('[Notes] Note added successfully');
  return note;
}

/**
 * Update an existing note
 */
async function updateNote(contactUserId, noteId, noteText) {
  console.log('[Notes] Updating note:', noteId);
  await sendToBackground('NOTES_UPDATE', { contactUserId, noteId, noteText });
  console.log('[Notes] Note updated successfully');
}

/**
 * Delete a note
 */
async function deleteNote(contactUserId, noteId) {
  console.log('[Notes] Deleting note:', noteId);
  await sendToBackground('NOTES_DELETE', { contactUserId, noteId });
  console.log('[Notes] Note deleted successfully');
}

/**
 * Get all contacts that have notes
 */
async function getAllContactsWithNotes() {
  try {
    console.log('[Notes] Getting all contacts with notes');
    const contacts = await sendToBackground('NOTES_GET_ALL_CONTACTS');
    console.log(`[Notes] Found ${contacts?.length || 0} contacts with notes`);
    return contacts || [];
  } catch (error) {
    console.error('[Notes] Error getting contacts with notes:', error);
    return [];
  }
}

/* ===============================
   NOTES MODAL UI
   Creates, opens, and manages the notes modal overlay. The modal contains a
   textarea for new/edited notes, a list of existing notes with edit/delete buttons,
   and loading/empty states.
   =============================== */

function createNotesModal() {
  const modal = document.createElement('div');
  modal.id = 'crm-notes-modal';
  modal.innerHTML = `
    <style>
      #crm-notes-modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999999;
      }

      #crm-notes-modal.active {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .notes-modal-content {
        background: #fff;
        border-radius: 10px;
        width: 440px;
        max-width: 92%;
        max-height: 75vh;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .notes-modal-header {
        padding: 14px 16px;
        border-bottom: 1px solid #e4e6eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #fff;
      }

      .notes-modal-title {
        font-size: 15px;
        font-weight: 600;
        margin: 0;
        color: #1c1e21;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .notes-modal-close {
        background: none;
        border: none;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #65676b;
        font-size: 18px;
        flex-shrink: 0;
      }

      .notes-modal-close:hover {
        background: #f2f2f2;
        color: #1c1e21;
      }

      .notes-modal-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
      }

      .notes-input-container {
        margin-bottom: 16px;
      }

      .notes-textarea {
        width: 100%;
        min-height: 72px;
        padding: 10px 12px;
        border: 1px solid #ccd0d5;
        border-radius: 6px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        resize: vertical;
        transition: border-color 0.15s;
        box-sizing: border-box;
        color: #1c1e21;
      }

      .notes-textarea::placeholder {
        color: #8a8d91;
      }

      .notes-textarea:focus {
        outline: none;
        border-color: #1877f2;
      }

      .notes-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }

      .notes-btn {
        padding: 6px 14px;
        border: none;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
        font-size: 13px;
        line-height: 1.4;
      }

      .notes-btn-primary {
        background: #1877f2;
        color: #fff;
      }

      .notes-btn-primary:hover {
        background: #166fe5;
      }

      .notes-btn-primary:disabled {
        background: #bcc0c4;
        cursor: not-allowed;
      }

      .notes-btn-secondary {
        background: #e4e6eb;
        color: #1c1e21;
      }

      .notes-btn-secondary:hover {
        background: #d8dadf;
      }

      .notes-divider {
        height: 1px;
        background: #e4e6eb;
        margin: 0 0 12px 0;
      }

      .note-item {
        padding: 10px 12px;
        margin-bottom: 8px;
        border-radius: 6px;
        background: #f0f2f5;
      }

      .note-item:last-child {
        margin-bottom: 0;
      }

      .note-text {
        margin: 0;
        color: #1c1e21;
        font-size: 13px;
        line-height: 1.45;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .note-meta {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        margin-top: 6px;
      }

      .note-actions {
        display: flex;
        gap: 2px;
      }

      .note-action-btn {
        background: none;
        border: none;
        padding: 2px 8px;
        cursor: pointer;
        color: #8a8d91;
        font-size: 12px;
        border-radius: 4px;
      }

      .note-action-btn:hover {
        color: #1c1e21;
        background: rgba(0, 0, 0, 0.04);
      }

      .note-action-btn.delete:hover {
        color: #e4334b;
      }

      .empty-state {
        text-align: center;
        padding: 28px 16px;
        color: #8a8d91;
        font-size: 13px;
      }

      .empty-state p {
        margin: 0;
      }

      .notes-spinner {
        display: inline-block;
        width: 18px;
        height: 18px;
        border: 2px solid #e4e6eb;
        border-top-color: #1877f2;
        border-radius: 50%;
        animation: notesSpin 0.6s linear infinite;
      }

      @keyframes notesSpin {
        to { transform: rotate(360deg); }
      }
    </style>

    <div class="notes-modal-content">
      <div class="notes-modal-header">
        <span class="notes-modal-title" id="notes-contact-name">Notes</span>
        <button class="notes-modal-close" id="notes-close-btn">&times;</button>
      </div>

      <div class="notes-modal-body">
        <div class="notes-input-container">
          <textarea
            class="notes-textarea"
            id="notes-textarea"
            placeholder="Write a note..."
          ></textarea>
          <div class="notes-actions">
            <button class="notes-btn notes-btn-primary" id="notes-save-btn">
              <span id="notes-save-text">Save</span>
            </button>
            <button class="notes-btn notes-btn-secondary" id="notes-cancel-btn" style="display: none;">
              Cancel
            </button>
          </div>
        </div>

        <div class="notes-divider"></div>

        <div id="notes-list-container">
          <div class="empty-state">
            <p>No notes yet</p>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  modal.querySelector('#notes-close-btn').addEventListener('click', closeNotesModal);
  modal.querySelector('#notes-save-btn').addEventListener('click', handleSaveNote);
  modal.querySelector('#notes-cancel-btn').addEventListener('click', cancelEditNote);

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeNotesModal();
    }
  });

  return modal;
}

async function openNotesModal(contactUserId, contactName, profilePicture = null) {
  console.log('[Notes] Opening notes modal for:', contactName, contactUserId);

  currentContactUserId = contactUserId;
  currentContactName = contactName;
  currentContactProfilePicture = profilePicture;
  editingNoteId = null;

  if (!notesModal) {
    notesModal = createNotesModal();
  }

  // Update modal title
  document.getElementById('notes-contact-name').textContent = contactName;

  // Clear textarea
  document.getElementById('notes-textarea').value = '';
  document.getElementById('notes-save-text').textContent = 'Save';
  document.getElementById('notes-cancel-btn').style.display = 'none';

  // Show modal
  notesModal.classList.add('active');

  // Load notes
  await loadAndDisplayNotes(contactUserId);
}

function closeNotesModal() {
  if (notesModal) {
    notesModal.classList.remove('active');
    currentContactUserId = null;
    currentContactName = null;
    currentContactProfilePicture = null;
    editingNoteId = null;
  }
}

async function loadAndDisplayNotes(contactUserId) {
  const container = document.getElementById('notes-list-container');
  container.innerHTML = '<div style="text-align: center; padding: 20px;"><div class="notes-spinner"></div></div>';

  try {
    const notes = await loadNotesForContact(contactUserId);

    if (notes.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No notes yet</p>
        </div>
      `;
      return;
    }

    container.innerHTML = notes.map(note => `
      <div class="note-item" data-note-id="${escapeHtml(note.id)}">
        <p class="note-text">${escapeHtml(note.text)}</p>
        <div class="note-meta">
          <div class="note-actions">
            <button class="note-action-btn edit" data-note-id="${escapeHtml(note.id)}">Edit</button>
            <button class="note-action-btn delete" data-note-id="${escapeHtml(note.id)}">Delete</button>
          </div>
        </div>
      </div>
    `).join('');

    // Add event listeners to edit/delete buttons
    container.querySelectorAll('.note-action-btn.edit').forEach(btn => {
      btn.addEventListener('click', () => handleEditNote(btn.dataset.noteId, notes));
    });

    container.querySelectorAll('.note-action-btn.delete').forEach(btn => {
      btn.addEventListener('click', () => handleDeleteNote(btn.dataset.noteId));
    });

  } catch (error) {
    console.error('[Notes] Error displaying notes:', error);
    container.innerHTML = `
      <div class="empty-state">
        <p>Error loading notes. Please try again.</p>
      </div>
    `;
  }
}

async function handleSaveNote() {
  const textarea = document.getElementById('notes-textarea');
  const noteText = textarea.value.trim();

  if (!noteText) {
    alert('Please enter a note');
    return;
  }

  const saveBtn = document.getElementById('notes-save-btn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<div class="notes-spinner"></div>';

  try {
    const wasEditing = !!editingNoteId;

    if (editingNoteId) {
      // Update existing note
      await updateNote(currentContactUserId, editingNoteId, noteText);
      editingNoteId = null;
    } else {
      // Add new note
      await addNote(currentContactUserId, currentContactName, noteText, currentContactProfilePicture);
    }

    // Clear textarea and reset edit state
    textarea.value = '';
    editingNoteId = null;

    // Hide cancel button if was editing
    if (wasEditing) {
      document.getElementById('notes-cancel-btn').style.display = 'none';
    }

    // Reload notes
    await loadAndDisplayNotes(currentContactUserId);

  } catch (error) {
    alert('Error saving note: ' + error.message);
  } finally {
    saveBtn.disabled = false;
    // Restore button content
    saveBtn.innerHTML = '<span id="notes-save-text">Save</span>';
  }
}

function handleEditNote(noteId, notes) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;

  // Populate textarea
  document.getElementById('notes-textarea').value = note.text;
  document.getElementById('notes-save-text').textContent = 'Update';
  document.getElementById('notes-cancel-btn').style.display = 'inline-block';

  editingNoteId = noteId;

  // Scroll to top
  document.getElementById('notes-textarea').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('notes-textarea').focus();
}

function cancelEditNote() {
  document.getElementById('notes-textarea').value = '';
  document.getElementById('notes-save-text').textContent = 'Save';
  document.getElementById('notes-cancel-btn').style.display = 'none';
  editingNoteId = null;
}

async function handleDeleteNote(noteId) {
  if (!confirm('Are you sure you want to delete this note?')) {
    return;
  }

  try {
    await deleteNote(currentContactUserId, noteId);
    await loadAndDisplayNotes(currentContactUserId);
  } catch (error) {
    alert('Error deleting note: ' + error.message);
  }
}

/* ===============================
   UTILITY FUNCTIONS
   Shared helpers (HTML escaping) used across the notes UI.
   =============================== */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ===============================
   MESSAGE LISTENERS
   Handles chrome.runtime.onMessage from the extension popup: opening the notes
   modal for a specific contact, and returning all contacts that have notes.
   Exposes openNotesModal and getAllContactsWithNotes on the window object
   so messengerInject.js can call them directly.
   =============================== */

// Listen for messages from popup to open notes modal
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Notes] Content script received message:', message.type);

  if (message.type === 'OPEN_NOTES_MODAL') {
    openNotesModal(message.userId, message.userName, message.profilePicture || null);
    sendResponse({ success: true });
  } else if (message.type === 'GET_CONTACTS_WITH_NOTES') {
    console.log('[Notes] Handling GET_CONTACTS_WITH_NOTES request');
    // Get all contacts with notes
    getAllContactsWithNotes().then(contacts => {
      console.log('[Notes] Sending response to popup with contacts:', contacts);
      sendResponse({ success: true, contacts });
    }).catch(error => {
      console.error('[Notes] Error getting contacts with notes:', error);
      sendResponse({ success: false, error: error.message, contacts: [] });
    });
    return true; // Async response
  }
  return true;
});

// Export function for external use
window.openNotesModal = openNotesModal;
window.getAllContactsWithNotes = getAllContactsWithNotes;

console.log('[Notes] Notes feature ready (using direct API calls)');
