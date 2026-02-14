import { google } from 'googleapis';
import { getUser, updateTokens } from './db.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/contacts.readonly',
];

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL}/api/auth/callback`
  );
}

export function getAuthUrl() {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

export async function exchangeCode(code) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data: userInfo } = await oauth2.userinfo.get();

  return {
    userId: userInfo.id,
    email: userInfo.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiry: tokens.expiry_date,
  };
}

export function getAuthedClient(userId) {
  const user = getUser(userId);
  if (!user) throw new Error('User not found');

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: user.access_token,
    refresh_token: user.refresh_token,
    expiry_date: user.token_expiry,
  });

  client.on('tokens', (tokens) => {
    updateTokens(userId, tokens.access_token, tokens.expiry_date);
  });

  return client;
}

export function getGmailClient(userId) {
  const auth = getAuthedClient(userId);
  return google.gmail({ version: 'v1', auth });
}

// ---- Gmail operations ----

export async function listInboxThreads(userId, maxResults = 100) {
  const gmail = getGmailClient(userId);
  const res = await gmail.users.threads.list({
    userId: 'me',
    q: 'label:INBOX',
    maxResults,
  });
  return res.data.threads || [];
}

export async function getThread(userId, threadId) {
  const gmail = getGmailClient(userId);
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'metadata',
    metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Message-ID', 'References', 'In-Reply-To'],
  });
  return res.data;
}

// Fetch multiple threads in parallel with concurrency limit
export async function getThreadsBatch(userId, threadIds, concurrency = 10) {
  const gmail = getGmailClient(userId);
  const results = [];
  for (let i = 0; i < threadIds.length; i += concurrency) {
    const batch = threadIds.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(id =>
        gmail.users.threads.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Message-ID', 'References', 'In-Reply-To'],
        }).then(res => res.data)
      )
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
      else console.warn('Skipping thread:', r.reason?.message);
    }
  }
  return results;
}

export async function getThreadFull(userId, threadId) {
  const gmail = getGmailClient(userId);
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });
  return res.data;
}

function getHeader(message, name) {
  const header = message.payload?.headers?.find(
    h => h.name.toLowerCase() === name.toLowerCase()
  );
  return header?.value || '';
}

function extractEmail(fromHeader) {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : fromHeader.toLowerCase().trim();
}

function extractName(fromHeader) {
  const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : fromHeader.split('@')[0];
}

export function parseThreadSummary(thread) {
  const messages = thread.messages || [];
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return null;

  const from = getHeader(lastMsg, 'From');
  const isUnread = messages.some(m => (m.labelIds || []).includes('UNREAD'));
  return {
    threadId: thread.id,
    subject: getHeader(lastMsg, 'Subject') || '(no subject)',
    from,
    fromEmail: extractEmail(from),
    fromName: extractName(from),
    date: getHeader(lastMsg, 'Date'),
    snippet: thread.snippet || lastMsg.snippet || '',
    messageCount: messages.length,
    isUnread,
  };
}

function getMessageBody(message) {
  const payload = message.payload;
  if (!payload) return '';

  // Simple message
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  // Multipart — find text/html or text/plain
  const parts = payload.parts || [];
  for (const part of parts) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64url').toString('utf-8');
    }
  }
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64url').toString('utf-8');
    }
  }

  // Nested multipart
  for (const part of parts) {
    if (part.parts) {
      for (const sub of part.parts) {
        if (sub.mimeType === 'text/html' && sub.body?.data) {
          return Buffer.from(sub.body.data, 'base64url').toString('utf-8');
        }
      }
      for (const sub of part.parts) {
        if (sub.mimeType === 'text/plain' && sub.body?.data) {
          return Buffer.from(sub.body.data, 'base64url').toString('utf-8');
        }
      }
    }
  }

  return '';
}

export function parseFullThread(thread) {
  const messages = thread.messages || [];
  return messages.map(msg => ({
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(msg, 'From'),
    fromEmail: extractEmail(getHeader(msg, 'From')),
    fromName: extractName(getHeader(msg, 'From')),
    to: getHeader(msg, 'To'),
    subject: getHeader(msg, 'Subject'),
    date: getHeader(msg, 'Date'),
    messageId: getHeader(msg, 'Message-ID'),
    references: getHeader(msg, 'References'),
    inReplyTo: getHeader(msg, 'In-Reply-To'),
    snippet: msg.snippet || '',
    body: getMessageBody(msg),
    labelIds: msg.labelIds || [],
  }));
}

export async function sendReply(userId, { threadId, to, subject, body, messageId, references }) {
  const gmail = getGmailClient(userId);
  const user = getUser(userId);

  // Build References header: existing references + the message being replied to
  const refsHeader = references
    ? `${references} ${messageId}`
    : messageId;

  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

  const messageParts = [
    `From: ${user.email}`,
    `To: ${to}`,
    `Subject: ${replySubject}`,
    `In-Reply-To: ${messageId}`,
    `References: ${refsHeader}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body,
  ];

  const rawMessage = messageParts.join('\r\n');
  const encodedMessage = Buffer.from(rawMessage).toString('base64url');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      threadId,
    },
  });

  return res.data;
}

