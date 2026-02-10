# Gmail Sender Screener

A Chrome extension that adds **Hey-style sender screening** directly into Gmail. Hover over any inbox row to **screen out** a sender. Hover over any row in the Screenout folder to **screen them back in**.

All decisions are stored as **Gmail filters** — no local database, and screening works on **all devices** including mobile.

## How it works

1. **In your inbox**: hover over any email row to reveal a **"Screen out"** button
2. Clicking it:
   - Creates a Gmail filter for that sender (skip inbox + apply Screenout label)
   - Moves their existing inbox messages to Screenout
   - The filter ensures future emails are screened on **all devices**
3. **In the Screenout folder** (`#label/Screenout`): hover to reveal a **"Screen in"** button
4. Clicking it:
   - Deletes the Gmail filter
   - Moves their messages back to inbox
5. **Undo** snackbar appears after screening out, in case you misclick

## Data model

There is no local sender database. Gmail filters **are** the data:

| Action | What happens |
|---|---|
| Screen out | Gmail filter created (`from:sender` → skip inbox + Screenout label) |
| Screen in | Gmail filter deleted, messages moved back to inbox |

The options page reads directly from Gmail's filter list.

## Setup

### 1. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Gmail API** (APIs & Services → Library)

### 2. Create OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Chrome extension**
4. Enter your extension ID (see step 4)
5. Copy the **Client ID**

### 3. Configure the extension

Replace the placeholder in `manifest.json`:
```json
"oauth2": {
  "client_id": "YOUR_ACTUAL_CLIENT_ID.apps.googleusercontent.com",
  ...
}
```

### 4. Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**, select this folder
4. Note the **Extension ID** — use it in step 2 if you haven't already

### 5. OAuth consent screen

1. Google Cloud Console → **APIs & Services → OAuth consent screen**
2. Choose **External**, fill required fields
3. Add scopes: `gmail.modify`, `gmail.settings.basic`
4. Add your account as a test user

### 6. Use it

1. Open [Gmail](https://mail.google.com)
2. Sign in when prompted by the extension
3. Hover over inbox rows → **Screen out**
4. Visit Screenout folder → hover → **Screen in**

## Architecture

```
├── manifest.json       # MV3 manifest with OAuth2
├── background.js       # Service worker: Gmail API (filters, labels, messages)
├── content.js          # Content script: DOM observation, button injection
├── content.css         # Hover-to-reveal button styles, toast
├── popup.html/js       # Toolbar popup (count + sign-in)
├── options.html/js/css # Options page (list/remove screened-out senders)
└── icons/              # Extension icons
```

### Permissions

| Permission | Why |
|---|---|
| `identity` | OAuth via `chrome.identity.getAuthToken()` |
| `storage` | Cache Screenout label ID locally |
| `mail.google.com` | Content script injection |
| `googleapis.com` | Gmail API calls |

### Gmail API scopes

| Scope | Why |
|---|---|
| `gmail.modify` | Create labels, modify message labels |
| `gmail.settings.basic` | Create/delete Gmail filters |

## Privacy

See [PRIVACY.md](PRIVACY.md). TL;DR: no email content is read or stored. The only data is Gmail filters (which live in your Gmail account) and a cached label ID.

## License

MIT
