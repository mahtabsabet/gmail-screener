# Privacy Notice — Gatekeeper

Last updated: February 2026

## What Gatekeeper Does

Gatekeeper is a HEY-style email screening web application for Gmail. It helps you triage incoming emails by routing new senders through a "Screener" folder where you can approve, deny, or set them aside.

## What Data We Access

Gatekeeper accesses the following data through the Gmail and Google People APIs:

### Email Data
- **Sender email addresses and names** - to identify who sent each email
- **Subject lines** - to display in the email list
- **Email snippets** - short preview text shown in the list
- **Message IDs and Thread IDs** - to track conversations
- **Full email content** - fetched on-demand only when you open an email to read it
- **Gmail labels** - to sync triage decisions with your Gmail account

### Contact Data
- **Contact names and email addresses** - from your Google Contacts
- **Profile photos** - from Google Contacts and Gravatar
- **Organization and job titles** - when available in Google Contacts

## What We Store Locally

All data is stored **locally on your computer** in a SQLite database file (`gatekeeper.db`). We store:

- **User ID and email address** - to identify your session
- **OAuth access and refresh tokens** - to authenticate API requests (stored encrypted)
- **Sender triage decisions** - which senders you've allowed, denied, or set aside
- **Email metadata** - sender, subject, snippet, thread IDs (NOT full email content)
- **Cached contact information** - names, photos, job titles for performance
- **Session tokens** - to keep you logged in

### What We Do NOT Store
- Full email message bodies or content (fetched on-demand, never stored)
- Email attachments
- Passwords (OAuth tokens are managed by Google)

## What We Do NOT Transmit

- **No data leaves your computer** except API calls to Google's servers
- **No analytics or telemetry** - we don't track your usage
- **No third-party services** - only Google APIs (Gmail, People)
- **No email content** - only metadata is synced

All network requests go exclusively to:
- `https://www.googleapis.com/gmail/*` - Gmail API
- `https://www.googleapis.com/auth/*` - Google OAuth
- `https://people.googleapis.com/*` - Google People API (contacts)

## Google API Scopes

Gatekeeper requests these OAuth scopes:

| Scope | Purpose |
|-------|---------|
| `gmail.modify` | Read email metadata, create/modify Gmail labels, move emails between labels |
| `gmail.settings.basic` | Create/delete Gmail filters for Screener mode |
| `contacts.readonly` | Read contact names and photos from Google Contacts for enriched sender information |

## How Screener Mode Works

When you enable Screener Mode:

1. Gatekeeper creates a Gmail filter that routes inbound emails (not from you) to a "Gatekeeper/Screener" label
2. These emails appear in your Screener folder for triage
3. When you **allow** a sender, Gatekeeper:
   - Saves the decision in your local database
   - Applies "Gatekeeper/Imbox" label to their emails in Gmail
4. When you **deny** a sender, their emails get the "Gatekeeper/ScreenedOut" label
5. When you **set aside** an email, it gets the "Gatekeeper/SetAside" label

All of these labels are created in your Gmail account and sync across devices.

## Data Retention

- **Local database** - persists on your computer until you delete it or uninstall
- **Session tokens** - expire after 7 days of inactivity
- **OAuth tokens** - stored until you revoke access or sign out
- **Contact cache** - refreshed when viewing contact cards

## Your Control

You have complete control over your data:

### Access Control
- **Sign out** - clears your session but keeps triage decisions in local database
- **Revoke access** - visit [Google Account Permissions](https://myaccount.google.com/permissions) to revoke Gatekeeper's API access
- **Delete database** - remove `gatekeeper.db` to delete all local data

### Gmail Labels
- All Gatekeeper labels (`Gatekeeper/*`) remain in your Gmail account if you stop using the app
- You can delete these labels manually in Gmail Settings
- Gmail filters created by Screener mode remain active until disabled

### Disable Screener Mode
- Click "Disable Screener Mode" in the app
- This removes the Gmail filter that routes emails to the Screener
- Existing labels and triage decisions are preserved

## Data Security

- **OAuth tokens** are stored in the local SQLite database
- **Session cookies** use `httpOnly` and `secure` flags (in production)
- **No server-side storage** - all data stays on your computer
- **No password storage** - authentication is handled by Google OAuth

## Third-Party Access

- **No third parties** have access to your data
- **Only you** can access your local database file
- **Google APIs** process requests but do not store data on our behalf

## Changes to This Policy

We may update this privacy notice to reflect changes in the application or legal requirements. Material changes will be noted in the git repository history.

## Contact

For questions about privacy or data handling:
- Open an issue on the GitHub repository
- Review the source code - Gatekeeper is open source

## Open Source

Gatekeeper is open source software. You can review exactly what data is accessed and how it's used by examining the source code in the repository.

## Your Rights

Under privacy laws like GDPR and CCPA, you have rights including:
- **Access** - view what data is stored (check `gatekeeper.db`)
- **Deletion** - delete your data (remove the database file)
- **Portability** - export your data (SQLite database can be queried)
- **Revocation** - revoke API access at any time

Since all data is stored locally on your computer and no data is transmitted to third parties, you have complete control over your information.
