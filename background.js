// background.js - Service Worker for Gmail Sender Screener (Screener Mode)
'use strict';

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';
const LABEL_SCREENER = 'Screener';
const LABEL_SCREENOUT = 'Screenout';
const LABEL_REPLY_LATER = 'ReplyLater';
const LABEL_SET_ASIDE = 'SetAside';
const DEFAULT_SWEEP_CAP = 200;
const DEFAULT_FILTER_QUERY = '-is:chat';
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
    try { body = JSON.stringify(await response.json()); } catch (_) {}
    throw new Error(`Gmail API ${response.status}: ${body}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

// ============================================================
// Settings helpers
// ============================================================

async function getSettings() {
  const defaults = {
    screenerEnabled: false,
    sweepCap: DEFAULT_SWEEP_CAP,
    filterQuery: DEFAULT_FILTER_QUERY,
    defaultFilterId: null,
  };
  const stored = await chrome.storage.local.get(Object.keys(defaults));
  return { ...defaults, ...stored };
}

async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
}

// ============================================================
// Label management (generic, from main)
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
      console.warn(`[Gmail Screener] Cached label ${labelName} (${stored[key]}) is stale, clearing`, err);
      await chrome.storage.local.remove([key]);
    }
  }
  return null;
}

function clearAllLabelCaches() {
  const keys = [LABEL_SCREENER, LABEL_SCREENOUT, LABEL_REPLY_LATER, LABEL_SET_ASIDE].map(storageKeyForLabel);
  return chrome.storage.local.remove(keys);
}

async function ensureLabel(labelName) {
  if (ensureLabelPromises[labelName]) return ensureLabelPromises[labelName];
  ensureLabelPromises[labelName] = _ensureLabel(labelName).finally(() => {
    ensureLabelPromises[labelName] = null;
  });
  return ensureLabelPromises[labelName];
}

async function _ensureLabel(labelName) {
  // Always verify against the full labels list to avoid stale IDs
  const labelsResp = await gmailFetch('/labels');
  const existing = (labelsResp.labels || []).find(
    (l) => l.name === labelName
  );
  if (existing) {
    await chrome.storage.local.set({ [storageKeyForLabel(labelName)]: existing.id });
    return existing.id;
  }

  // Create
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

async function ensureAllLabels() {
  const [screenerLabelId, screenoutLabelId, setAsideLabelId, replyLaterLabelId] = await Promise.all([
    ensureLabel(LABEL_SCREENER),
    ensureLabel(LABEL_SCREENOUT),
    ensureLabel(LABEL_SET_ASIDE),
    ensureLabel(LABEL_REPLY_LATER),
  ]);
  return { screenerLabelId, screenoutLabelId, setAsideLabelId, replyLaterLabelId };
}

// ============================================================
// Filter management
// ============================================================

async function getAllFilters() {
  const resp = await gmailFetch('/settings/filters');
  return resp.filter || [];
}

/** Find all screenout filters (filters that add Screenout label with a from: criteria) */
async function getAllScreenoutFilters() {
  const screenoutLabelId = await ensureLabel(LABEL_SCREENOUT);
  const filters = await getAllFilters();
  return filters.filter((f) => {
    if (!f.criteria || !f.criteria.from) return false;
    return (f.action?.addLabelIds || []).includes(screenoutLabelId);
  });
}

/** Find all allow filters (filters that remove Screener label with a from: criteria) */
async function getAllAllowFilters() {
  const screenerLabelId = await ensureLabel(LABEL_SCREENER);
  const filters = await getAllFilters();
  return filters.filter((f) => {
    if (!f.criteria || !f.criteria.from) return false;
    return (f.action?.removeLabelIds || []).includes(screenerLabelId);
  });
}

async function getScreenedOutEmails() {
  const filters = await getAllScreenoutFilters();
  return filters.map((f) => f.criteria.from.toLowerCase());
}

async function getAllowedEmails() {
  const filters = await getAllAllowFilters();
  return filters.map((f) => f.criteria.from.toLowerCase());
}

async function findFilterByFrom(allFilters, email) {
  return allFilters.find(
    (f) => f.criteria && f.criteria.from &&
      f.criteria.from.toLowerCase() === email.toLowerCase()
  );
}

async function deleteFilter(filterId) {
  try {
    await gmailFetch(`/settings/filters/${filterId}`, { method: 'DELETE' });
  } catch (err) {
    if (!err.message?.includes('404')) {
      console.warn('[Gmail Screener] deleteFilter failed:', err);
    }
  }
}

// ============================================================
// Default routing filter (Screener Mode)
// ============================================================

async function createDefaultRoutingFilter() {
  const settings = await getSettings();
  const screenerLabelId = await ensureLabel(LABEL_SCREENER);
  const query = settings.filterQuery || DEFAULT_FILTER_QUERY;

  const filter = await gmailFetch('/settings/filters', {
    method: 'POST',
    body: JSON.stringify({
      criteria: { query },
      action: {
        addLabelIds: [screenerLabelId],
        removeLabelIds: ['INBOX'],
      },
    }),
  });
  await saveSettings({ defaultFilterId: filter.id });
  return filter.id;
}

async function removeDefaultRoutingFilter() {
  const settings = await getSettings();
  if (settings.defaultFilterId) {
    await deleteFilter(settings.defaultFilterId);
    await saveSettings({ defaultFilterId: null });
  }
}

// ============================================================
// Per-sender filter operations
// ============================================================

/** Create an allow filter: removes Screener label, ensures INBOX */
async function createAllowFilter(target) {
  const screenerLabelId = await ensureLabel(LABEL_SCREENER);
  const screenoutLabelId = await ensureLabel(LABEL_SCREENOUT);

  // Check if allow filter already exists
  const allowFilters = await getAllAllowFilters();
  const existing = await findFilterByFrom(allowFilters, target);
  if (existing) return existing.id;

  const filter = await gmailFetch('/settings/filters', {
    method: 'POST',
    body: JSON.stringify({
      criteria: { from: target },
      action: {
        removeLabelIds: [screenerLabelId, screenoutLabelId],
        addLabelIds: ['INBOX'],
      },
    }),
  });
  return filter.id;
}

/** Create a screenout filter: adds Screenout, removes INBOX and Screener */
async function createScreenoutFilter(target) {
  const screenerLabelId = await ensureLabel(LABEL_SCREENER);
  const screenoutLabelId = await ensureLabel(LABEL_SCREENOUT);

  const screenoutFilters = await getAllScreenoutFilters();
  const existing = await findFilterByFrom(screenoutFilters, target);
  if (existing) return existing.id;

  const filter = await gmailFetch('/settings/filters', {
    method: 'POST',
    body: JSON.stringify({
      criteria: { from: target },
      action: {
        addLabelIds: [screenoutLabelId],
        removeLabelIds: ['INBOX', screenerLabelId],
      },
    }),
  });
  return filter.id;
}

// ============================================================
// Message sweep operations
// ============================================================

async function sweepMessages(query, addLabelIds, removeLabelIds, cap) {
  const maxResults = cap || DEFAULT_SWEEP_CAP;
  const result = await gmailFetch(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`
  );
  if (!result.messages || result.messages.length === 0) return { moved: 0, ids: [] };

  const ids = result.messages.map((m) => m.id);
  await batchModifyWithRetry(ids, addLabelIds, removeLabelIds);

  const hasMore = result.resultSizeEstimate > ids.length || ids.length >= maxResults;
  return { moved: ids.length, ids, hasMore };
}

