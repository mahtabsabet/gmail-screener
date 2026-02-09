// background.js - Service Worker for Gmail Sender Screener
'use strict';

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';
const DEFAULT_LABEL_NAME = 'Screenout';

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

  // 204 No Content (e.g. DELETE)
  if (response.status === 204) return null;
  return response.json();
}

// ============================================================
// Label management
// ============================================================

async function getScreenoutLabelId() {
  const stored = await chrome.storage.local.get(['screenoutLabelId']);
  if (stored.screenoutLabelId) {
    // Verify it still exists
    try {
      await gmailFetch(`/labels/${stored.screenoutLabelId}`);
      return stored.screenoutLabelId;
    } catch (_) {
      // Label was deleted externally — recreate below
    }
  }
  return null;
}

async function ensureScreenoutLabel() {
  const cached = await getScreenoutLabelId();
  if (cached) return cached;

  // Check if label already exists on server
  const labelsResp = await gmailFetch('/labels');
  const existing = (labelsResp.labels || []).find(
    (l) => l.name === DEFAULT_LABEL_NAME
  );
  if (existing) {
    await chrome.storage.local.set({ screenoutLabelId: existing.id });
    return existing.id;
  }

  // Create new label
  const newLabel = await gmailFetch('/labels', {
    method: 'POST',
    body: JSON.stringify({
      name: DEFAULT_LABEL_NAME,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  await chrome.storage.local.set({ screenoutLabelId: newLabel.id });
  return newLabel.id;
}

// ============================================================
// Filter management
// ============================================================

async function findExistingFilter(email) {
  const resp = await gmailFetch('/settings/filters');
  const filters = resp.filter || [];
  return filters.find(
    (f) => f.criteria && f.criteria.from && f.criteria.from.toLowerCase() === email.toLowerCase()
  );
}

async function createFilterForSender(email, labelId) {
  const existing = await findExistingFilter(email);
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
  } catch (_) {
    // Filter may already have been deleted
  }
}

// ============================================================
// Thread / message operations
// ============================================================

async function moveInboxMessagesToScreenout(email, labelId) {
  const query = `from:${email} in:inbox`;
  const result = await gmailFetch(
    `/messages?q=${encodeURIComponent(query)}&maxResults=500`
  );

  if (!result.messages || result.messages.length === 0) return [];

  const messageIds = result.messages.map((m) => m.id);

  await gmailFetch('/messages/batchModify', {
    method: 'POST',
    body: JSON.stringify({
      ids: messageIds,
      addLabelIds: [labelId],
      removeLabelIds: ['INBOX'],
    }),
  });

  return messageIds;
}

async function undoMoveMessages(messageIds, labelId) {
  if (!messageIds || messageIds.length === 0) return;

  await gmailFetch('/messages/batchModify', {
    method: 'POST',
    body: JSON.stringify({
      ids: messageIds,
      addLabelIds: ['INBOX'],
      removeLabelIds: [labelId],
    }),
  });
}

// ============================================================
// Message handler
// ============================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => {
      console.error('[Gmail Screener] Error handling message:', err);
      sendResponse({ success: false, error: err.message });
    });
  return true; // keep the message channel open for async response
});

async function handleMessage(msg) {
  switch (msg.type) {
    // ----------------------------------------------------------
    // Screen out a sender
    // ----------------------------------------------------------
    case 'SCREEN_OUT': {
      const email = msg.email.toLowerCase();
      const labelId = await ensureScreenoutLabel();
      const filterId = await createFilterForSender(email, labelId);
      const movedMessageIds = await moveInboxMessagesToScreenout(email, labelId);

      // Persist
      const data = await chrome.storage.sync.get(['blockedEmails']);
      const blocked = data.blockedEmails || [];
      if (!blocked.includes(email)) blocked.push(email);
      await chrome.storage.sync.set({ blockedEmails: blocked });

      // Store filter+message info locally (for undo)
      const local = await chrome.storage.local.get(['filterMap']);
      const filterMap = local.filterMap || {};
      filterMap[email] = { filterId, movedMessageIds };
      await chrome.storage.local.set({ filterMap });

      return { success: true, filterId, movedMessageIds };
    }

    // ----------------------------------------------------------
    // Allow a sender
    // ----------------------------------------------------------
    case 'ALLOW': {
      const email = msg.email.toLowerCase();
      const data = await chrome.storage.sync.get(['allowedEmails']);
      const allowed = data.allowedEmails || [];
      if (!allowed.includes(email)) allowed.push(email);
      await chrome.storage.sync.set({ allowedEmails: allowed });
      return { success: true };
    }

    // ----------------------------------------------------------
    // Undo screen-out
    // ----------------------------------------------------------
    case 'UNDO_SCREEN_OUT': {
      const email = msg.email.toLowerCase();

      // Remove from blocked list
      const syncData = await chrome.storage.sync.get(['blockedEmails']);
      const blocked = (syncData.blockedEmails || []).filter((e) => e !== email);
      await chrome.storage.sync.set({ blockedEmails: blocked });

      // Delete filter & undo message moves
      const local = await chrome.storage.local.get([
        'filterMap',
        'screenoutLabelId',
      ]);
      const filterMap = local.filterMap || {};
      if (filterMap[email]) {
        await deleteFilter(filterMap[email].filterId);
        if (local.screenoutLabelId && filterMap[email].movedMessageIds) {
          await undoMoveMessages(
            filterMap[email].movedMessageIds,
            local.screenoutLabelId
          );
        }
        delete filterMap[email];
        await chrome.storage.local.set({ filterMap });
      }

      return { success: true };
    }

    // ----------------------------------------------------------
    // Remove a sender from the allowed list
    // ----------------------------------------------------------
    case 'REMOVE_ALLOWED': {
      const email = msg.email.toLowerCase();
      const data = await chrome.storage.sync.get(['allowedEmails']);
      const allowed = (data.allowedEmails || []).filter((e) => e !== email);
      await chrome.storage.sync.set({ allowedEmails: allowed });
      return { success: true };
    }

    // ----------------------------------------------------------
    // Remove a sender from the blocked list (+ delete filter)
    // ----------------------------------------------------------
    case 'REMOVE_BLOCKED': {
      const email = msg.email.toLowerCase();

      const syncData = await chrome.storage.sync.get(['blockedEmails']);
      const blocked = (syncData.blockedEmails || []).filter((e) => e !== email);
      await chrome.storage.sync.set({ blockedEmails: blocked });

      const local = await chrome.storage.local.get(['filterMap']);
      const filterMap = local.filterMap || {};
      if (filterMap[email]) {
        await deleteFilter(filterMap[email].filterId);
        delete filterMap[email];
        await chrome.storage.local.set({ filterMap });
      }

      return { success: true };
    }

    // ----------------------------------------------------------
    // Auth status check
    // ----------------------------------------------------------
    case 'GET_AUTH_STATUS': {
      try {
        await getAuthToken(false);
        return { authenticated: true };
      } catch (_) {
        return { authenticated: false };
      }
    }

    // ----------------------------------------------------------
    // Interactive sign-in
    // ----------------------------------------------------------
    case 'SIGN_IN': {
      try {
        await getAuthToken(true);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // ----------------------------------------------------------
    // Get all sender lists (for options page)
    // ----------------------------------------------------------
    case 'GET_ALL_SENDERS': {
      const data = await chrome.storage.sync.get([
        'allowedEmails',
        'blockedEmails',
      ]);
      return {
        allowed: data.allowedEmails || [],
        blocked: data.blockedEmails || [],
      };
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}
