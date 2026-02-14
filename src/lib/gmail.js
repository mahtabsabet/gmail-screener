import { google } from 'googleapis';
import { getUser, updateTokens } from './db.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
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
  return {
    threadId: thread.id,
    subject: getHeader(lastMsg, 'Subject') || '(no subject)',
    from,
    fromEmail: extractEmail(from),
    fromName: extractName(from),
    date: getHeader(lastMsg, 'Date'),
    snippet: thread.snippet || lastMsg.snippet || '',
    messageCount: messages.length,
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
