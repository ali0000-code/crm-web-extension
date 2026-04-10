# Extension User Guide

This guide covers every feature of the **Messenger CRM Pro** browser extension. The extension adds CRM capabilities directly to Facebook Messenger and Facebook Groups without leaving the page.

---

## Opening the Extension

Click the **Messenger CRM Pro** icon in Chrome's toolbar (the puzzle piece icon → Messenger CRM Pro if not pinned).

The popup shows your account info at the top and your current sync status. All your tags, contacts, templates, and friend request data is accessible here.

---

## First-Time Authentication

When you open the extension for the first time, you will see an **authentication screen**.

1. Go to your webapp at `http://localhost:8000`
2. Navigate to **Profile** in the sidebar
3. Click **Reveal Auth Key** and enter your password
4. Copy the key
5. Paste it into the extension's auth field
6. Click **Authenticate**

You only need to do this once per device. The extension remembers your session.

---

## The Extension Popup

The popup is organized into sections accessible from the navigation at the top:

| Section | What It Shows |
|---|---|
| Tags | All your tags with their colors |
| Contacts | All your saved contacts |
| Friend Requests | Friend requests you've tracked |
| Templates | Your saved message templates |
| Profile | Your account info and sign out |

---

## Tags

Tags are colored labels you use to organize contacts. You can create as many as you want.

### Creating a Tag

1. Open the extension popup
2. Go to the **Tags** section
3. Click **New Tag**
4. Enter a name (e.g., "Hot Lead", "Follow Up", "VIP")
5. Pick a color from the color picker
6. Click **Save**

The tag appears immediately and syncs to the webapp.

### Deleting a Tag

Click the trash icon next to any tag. Deleting a tag removes it from all contacts that had it assigned but does **not** delete the contacts themselves.

---

## Contacts

The Contacts section shows everyone you have added to the CRM.

### What Gets Saved as a Contact

A contact is saved whenever you tag someone in Messenger or from a Facebook Group. The contact record stores:
- Their name
- Their Facebook profile picture
- Their Facebook user ID
- Which tags they have

### Removing a Contact

Check the box next to one or more contacts, then click **Remove Selected**. This removes them from the CRM but does not affect Facebook in any way.

---

## Tagging Contacts in Messenger

This is the core workflow. Navigate to `facebook.com/messages/` to use these features.

### Selecting Conversations

When you open Facebook Messenger, the extension injects a **checkbox** next to each conversation in the left sidebar.

- Click a checkbox to select that conversation
- Click **Select All** (button at the top of the conversation list) to select every conversation visible in the list

### Assigning Tags

1. Select one or more conversations using the checkboxes
2. Click the **Tag** button that appears at the top of the conversation list
3. A modal opens showing all your tags
4. Click the tags you want to assign
5. Click **Apply**

The selected contacts are saved to the CRM with the chosen tags. They will appear in the Contacts section of the popup.

---

## Using Message Templates in Messenger

Templates let you insert a pre-written message with one click.

### Inserting a Template

1. Open a conversation in Messenger
2. Click the **Template** button in the message composer toolbar (next to the emoji button)
3. A modal appears with your saved templates
4. Click a template to insert its text into the message field
5. Review the message, edit if needed, and press Enter or Send

### Creating Templates

Templates are created in either:
- The extension popup → **Templates** section → **New Template**
- The webapp → **Templates** page

---

## Notes

You can add private notes to any contact to track what you discussed.

### Adding a Note (Messenger)

1. Open a conversation in Messenger
2. Click the **Notes** button in the conversation header
3. A notes panel opens on the right side
4. Click **Add Note**, type your note, and click **Save**

The note is saved and synced to the webapp immediately.

### Viewing Notes

- In the extension popup, notes are accessible from the Notes section of the webapp (the popup links to the webapp for the notes view)
- In Messenger, click **Notes** in any conversation header to see that contact's notes

### Editing and Deleting Notes

In the notes panel:
- Click the **pencil** icon on a note to edit it
- Click the **trash** icon to delete it

---

## Bulk Messaging

Send a message to multiple contacts at once using the Bulk Send feature.

