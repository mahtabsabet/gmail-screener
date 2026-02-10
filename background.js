// background.js - Service Worker for Gmail Sender Screener
'use strict';

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';
const LABEL_SCREENOUT = 'Screenout';
const LABEL_REPLY_LATER = 'ReplyLater';
const LABEL_SET_ASIDE = 'SetAside';
const ensureLabelPromises = {};

// ============================================================
// OAuth
// ============================================================

function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

// ============================================================
// Gmail API helpers
// ============================================================

async function gmailFetch(path, options = {}) {
  let token = await getAuthToken(false);
  const url = path.startsWith('http')
    ? path
    : `${GMAIL_API_BASE}${path}`;

  let response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  // If 401, clear cached token and retry once
  if (response.status === 401) {
    await removeCachedToken(token);
    token = await getAuthToken(true);
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  }

  if (!response.ok) {
    let body = '';
    try {
      body = JSON.stringify(await response.json());
    } catch (_) {
      // ignore
    }
    throw new Error(`Gmail API ${response.status}: ${body}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

// ============================================================
// Label management
// ============================================================

function storageKeyForLabel(labelName) {
  return `labelId_${labelName}`;
}

async function getLabelId(labelName) {
  const key = storageKeyForLabel(labelName);
  const stored = await chrome.storage.local.get([key]);
  if (stored[key]) {
    try {
      await gmailFetch(`/labels/${stored[key]}`);
      return stored[key];
    } catch (err) {
      console.warn(`[Gmail Screener] Cached label ${labelName} no longer exists:`, err);
    }
  }
  return null;
}

async function ensureLabel(labelName) {
  if (ensureLabelPromises[labelName]) return ensureLabelPromises[labelName];
  ensureLabelPromises[labelName] = _ensureLabel(labelName).finally(() => {
    ensureLabelPromises[labelName] = null;
  });
  return ensureLabelPromises[labelName];
}

async function _ensureLabel(labelName) {
  const cached = await getLabelId(labelName);
  if (cached) return cached;

  const labelsResp = await gmailFetch('/labels');
  const existing = (labelsResp.labels || []).find(
    (l) => l.name === labelName
  );
  if (existing) {
    await chrome.storage.local.set({ [storageKeyForLabel(labelName)]: existing.id });
    return existing.id;
  }

  const newLabel = await gmailFetch('/labels', {
    method: 'POST',
    body: JSON.stringify({
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  await chrome.storage.local.set({ [storageKeyForLabel(labelName)]: newLabel.id });
  return newLabel.id;
}

// Backward-compatible aliases
async function getScreenoutLabelId() {
  return getLabelId(LABEL_SCREENOUT);
}

async function ensureScreenoutLabel() {
  return ensureLabel(LABEL_SCREENOUT);
}

// ============================================================
// Filter management
// ============================================================

async function getAllScreenoutFilters() {
  const labelId = await getScreenoutLabelId();
  if (!labelId) return [];
  const resp = await gmailFetch('/settings/filters');
  const filters = resp.filter || [];
  return filters.filter((f) => {
    if (!f.criteria || !f.criteria.from) return false;
    const adds = f.action?.addLabelIds || [];
    return adds.includes(labelId);
  });
}

async function getScreenedOutEmails() {
  const filters = await getAllScreenoutFilters();
  return filters.map((f) => f.criteria.from.toLowerCase());
}

async function findFilterForSender(email) {
  const filters = await getAllScreenoutFilters();
  return filters.find(
    (f) => f.criteria.from.toLowerCase() === email.toLowerCase()
  );
}

// Note: when email is "@domain.com", Gmail's from: filter also matches subdomains
async function createFilterForSender(email, labelId) {
  const existing = await findFilterForSender(email);
  if (existing) return existing.id;

  const filter = await gmailFetch('/settings/filters', {
    method: 'POST',
    body: JSON.stringify({
      criteria: { from: email },
      action: {
        addLabelIds: [labelId],
        removeLabelIds: ['INBOX'],
      },
    }),
  });
  return filter.id;
}

async function deleteFilter(filterId) {
  try {
    await gmailFetch(`/settings/filters/${filterId}`, { method: 'DELETE' });
  } catch (err) {
    // 404 = already deleted, anything else is unexpected
    if (!err.message?.includes('404')) {
      console.warn('[Gmail Screener] deleteFilter failed:', err);
    }
  }
}

// ============================================================
// Message operations
// ============================================================

async function moveInboxMessagesToScreenout(email, labelId) {
  // TODO: paginate using nextPageToken if a sender has >1000 inbox messages
  const query = `from:${email} in:inbox`;
  const result = await gmailFetch(
    `/messages?q=${encodeURIComponent(query)}&maxResults=1000`
  );
  if (!result.messages || result.messages.length === 0) return [];

  const ids = result.messages.map((m) => m.id);
  await gmailFetch('/messages/batchModify', {
    method: 'POST',
    body: JSON.stringify({
      ids,
      addLabelIds: [labelId],
      removeLabelIds: ['INBOX'],
    }),
  });
  return ids;
}

async function moveScreenoutMessagesToInbox(email, labelId) {
  // TODO: paginate using nextPageToken if a sender has >1000 Screenout messages
  const query = `from:${email} label:${LABEL_SCREENOUT}`;
  const result = await gmailFetch(
    `/messages?q=${encodeURIComponent(query)}&maxResults=1000`
  );
  if (!result.messages || result.messages.length === 0) return [];

  const ids = result.messages.map((m) => m.id);
  await gmailFetch('/messages/batchModify', {
    method: 'POST',
    body: JSON.stringify({
      ids,
      addLabelIds: ['INBOX'],
      removeLabelIds: [labelId],
    }),
  });
  return ids;
}

// ============================================================
// Message handler
// ============================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => {
      console.error('[Gmail Screener]', err);
      sendResponse({ success: false, error: err.message });
    });
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'SCREEN_OUT': {
      const target = (msg.target || msg.email).toLowerCase();
      const labelId = await ensureScreenoutLabel();
      const filterId = await createFilterForSender(target, labelId);
      const movedIds = await moveInboxMessagesToScreenout(target, labelId);
      const screenedOutCount = (await getScreenedOutEmails()).length;
      return { success: true, filterId, movedIds, screenedOutCount };
    }

    case 'SCREEN_IN': {
      const target = (msg.target || msg.email).toLowerCase();
      const filter = await findFilterForSender(target);
      if (filter) await deleteFilter(filter.id);
      const labelId = await getScreenoutLabelId();
      if (labelId) await moveScreenoutMessagesToInbox(target, labelId);
      const screenedOutCount = (await getScreenedOutEmails()).length;
      return { success: true, screenedOutCount };
    }

    case 'UNDO_SCREEN_OUT': {
      const target = (msg.target || msg.email).toLowerCase();
      const movedIds = msg.movedIds || [];
      const filter = await findFilterForSender(target);
      if (filter) await deleteFilter(filter.id);
      const labelId = await getScreenoutLabelId();
      if (labelId && movedIds.length > 0) {
        await gmailFetch('/messages/batchModify', {
          method: 'POST',
          body: JSON.stringify({
            ids: movedIds,
            addLabelIds: ['INBOX'],
            removeLabelIds: [labelId],
          }),
        });
      }
      const screenedOutCount = (await getScreenedOutEmails()).length;
      return { success: true, screenedOutCount };
    }

    case 'GET_SCREENED_OUT': {
      const entries = await getScreenedOutEmails();
      return { emails: entries };
    }

    case 'REMOVE_SCREENED_OUT': {
      const target = (msg.email || '').toLowerCase();
      const filter = await findFilterForSender(target);
      if (filter) await deleteFilter(filter.id);
      const labelId = await getScreenoutLabelId();
      if (labelId) await moveScreenoutMessagesToInbox(target, labelId);
      return { success: true };
    }

    case 'REPLY_LATER':
    case 'SET_ASIDE': {
      const labelName = msg.type === 'REPLY_LATER' ? LABEL_REPLY_LATER : LABEL_SET_ASIDE;
      const threadIds = msg.threadIds || [];
      if (threadIds.length === 0) return { success: false, error: 'No threads specified' };
      const labelId = await ensureLabel(labelName);
      // Collect all message IDs from the threads
      const allMessageIds = [];
      for (const threadId of threadIds) {
        const thread = await gmailFetch(`/threads/${threadId}?format=minimal`);
        for (const m of thread.messages || []) {
          allMessageIds.push(m.id);
        }
      }
      if (allMessageIds.length > 0) {
        await gmailFetch('/messages/batchModify', {
          method: 'POST',
          body: JSON.stringify({
            ids: allMessageIds,
            addLabelIds: [labelId],
            removeLabelIds: ['INBOX'],
          }),
        });
      }
      return { success: true, movedIds: allMessageIds };
    }

    case 'MOVE_BACK': {
      const labelName = msg.labelName;
      const threadIds = msg.threadIds || [];
      if (threadIds.length === 0) return { success: false, error: 'No threads specified' };
      const labelId = await getLabelId(labelName);
      if (!labelId) return { success: false, error: `Label ${labelName} not found` };
      const allMessageIds = [];
      for (const threadId of threadIds) {
        const thread = await gmailFetch(`/threads/${threadId}?format=minimal`);
        for (const m of thread.messages || []) {
          allMessageIds.push(m.id);
        }
      }
      if (allMessageIds.length > 0) {
        await gmailFetch('/messages/batchModify', {
          method: 'POST',
          body: JSON.stringify({
            ids: allMessageIds,
            addLabelIds: ['INBOX'],
            removeLabelIds: [labelId],
          }),
        });
      }
      return { success: true };
    }

    case 'GET_LABELED_THREADS': {
      const labelName = msg.labelName;
      const labelId = await getLabelId(labelName);
      if (!labelId) return { threads: [] };
      const result = await gmailFetch(
        `/threads?labelIds=${labelId}&maxResults=50`
      );
      if (!result.threads || result.threads.length === 0) return { threads: [] };
      // Fetch metadata for each thread
      const threads = [];
      for (const t of result.threads) {
        const thread = await gmailFetch(`/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
        const lastMsg = thread.messages?.[thread.messages.length - 1];
        if (!lastMsg) continue;
        const headers = lastMsg.payload?.headers || [];
        const getHeader = (name) => headers.find((h) => h.name === name)?.value || '';
        threads.push({
          threadId: t.id,
          subject: getHeader('Subject'),
          from: getHeader('From'),
          date: getHeader('Date'),
          snippet: thread.snippet || lastMsg.snippet || '',
        });
      }
      return { threads };
    }

    case 'GET_AUTH_STATUS': {
      try {
        await getAuthToken(false);
        return { authenticated: true };
      } catch (_) {
        return { authenticated: false };
      }
    }

    case 'SIGN_IN': {
      try {
        await getAuthToken(true);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}
