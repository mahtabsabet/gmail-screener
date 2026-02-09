# Privacy Notice — Gmail Sender Screener

## What this extension does

Gmail Sender Screener helps you screen unknown email senders directly from your Gmail inbox. It creates Gmail labels and filters to automatically route screened-out senders' emails to a dedicated folder.

## What data is accessed

- **Sender email addresses** — Extracted from the Gmail inbox DOM (the `email` attribute on sender name elements) to identify unknown senders.
- **Gmail labels** — The extension creates and manages a "Screenout" label in your Gmail account.
- **Gmail filters** — The extension creates filters to automatically route future emails from screened-out senders.
- **Message metadata** — The extension lists messages by sender (using Gmail search) to move existing messages when screening out a sender. Only message IDs are used; message content is never read.

## What data is stored

All data is stored **locally in your browser** using Chrome's storage APIs:

- `allowedEmails` — List of sender email addresses you have allowed (stored in `chrome.storage.sync`)
- `blockedEmails` — List of sender email addresses you have screened out (stored in `chrome.storage.sync`)
- `filterMap` — Mapping of screened-out senders to their Gmail filter IDs (stored in `chrome.storage.local`, used for undo functionality)
- `screenoutLabelId` — The Gmail label ID for the Screenout label (stored in `chrome.storage.local`)

## What is NOT stored or accessed

- Email bodies or message content
- Email attachments
- Contact lists or address books
- Passwords or credentials (OAuth tokens are managed by Chrome's identity API)
- Browsing history outside of Gmail

## What is NOT transmitted

- No data is sent to any third-party server
- No analytics or telemetry is collected
- The only network requests are to Google's Gmail API (`googleapis.com`), authenticated with your own Google account

## Gmail API scopes

| Scope | Purpose |
|---|---|
| `gmail.modify` | Create labels, list messages by sender, modify labels on messages (move to/from Screenout) |
| `gmail.settings.basic` | Create and delete Gmail filters for screened-out senders |

These are the minimum scopes required for the extension's functionality. The extension does not request full mail read access.

## Data retention

- Sender lists persist in Chrome's storage until you remove them via the options page or clear extension data
- Gmail filters persist in your Gmail account until you or the extension removes them
- Uninstalling the extension removes all locally stored data but does **not** remove Gmail filters or labels already created

## Your control

- You can view and remove any allowed or screened-out sender from the extension's options page
- You can clear all extension data from the options page
- You can remove Gmail filters directly from Gmail Settings → Filters and Blocked Addresses
- You can revoke the extension's access from your [Google Account permissions](https://myaccount.google.com/permissions)