> **Important:** Bulk messaging uses your actual Messenger account. Messages are sent one at a time with a configurable delay to avoid triggering Facebook's spam detection. Use this responsibly and in accordance with Facebook's terms of service.

### Setting Up a Bulk Send

1. Open the extension popup
2. Click **Bulk Send** (or start a campaign from the webapp)
3. Configure the campaign:
   - **Recipients** — Select by tag (everyone with a specific tag) or choose individual contacts
   - **Template** — Pick a message template (or type a custom message)
   - **Delay** — Seconds to wait between each message (minimum recommended: 10 seconds)
   - **Batch Size** — How many messages to send before taking a longer pause
   - **Batch Wait** — Minutes to wait between batches
4. Click **Start Sending**

### Monitoring Progress

While a campaign is running:
- The popup shows a progress bar with sent / total counts
- The webapp's **Campaigns** page shows real-time progress
- Failed sends are tracked and displayed

### Pausing and Resuming

- Click **Pause** in the popup or webapp to pause the campaign
- Click **Resume** to continue from where it left off

### Cancelling

Click **Cancel** to stop the campaign entirely. Progress up to that point is saved.

---

## Facebook Groups: Tagging Group Members

When you visit a Facebook Group and view the member list, the extension adds controls for bulk operations.

### Load All Members

Click **Load All Members** to auto-scroll the members list. Facebook loads members lazily (as you scroll), so this button forces all members to load before you can select them.

### Selecting Members

Checkboxes appear next to each member row. Check individual members or click **Select All**.

### Tagging Members

1. Select the members you want to add to the CRM
2. Click **Tag Selected**
3. Choose tags from the modal
4. Click **Apply**

The members are saved as contacts with the chosen tags.

### Sending Friend Requests from Groups

1. Select group members
2. Click **Send Friend Requests**
3. The extension sends "Add Friend" requests to each selected member with a delay between them
4. Each request is tracked automatically — you can see the status in the **Friend Requests** section

---

## Friend Requests

The Friend Requests section tracks all outgoing friend requests you have sent through the extension.

### What Is Tracked

For each tracked request:
- The person's name and profile picture
- Which group they were found in
- The date the request was sent
- Status: **Pending**, **Accepted**, or **Declined**

### Checking Status

Click **Refresh Status** to check for updates on all pending requests. The extension checks each person's profile to see if they have accepted your request.

### Viewing in the Webapp

The **Friend Requests** page in the webapp shows the same data with additional filtering options.

---

## Facebook Account Linking

The extension automatically links your logged-in Facebook account to your CRM profile. You don't need to do anything manually.

When you open Facebook after authenticating the extension:
1. The extension detects your Facebook user ID
2. Links it to your CRM account
3. A brief toast notification confirms: **"Facebook account linked"**

You can see all linked accounts in the webapp under **Facebook Accounts**.

---

## Export Contacts

You can export your CRM contacts to a file.

### Exporting

1. Open the extension popup
2. Click **Export**
3. Choose format:
   - **CSV** — Opens in Excel, Google Sheets, or any spreadsheet app
   - **TSV** — Tab-separated, useful for import into other tools
4. The file downloads to your browser's Downloads folder

---

## Signing Out

1. Open the extension popup
2. Go to **Profile**
3. Click **Sign Out**

This clears your token and local data from the extension. The extension will return to the authentication screen. Your data on the webapp is not affected.

---

## Sync Status

The popup shows a **last synced** timestamp. This indicates when the extension last successfully synced data with the webapp. If you see an error or very old timestamp, try:

1. Clicking **Sync Now** in the popup
2. Making sure the webapp at `http://localhost:8000` is running
3. Refreshing the Facebook page to reinitialize the content scripts

---

## Tips and Best Practices

- **Tag immediately:** Tag a contact right after a conversation while context is fresh
- **Use descriptive tag names:** Tags like "Interested - April", "Follow Up Week 2", or "Not Interested" are more useful than generic ones
- **Keep templates short:** Messenger has no character limit, but shorter opening messages get better response rates
- **Bulk send delays:** Use at least 10–15 seconds between messages for safety. 30+ seconds is recommended for large lists
- **Notes are private:** Notes are only visible to you in the CRM — they never appear in Facebook
