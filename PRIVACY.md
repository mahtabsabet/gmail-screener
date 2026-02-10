# Privacy Notice — Gmail Sender Screener

## What this extension does

Gmail Sender Screener lets you screen out email senders directly from your Gmail inbox by creating Gmail filters. Screened-out senders' emails skip your inbox and go to a "Screenout" label. You can reverse this from the Screenout folder.

## What data is accessed

- **Sender email addresses** — extracted from the Gmail inbox DOM to show screening buttons.
- **Gmail labels** — the extension creates and reads a "Screenout" label.
- **Gmail filters** — the extension creates, reads, and deletes filters (one per screened-out sender).
- **Message IDs** — the extension lists messages by sender to move them between inbox and Screenout. Only IDs are used; message content is never read.

## What is stored

Locally (in the browser):
- **Screenout label ID** — cached in `chrome.storage.local` to avoid re-fetching it on every action. This is the only locally stored data.

In your Gmail account:
- **Gmail filters** — one filter per screened-out sender. These are the source of truth for all screening decisions.
- **Screenout label** — a standard Gmail label.

## What is NOT stored or accessed

- Email bodies or message content
- Email attachments
- Contact lists
- Browsing history
- Passwords or credentials (OAuth tokens are managed by Chrome)

## What is NOT transmitted

- No data is sent to any third-party server
- No analytics or telemetry
- The only network requests go to Google's Gmail API (`googleapis.com`), authenticated with your own Google account

## Gmail API scopes

| Scope | Purpose |
|---|---|
| `gmail.modify` | Create labels, list messages by sender, move messages between labels |
| `gmail.settings.basic` | Create and delete Gmail filters |

## Your control

- Remove any screened-out sender from the extension's options page (deletes their Gmail filter)
- Use the "Screen in" button in the Screenout folder to reverse a decision
- Remove filters directly in Gmail Settings → Filters and Blocked Addresses
- Revoke extension access from [Google Account permissions](https://myaccount.google.com/permissions)
- Uninstalling the extension removes the cached label ID but does **not** remove Gmail filters or labels already created