/** batchModify with one retry on invalid-label errors (stale cached IDs) */
async function batchModifyWithRetry(ids, addLabelIds, removeLabelIds) {
  try {
    await gmailFetch('/messages/batchModify', {
      method: 'POST',
      body: JSON.stringify({ ids, addLabelIds, removeLabelIds }),
    });
  } catch (err) {
    if (err.message && err.message.includes('Invalid label')) {
      console.warn('[Gmail Screener] Invalid label in batchModify, refreshing and retrying');
      // Build reverse map BEFORE clearing cache so we know which name each ID had
      const idToName = await buildLabelIdToNameMap();
      await clearAllLabelCaches();
      const refreshedAdd = await refreshLabelIds(addLabelIds, idToName);
      const refreshedRemove = await refreshLabelIds(removeLabelIds, idToName);
      await gmailFetch('/messages/batchModify', {
        method: 'POST',
        body: JSON.stringify({ ids, addLabelIds: refreshedAdd, removeLabelIds: refreshedRemove }),
      });
    } else {
      throw err;
    }
  }
}

async function buildLabelIdToNameMap() {
  const map = {};
  for (const name of [LABEL_SCREENER, LABEL_SCREENOUT, LABEL_REPLY_LATER, LABEL_SET_ASIDE]) {
    const key = storageKeyForLabel(name);
    const stored = await chrome.storage.local.get([key]);
    if (stored[key]) map[stored[key]] = name;
  }
  return map;
}

