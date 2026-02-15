# Gatekeeper

A HEY-style email screening web application for Gmail. Take control of who gets into your inbox with an elegant triaging system.

## What is Gatekeeper?

Gatekeeper brings HEY-style sender screening to your Gmail account through a modern web interface. Instead of fighting an overflowing inbox, emails from new senders land in a **Screener** folder where you can:

- **Allow** them into your Imbox (the important inbox)
- **Screen Out** them permanently
- **Set Aside** them for later review

Once allowed, senders' future emails go directly to your Imbox. Screen out senders you never want to hear from. Set aside newsletters and FYI emails to read when you have time.

## Features

- **Screener Mode**: Route all inbound mail through a screener for triage
- **The Imbox**: Your curated inbox with only emails from approved senders
- **Reply Later**: Mark emails you need to respond to
- **Set Aside**: File away emails for later review
- **Screened Out**: View emails from permanently blocked senders
- **Contact Cards**: Rich contact information with Google People API integration
- **Split-pane Email Viewer**: List on the left, detail on the right
- **Gmail Sync**: Bidirectional sync with Gmail labels
- **Search**: Find emails across all folders

## Architecture

- **Next.js 15** with App Router
- **React 19** for the UI
- **SQLite** (better-sqlite3) for local data storage
- **Gmail API** for email operations
- **Google People API** for contact enrichment
- **Tailwind CSS** for styling

### Project Structure

```
├── src/
│   ├── app/
│   │   ├── imbox/           # The curated inbox
│   │   ├── screener/        # Triage new senders
│   │   ├── reply-later/     # Emails marked for reply
│   │   ├── set-aside/       # Filed emails
│   │   ├── screened-out/    # Blocked senders
│   │   ├── sent/            # Sent mail
│   │   ├── search/          # Search interface
│   │   ├── api/             # API routes
│   │   │   ├── auth/        # OAuth flow
│   │   │   ├── threads/     # Email operations
│   │   │   ├── contacts/    # Contact enrichment
│   │   │   └── senders/     # Sender management
│   │   ├── layout.js        # Root layout
│   │   └── page.js          # Landing page
│   ├── components/          # React components
│   │   ├── AppShell.jsx     # Main app layout
│   │   ├── AuthWrapper.jsx  # Authentication wrapper
│   │   ├── ThreadList.jsx   # Email list view
│   │   ├── ThreadDetail.jsx # Email detail view
│   │   ├── ContactCard.jsx  # Contact sidebar
│   │   ├── ContactAvatar.jsx # Contact photo display
│   │   └── FocusReply.jsx   # Reply composer
│   └── lib/                 # Utilities
│       ├── db.js            # SQLite operations
│       ├── gmail.js         # Gmail API client
│       └── session.js       # Session management
└── gatekeeper.db            # SQLite database
```

## Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable **Gmail API** and **People API**

### 2. Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Authorized JavaScript origins: `http://localhost:3000`
5. Authorized redirect URIs: `http://localhost:3000/api/auth/callback`
6. Copy the **Client ID** and **Client Secret**

### 3. Configure OAuth Consent Screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External**
3. Fill in required fields
4. Add scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.settings.basic`
   - `https://www.googleapis.com/auth/contacts.readonly`
5. Add your Google account as a test user

### 4. Environment Setup

Create `.env.local` in the project root:

```bash
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback
SESSION_SECRET=random_string_at_least_32_characters_long
```

Generate a session secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Install Dependencies

```bash
npm install
```

### 6. Run the Application

Development mode:
```bash
npm run dev
```

Production build:
```bash
npm run build
npm start
```

Visit [http://localhost:3000](http://localhost:3000)

### 7. First Use

1. Click **Sign in with Google**
2. Authorize the requested Gmail and Contacts scopes
3. Enable **Screener Mode** from the landing page
4. New emails will route to the Screener for triage

## How It Works

### Screener Mode

When enabled, Gatekeeper creates a Gmail filter that routes all inbound emails (not from you) to a "Gatekeeper/Screener" label. These emails appear in your Screener folder for triage:

- **Allow**: Adds sender to approved list, future emails go to Imbox
- **Screen Out**: Blocks sender, their emails go to Screened Out folder
- **Set Aside**: Files this email away without approving the sender

### Gmail Label Sync

Gatekeeper syncs with Gmail using a `Gatekeeper/` label hierarchy:

- `Gatekeeper/Screener` - Emails awaiting triage
- `Gatekeeper/Imbox` - Approved sender emails
- `Gatekeeper/ReplyLater` - Marked for reply
- `Gatekeeper/SetAside` - Filed emails
- `Gatekeeper/ScreenedOut` - Blocked senders

Actions in Gatekeeper immediately sync to Gmail labels, and vice versa.

### Data Storage

- **SQLite database** stores sender decisions, session data, and contact cache
- **No email content** is stored - only metadata (sender, subject, snippet, thread IDs)
- **Gmail API** is the source of truth for all email content

## Privacy

See [PRIVACY.md](PRIVACY.md) for full details.

**TL;DR**: Gatekeeper only accesses email metadata (sender, subject, snippet). Full message content is fetched on-demand when you view an email and is never stored. Contact information is cached locally for performance.

## Development

### Run Tests

```bash
npm test
```

### Database Schema

The SQLite database stores:
- `users` - OAuth tokens and user info
- `senders` - Sender triage decisions (allow, deny, set_aside)
- `contacts` - Cached contact information from People API
- `sessions` - User sessions

## License

MIT
