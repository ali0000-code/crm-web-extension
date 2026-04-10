# Webapp User Guide

The **Messenger CRM Pro** web dashboard is your central hub for managing all CRM data. It runs at `http://localhost:8000` and provides a full management interface that stays in sync with the extension in real time.

---

## Navigating the Dashboard

The sidebar on the left contains links to every section. Click any item to switch views without a page reload.

| Section | Purpose |
|---|---|
| Dashboard | Summary stats overview |
| Contacts | View and manage all contacts |
| Notes | Browse and search contact notes |
| Tags | Create and manage tags |
| Templates | Create and manage message templates |
| Campaigns | Create and run bulk message campaigns |
| Friend Requests | Track outgoing friend request statuses |
| Facebook Accounts | View linked Facebook accounts |
| Devices | Manage authenticated extension devices |
| Profile | Account settings, password, auth key |

The top bar shows your name, current sync status with the extension, and a theme toggle (light/dark/system).

---

## Dashboard (Overview)

The main dashboard displays a summary of your CRM at a glance:

- **Total Contacts** — Number of saved contacts
- **Total Tags** — Number of custom tags
- **Active Campaigns** — Campaigns currently running
- **Friend Requests** — Pending vs. accepted counts
- **Recent Activity** — Latest additions and changes

Use this as your daily starting point to get a quick read on your pipeline.

---

## Contacts

The Contacts page is a searchable, filterable table of every contact in your CRM.

### Searching Contacts

Type in the search bar at the top of the Contacts page to filter by name or Facebook user ID in real time.

### Filtering by Tag

Click a tag chip in the filter bar to show only contacts with that tag. You can filter by multiple tags.

### Bulk Operations

Select contacts using the checkboxes on the left of each row.

**Bulk Tag:** Select contacts → click **Tag Selected** → choose tags to add → click **Apply**

**Bulk Delete:** Select contacts → click **Delete Selected** → confirm deletion

> Note: Deleting a contact removes it from the CRM only. It has no effect on Facebook.

### Adding/Removing Tags from a Single Contact

Click on a contact row to expand it (or open its detail view). From there you can:
- Click a tag chip to remove that tag
- Click **Add Tag** to assign additional tags

---

## Notes

The Notes page shows every contact you have written notes for.

### Browsing Notes

Contacts with notes are listed sorted by the most recently noted. Each row shows:
- Contact name and profile picture
- Number of notes
- Date of the last note

Click on a contact to expand their notes.

### Reading and Editing Notes

When a contact is expanded, all their notes appear in chronological order with timestamps.

- Click the **pencil icon** to edit a note inline
- Click the **trash icon** to delete a note
- Click **Add Note** to write a new note for that contact

Changes are saved immediately and synced to the extension.

### Notes from Messenger

Notes you add inside Messenger via the extension's Notes button appear here automatically. Notes added here appear in the extension. Everything stays in sync.

---

## Tags

Tags are the primary way to organize your contacts.

### Creating a Tag

1. Go to **Tags** in the sidebar
2. Click **New Tag**
3. Enter a name
4. Pick a color using the color picker
5. Click **Save**

### Deleting Tags

Click the **trash icon** next to any tag to delete it. Deleting a tag removes it from all contacts, but the contacts themselves remain in the CRM.

**Bulk Delete:** Check multiple tags and click **Delete Selected**.

### Tag Colors

Tags display their color as a colored dot or badge throughout the dashboard and extension. Choosing distinct colors for each tag category makes the dashboard easier to scan at a glance.

---

## Templates

Message templates are reusable messages you can insert into Messenger with one click.

### Creating a Template

1. Go to **Templates** in the sidebar
2. Click **New Template**
3. Enter a **Name** (shown in the template picker — make it descriptive)
4. Write the **Message Body** in the text area
5. Click **Save**

Templates sync to the extension automatically and become available in Messenger's template picker.

### Template Variables

You can use `{name}` as a placeholder in your template body. When you insert the template in Messenger, the extension will attempt to substitute the contact's name automatically.

Example:
```
Hi {name}, I wanted to reach out about an opportunity I thought you'd find interesting...
```

### Deleting Templates

Click the **trash icon** next to a template. **Bulk Delete** is also available.

---

## Campaigns

Campaigns let you send a message to a large number of contacts with controlled pacing. Campaign execution happens inside the extension, but you configure and monitor it here.

### Creating a Campaign

1. Go to **Campaigns** → click **New Campaign**
2. Fill in the details:
   - **Name** — A label for this campaign (e.g., "April Outreach — Tech Group")
   - **Message** — The message to send (or link it to a Template)
   - **Delay** — Seconds between each message (10 seconds minimum recommended)
   - **Recipients** — Choose one of:
     - Specific contacts (search and select)
     - All contacts with a certain tag
3. Click **Save Campaign**