/** Re-resolve label IDs, replacing stale custom label IDs with fresh ones */
async function refreshLabelIds(labelIds, idToName) {
  if (!labelIds || labelIds.length === 0) return labelIds;
  const refreshed = [];
  for (const id of labelIds) {
    if (!id.startsWith('Label_')) {
      refreshed.push(id);
      continue;
    }
    const labelName = idToName[id];
    if (labelName) {
      refreshed.push(await ensureLabel(labelName));
    } else {
      // Can't identify this label - re-ensure all our labels and skip this ID
      console.warn(`[Gmail Screener] Unknown stale label ID ${id}, skipping`);
    }
  }
  return refreshed;
}

// ============================================================
// Enable / Disable Screener Mode
// ============================================================

async function enableScreenerMode(sweepInbox) {
  const { screenerLabelId } = await ensureAllLabels();

  await createDefaultRoutingFilter();
  await saveSettings({ screenerEnabled: true });

  let sweepResult = null;
  if (sweepInbox) {
    const settings = await getSettings();
    const query = `in:inbox ${settings.filterQuery || DEFAULT_FILTER_QUERY}`;
    sweepResult = await sweepMessages(
      query,
      [screenerLabelId],
      ['INBOX'],
      settings.sweepCap || DEFAULT_SWEEP_CAP
    );
  }

  return { success: true, sweepResult };
}

async function disableScreenerMode(restoreToInbox) {
  await removeDefaultRoutingFilter();
  await saveSettings({ screenerEnabled: false });

  let sweepResult = null;
  if (restoreToInbox) {
    const screenerLabelId = await ensureLabel(LABEL_SCREENER);
    const settings = await getSettings();
    sweepResult = await sweepMessages(
      `label:${LABEL_SCREENER}`,
      ['INBOX'],
      [screenerLabelId],
      settings.sweepCap || DEFAULT_SWEEP_CAP
    );
  }

  return { success: true, sweepResult };
}

// ============================================================
// Action handlers: Allow, Screen Out
// ============================================================

async function handleAllow(target) {
  const screenerLabelId = await ensureLabel(LABEL_SCREENER);

  const screenoutFilters = await getAllScreenoutFilters();
  const existingScreenout = await findFilterByFrom(screenoutFilters, target);
  if (existingScreenout) await deleteFilter(existingScreenout.id);

  const filterId = await createAllowFilter(target);

  const query = `from:${target} label:${LABEL_SCREENER}`;
  const sweep = await sweepMessages(query, ['INBOX'], [screenerLabelId], 500);

  const screenoutLabelId = await ensureLabel(LABEL_SCREENOUT);
  const query2 = `from:${target} label:${LABEL_SCREENOUT}`;
  await sweepMessages(query2, ['INBOX'], [screenoutLabelId], 500);

  return { success: true, filterId, movedIds: sweep.ids };
}

