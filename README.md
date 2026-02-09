# Gmail Sender Screener

A Chrome extension that adds **Hey-style sender screening** directly into the Gmail inbox. Screen out unknown senders without opening their emails. Screened-out emails are routed to a "Screenout" label via real Gmail filters, so screening works on **all devices** including mobile.

## Features

- **Inline screening UI** — "New sender" badge appears on inbox rows for unknown senders
- **One-click actions** — Allow or Screen out directly from the inbox list
- **Gmail filters** — Screening creates real Gmail filters so future emails are auto-routed everywhere
- **Undo support** — Snackbar with Undo after screening out a sender
- **Options page** — View and manage all allowed/screened-out senders
- **No email content stored** — Only sender email addresses are stored locally

## How it works

1. The content script scans Gmail inbox rows and extracts sender emails from the DOM
2. Unknown senders get a "New sender" badge with Allow / Screen out buttons
3. **Allow** — Saves the sender locally; the badge disappears
4. **Screen out** —
   - Creates a `Screenout` Gmail label (if it doesn't exist)
   - Creates a Gmail filter: `from:sender@example.com` → skip inbox + apply Screenout label
   - Moves current messages from that sender out of inbox
   - The filter ensures future emails are screened on **all devices**

## Setup

### 1. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **Gmail API**:
   - Navigate to **APIs & Services → Library**
   - Search for "Gmail API" and click **Enable**

### 2. Create OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Chrome extension**
4. Enter your extension ID (see step 3 below for how to get it)
5. Copy the generated **Client ID**

### 3. Configure the extension

1. Open `manifest.json`
2. Replace `YOUR_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID:
   ```json
   "oauth2": {
     "client_id": "123456789-abcdef.apps.googleusercontent.com",
     ...
   }
   ```

### 4. Load the extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** and select this project folder
4. Note the **Extension ID** shown on the card — you'll need this for step 2 above
5. If you haven't set the OAuth client ID yet, update `manifest.json` and click the reload button

### 5. Configure OAuth consent screen

1. In Google Cloud Console, go to **APIs & Services → OAuth consent screen**
2. Choose **External** user type
3. Fill in the required fields (app name, support email, etc.)
4. Add scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.settings.basic`
5. Add your Google account as a test user (under **Test users**)
6. Save

### 6. Start using

1. Open [Gmail](https://mail.google.com)
2. The extension will prompt you to sign in on first use
3. Unknown senders will show a "New sender" badge in your inbox
4. Click **Allow** or **Screen out** to make your decision

## Extension architecture

```
├── manifest.json         # Chrome extension manifest (V3)
├── background.js         # Service worker: OAuth, Gmail API, storage
├── content.js            # Content script: Gmail DOM observation + UI
├── content.css           # Styles for injected inbox UI
├── popup.html/js         # Browser action popup (stats + sign-in)
├── options.html/js/css   # Options page (manage senders)
└── icons/                # Extension icons
```

### Permissions

| Permission | Why |
|---|---|
| `identity` | OAuth sign-in via `chrome.identity.getAuthToken()` |
| `storage` | Store allowed/blocked sender lists via `chrome.storage.sync` |
| `https://mail.google.com/*` | Content script injection into Gmail |
| `https://www.googleapis.com/*` | Gmail API calls for labels, filters, and message modification |

### Gmail API scopes

| Scope | Why |
|---|---|
| `gmail.modify` | Read message metadata, create/manage labels, modify labels on threads |
| `gmail.settings.basic` | Create and delete Gmail filters |

## Privacy

See [PRIVACY.md](PRIVACY.md) for the full privacy notice.

**TL;DR:** The extension only stores sender email addresses locally. It never reads, stores, or transmits email bodies, attachments, or other message content. Gmail API access is used solely to create labels, filters, and move messages between labels.

## Limitations

- Works only on desktop Gmail (Chrome)
- Mobile Gmail does not show the screening UI (but filters work everywhere)
- Gmail's DOM structure may change, which could break sender extraction
- `chrome.storage.sync` has size limits (~100KB total); extremely large sender lists may need migration to `chrome.storage.local`
- OAuth setup requires a Google Cloud project

## License

MIT