The campaign is saved with status **Pending**.

### Starting a Campaign

From the Campaigns list, click **Start** on a pending campaign. The extension will begin sending messages.

> The webapp must be open in your browser and the extension must be running for campaigns to execute. The extension carries out the actual sending.

### Monitoring Progress

While a campaign is running, the Campaigns page shows:
- A **progress bar** with sent / total
- **Success count** — messages successfully sent
- **Failure count** — messages that failed to send
- **Current position** — which recipient is being processed now

### Pausing and Resuming

- Click **Pause** to pause a running campaign. It saves its place.
- Click **Resume** to pick up from where it stopped.

### Campaign Status Values

| Status | Meaning |
|---|---|
| Pending | Created but not yet started |
| Started | Currently running |
| Paused | Manually paused |
| Resumed | Restarted after pause |
| Completed | All messages processed |

### Viewing Errors

If any messages fail, click on the campaign to see the list of failures with the reason for each.

### Deleting Campaigns

Completed campaigns can be deleted individually or in bulk to keep the list clean.

---

## Friend Requests

The Friend Requests page shows all outgoing Facebook friend requests you have tracked using the extension from Facebook Groups.

### What You'll See

Each row shows:
- The person's name and profile picture
- Which Facebook Group they were found in
- **Status** — Pending, Accepted, or Declined
- **Sent Date** — When the request was sent
- **Last Checked** — When the extension last polled for an update
- **Responded Date** — When they accepted (if applicable)

### Status Badge Colors

| Badge | Meaning |
|---|---|
| Gray — Pending | Request has been sent, awaiting response |
| Green — Accepted | They have accepted your friend request |
| Red — Declined | Request was declined or removed |

### Refreshing Status

Click **Refresh All** to trigger the extension to check current statuses for all pending requests. This runs in the background — the page updates automatically as results come in.

### Filtering

Use the status filter buttons (All / Pending / Accepted / Declined) to focus on specific groups.

---

## Facebook Accounts

This page shows all Facebook accounts linked to your CRM profile.

### What Gets Listed

When the extension detects a logged-in Facebook account, it automatically links it here. Each entry shows:
- Facebook account name
- Profile picture
- Facebook user ID
- Last used date

### Unlinking an Account

Click **Unlink** next to an account to remove it from the CRM. This does not affect your actual Facebook account.

---

## Devices

The Devices page shows every browser/device that has authenticated with the extension.

### What Gets Listed

Each device shows:
- Browser (e.g., Chrome 124)
- Operating system (e.g., macOS 14)
- IP address at time of registration
- Last active timestamp
- Active / Revoked status

### Device Limit

Each account is limited to **4 active devices**. If you reach the limit and need to add a new device, revoke an old one first.

### Revoking a Device

Click **Revoke** next to a device to deactivate it. The extension on that device will no longer be able to make API calls. The user will need to re-authenticate using the Auth Key.

**Bulk Revoke:** Check multiple devices and click **Revoke Selected**.

---

## Profile Settings

Access your profile by clicking **Profile** in the sidebar.

### Updating Your Name or Email

Edit the Name or Email fields and click **Save Changes**.

### Changing Your Password

1. Scroll to the **Change Password** section
2. Enter your **current password**
3. Enter a **new password** (must meet strength requirements)
4. Confirm the new password
5. Click **Change Password**

Password requirements: minimum 8 characters, at least one uppercase letter, one lowercase letter, and one number.

### Auth Key

The Auth Key is the 48-character secret used to authenticate the extension.

**Reveal Auth Key:**
1. Click **Reveal Auth Key**
2. Enter your password to confirm
3. The key is shown — copy it and paste it into the extension on any new device

**Regenerate Auth Key:**  
Click **Regenerate** to invalidate the current key and generate a new one. Use this if you believe your key has been compromised. Existing authenticated devices continue to work, but you must use the new key for any future extension logins.

---

## Real-Time Sync

The webapp stays in sync with the extension automatically:

- When you add tags or contacts in Messenger → they appear in the webapp instantly
- When you create templates or tags in the webapp → they appear in the extension popup immediately
- When a bulk send campaign runs → the progress bar in the webapp updates live
- When friend request statuses change → the Friend Requests page updates without needing a refresh

If the real-time updates seem delayed, check that the Reverb WebSocket server is running (`php artisan reverb:start`). A fallback polling mechanism will keep data roughly in sync even if the WebSocket is down, but with a 30-second delay.

---

## Theme

Click the theme toggle in the top-right corner of the dashboard to switch between:

- **Light mode** — White background
- **Dark mode** — Dark background
- **System** — Follows your operating system's setting

Your preference is saved in your browser and persists across sessions.

---

## Logging Out

Click your name in the top bar and select **Logout**, or navigate to `/logout`. Your session ends and you are redirected to the login page. Your CRM data is not affected.