async function handleScreenOut(target) {
  const screenerLabelId = await ensureLabel(LABEL_SCREENER);
  const screenoutLabelId = await ensureLabel(LABEL_SCREENOUT);

  const allowFilters = await getAllAllowFilters();
  const existingAllow = await findFilterByFrom(allowFilters, target);
  if (existingAllow) await deleteFilter(existingAllow.id);

  const filterId = await createScreenoutFilter(target);

  const query = `from:${target} (label:${LABEL_SCREENER} OR in:inbox)`;
  const sweep = await sweepMessages(
    query,
    [screenoutLabelId],
    ['INBOX', screenerLabelId],
    500
  );

  return { success: true, filterId, movedIds: sweep.ids };
}

async function handleScreenIn(target) {
  const screenoutLabelId = await ensureLabel(LABEL_SCREENOUT);

  const screenoutFilters = await getAllScreenoutFilters();
  const existing = await findFilterByFrom(screenoutFilters, target);
  if (existing) await deleteFilter(existing.id);

  const query = `from:${target} label:${LABEL_SCREENOUT}`;
  const sweep = await sweepMessages(query, ['INBOX'], [screenoutLabelId], 500);

  return { success: true, movedIds: sweep.ids };
}

async function handleUndoAllow(target, movedIds) {
  const screenerLabelId = await ensureLabel(LABEL_SCREENER);

  const allowFilters = await getAllAllowFilters();
  const existing = await findFilterByFrom(allowFilters, target);
  if (existing) await deleteFilter(existing.id);

  if (movedIds && movedIds.length > 0) {
    await batchModifyWithRetry(movedIds, [screenerLabelId], ['INBOX']);
  }

  return { success: true };
}

async function handleUndoScreenOut(target, movedIds) {
  const screenerLabelId = await ensureLabel(LABEL_SCREENER);
  const screenoutLabelId = await ensureLabel(LABEL_SCREENOUT);

  const screenoutFilters = await getAllScreenoutFilters();
  const existing = await findFilterByFrom(screenoutFilters, target);
  if (existing) await deleteFilter(existing.id);

  if (movedIds && movedIds.length > 0) {
    await batchModifyWithRetry(movedIds, [screenerLabelId], [screenoutLabelId]);
  }

  return { success: true };
}

async function handleRemoveScreenedOut(target) {
  const screenoutLabelId = await ensureLabel(LABEL_SCREENOUT);

  const screenoutFilters = await getAllScreenoutFilters();
  const existing = await findFilterByFrom(screenoutFilters, target);
  if (existing) await deleteFilter(existing.id);

  const query = `from:${target} label:${LABEL_SCREENOUT}`;
  await sweepMessages(query, ['INBOX'], [screenoutLabelId], 500);

  return { success: true };
}

async function handleRemoveAllowed(target) {
  const allowFilters = await getAllAllowFilters();
  const existing = await findFilterByFrom(allowFilters, target);
  if (existing) await deleteFilter(existing.id);
  return { success: true };
}

// Get Screener label unread count
async function getScreenerCount() {
  try {
    const screenerLabelId = await ensureLabel(LABEL_SCREENER);
    const label = await gmailFetch(`/labels/${screenerLabelId}`);
    return {
      total: label.messagesTotal || 0,
      unread: label.messagesUnread || 0,
      threads: label.threadsTotal || 0,
    };
  } catch (_) {
    return { total: 0, unread: 0, threads: 0 };
  }
}

// ============================================================
// Continue sweep (for when sweep hits cap)
// ============================================================