export async function searchThreads(userId, query, maxResults = 50) {
  const gmail = getGmailClient(userId);
  const res = await gmail.users.threads.list({
    userId: 'me',
    q: query,
    maxResults,
  });
  return res.data.threads || [];
}

export async function listSentThreads(userId, maxResults = 50) {
  const gmail = getGmailClient(userId);
  const res = await gmail.users.threads.list({
    userId: 'me',
    q: 'label:SENT',
    maxResults,
  });
  return res.data.threads || [];
}

export async function modifyThreadLabels(userId, threadId, addLabelIds = [], removeLabelIds = []) {
  const gmail = getGmailClient(userId);
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'minimal',
  });

  const messageIds = (thread.data.messages || []).map(m => m.id);
  for (const msgId of messageIds) {
    await gmail.users.messages.modify({
      userId: 'me',
      id: msgId,
      requestBody: { addLabelIds, removeLabelIds },
    });
  }
}

const GATEKEEPER_LABELS = {
  REPLY_LATER: 'Gatekeeper/Reply Later',
  SET_ASIDE: 'Gatekeeper/Set Aside',
};

// Cache label IDs for the session to avoid repeated lookups
const labelIdCache = {};

/**
 * Look up or create a Gmail label by name. Returns the label ID.
 */
export async function ensureLabel(userId, labelName) {
  const cacheKey = `${userId}:${labelName}`;
  if (labelIdCache[cacheKey]) return labelIdCache[cacheKey];

  const gmail = getGmailClient(userId);
  const res = await gmail.users.labels.list({ userId: 'me' });
  const existing = (res.data.labels || []).find(l => l.name === labelName);
  if (existing) {
    labelIdCache[cacheKey] = existing.id;
    return existing.id;
  }

  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  labelIdCache[cacheKey] = created.data.id;
  return created.data.id;
}

/**
 * Get the Gmail label ID for a triage folder. Returns null if the folder
 * doesn't map to a Gmail label.
 */
export async function getLabelIdForFolder(userId, folder) {
  const labelName = GATEKEEPER_LABELS[folder];
  if (!labelName) return null;
  return ensureLabel(userId, labelName);
}

/**
 * Mark all messages in a thread as read (remove UNREAD label).
 */
export async function markThreadRead(userId, threadId) {
  const gmail = getGmailClient(userId);
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
}

// ---- People API (Google Contacts) ----

function getPeopleClient(userId) {
  const auth = getAuthedClient(userId);
  return google.people({ version: 'v1', auth });
}

/**
 * Look up a contact by email address using Google People API.
 * Returns { name, email, photoUrl, phoneNumbers, organizations } or null.
 */
export async function lookupContactByEmail(userId, email) {
  const people = getPeopleClient(userId);

  try {
    // Search across the user's contacts and directory
    const res = await people.people.searchContacts({
      query: email,
      readMask: 'names,emailAddresses,photos,phoneNumbers,organizations',
      pageSize: 5,
    });

    const results = res.data.results || [];
    // Find the result that matches the email
    for (const result of results) {
      const person = result.person;
      if (!person) continue;

      const emails = (person.emailAddresses || []).map(e => e.value?.toLowerCase());
      if (!emails.includes(email.toLowerCase())) continue;

      const name = person.names?.[0]?.displayName || '';
      const photoUrl = person.photos?.[0]?.url || '';
      const phoneNumbers = (person.phoneNumbers || []).map(p => ({
        value: p.value,
        type: p.type || 'other',
      }));
      const organizations = (person.organizations || []).map(o => ({
        name: o.name || '',
        title: o.title || '',
      }));

      return { name, email, photoUrl, phoneNumbers, organizations };
    }
  } catch (err) {
    // If contacts.readonly scope not yet granted, fail gracefully
    if (err.code === 403 || err.code === 401) {
      console.warn('People API not authorized:', err.message);
      return null;
    }
    console.warn('People API lookup failed:', err.message);
  }

  return null;
}

/**
 * Search Google Contacts by name or email.
 * Returns array of { name, email, photoUrl }.
 */
export async function searchGoogleContacts(userId, query, pageSize = 10) {
  const people = getPeopleClient(userId);

  try {
    const res = await people.people.searchContacts({
      query,
      readMask: 'names,emailAddresses,photos,organizations',
      pageSize,
    });

    const results = res.data.results || [];
    return results
      .map(r => r.person)
      .filter(Boolean)
      .map(person => ({
        name: person.names?.[0]?.displayName || '',
        email: person.emailAddresses?.[0]?.value?.toLowerCase() || '',
        photoUrl: person.photos?.[0]?.url || '',
        organization: person.organizations?.[0]?.name || '',
      }))
      .filter(c => c.email);
  } catch (err) {
    if (err.code === 403 || err.code === 401) {
      console.warn('People API not authorized:', err.message);
      return [];
    }
    console.warn('People API search failed:', err.message);
    return [];
  }
}