async function continueSweep(query, addLabelIds, removeLabelIds) {
  const settings = await getSettings();
  return sweepMessages(query, addLabelIds, removeLabelIds, settings.sweepCap || DEFAULT_SWEEP_CAP);
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
    // --- Screener Mode ---
    case 'ENABLE_SCREENER':
      return enableScreenerMode(msg.sweepInbox);

    case 'DISABLE_SCREENER':
      return disableScreenerMode(msg.restoreToInbox);

    case 'GET_STATUS': {
      const settings = await getSettings();
      let screenerCount = null;
      if (settings.screenerEnabled) {
        screenerCount = await getScreenerCount();
      }
      return {
        screenerEnabled: settings.screenerEnabled,
        screenerCount,
        filterQuery: settings.filterQuery || DEFAULT_FILTER_QUERY,
        sweepCap: settings.sweepCap || DEFAULT_SWEEP_CAP,
      };
    }

    case 'UPDATE_SETTINGS': {
      const updates = {};
      if (msg.filterQuery !== undefined) updates.filterQuery = msg.filterQuery;
      if (msg.sweepCap !== undefined) updates.sweepCap = msg.sweepCap;
      await saveSettings(updates);
      return { success: true };
    }

    // --- Triage actions ---
    case 'ALLOW':
      return handleAllow((msg.target || msg.email).toLowerCase());

    case 'SCREEN_OUT':
      return handleScreenOut((msg.target || msg.email).toLowerCase());

    case 'SCREEN_IN':
      return handleScreenIn((msg.target || msg.email).toLowerCase());

    // --- Reply Later / Set Aside (thread-based, from main) ---
    case 'REPLY_LATER':
    case 'SET_ASIDE': {
      const labelName = msg.type === 'REPLY_LATER' ? LABEL_REPLY_LATER : LABEL_SET_ASIDE;
      const threadIds = msg.threadIds || [];
      if (threadIds.length === 0) return { success: false, error: 'No threads specified' };
      const labelId = await ensureLabel(labelName);
      const allMessageIds = [];
      for (const threadId of threadIds) {
        const thread = await gmailFetch(`/threads/${threadId}?format=minimal`);
        for (const m of thread.messages || []) {
          allMessageIds.push(m.id);
        }
      }
      if (allMessageIds.length > 0) {
        await batchModifyWithRetry(allMessageIds, [labelId], ['INBOX']);
      }
      return { success: true, movedIds: allMessageIds };
    }

    case 'MOVE_BACK': {
      const labelName = msg.labelName;
      const threadIds = msg.threadIds || [];
      if (threadIds.length === 0) return { success: false, error: 'No threads specified' };
      const labelId = await ensureLabel(labelName);
      const allMessageIds = [];
      for (const threadId of threadIds) {
        const thread = await gmailFetch(`/threads/${threadId}?format=minimal`);
        for (const m of thread.messages || []) {
          allMessageIds.push(m.id);
        }
      }
      if (allMessageIds.length > 0) {
        await batchModifyWithRetry(allMessageIds, ['INBOX'], [labelId]);
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

    // --- Undo ---
    case 'UNDO_ALLOW':
      return handleUndoAllow((msg.target).toLowerCase(), msg.movedIds);

    case 'UNDO_SCREEN_OUT':
      return handleUndoScreenOut((msg.target).toLowerCase(), msg.movedIds);

    // --- Lists ---
    case 'GET_SCREENED_OUT':
      return { emails: await getScreenedOutEmails() };

    case 'GET_ALLOWED':
      return { emails: await getAllowedEmails() };

    case 'REMOVE_SCREENED_OUT':
      return handleRemoveScreenedOut((msg.email || '').toLowerCase());

    case 'REMOVE_ALLOWED':
      return handleRemoveAllowed((msg.email || '').toLowerCase());

    case 'GET_SCREENER_COUNT':
      return getScreenerCount();

    // --- Continue sweep ---
    case 'CONTINUE_SWEEP':
      return continueSweep(msg.query, msg.addLabelIds, msg.removeLabelIds);

    // --- Auth ---
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
