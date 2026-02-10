// background.js - Service Worker for Gmail Sender Screener (Screener Mode)
'use strict';

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';
const LABEL_SCREENER = 'Screener';
const LABEL_SCREENOUT = 'Screenout';
const LABEL_SET_ASIDE = 'Set Aside';
const DEFAULT_SWEEP_CAP = 200;
const DEFAULT_FILTER_QUERY = '-is:chat';

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
    // Cached label IDs
    screenerLabelId: null,
    screenoutLabelId: null,
    setAsideLabelId: null,
    // The filter ID for the default routing filter we created
    defaultFilterId: null,
  };
  const stored = await chrome.storage.local.get(Object.keys(defaults));
  return { ...defaults, ...stored };
}

async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
}

// ============================================================
// Label management
// ============================================================

let labelCachePromise = null;

async function ensureLabel(name) {
  const settings = await getSettings();
  const cacheKey = name === LABEL_SCREENER ? 'screenerLabelId'
    : name === LABEL_SCREENOUT ? 'screenoutLabelId'
    : 'setAsideLabelId';

  // Check cache
  if (settings[cacheKey]) {
    try {
      await gmailFetch(`/labels/${settings[cacheKey]}`);
      return settings[cacheKey];
    } catch (_) {
      // Cache stale
    }
  }

  // Search existing
  const labelsResp = await gmailFetch('/labels');
  const existing = (labelsResp.labels || []).find((l) => l.name === name);
  if (existing) {
    await saveSettings({ [cacheKey]: existing.id });
    return existing.id;
  }

  // Create
  const newLabel = await gmailFetch('/labels', {
    method: 'POST',
    body: JSON.stringify({
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  await saveSettings({ [cacheKey]: newLabel.id });
  return newLabel.id;
}

async function ensureAllLabels() {
  if (labelCachePromise) return labelCachePromise;
  labelCachePromise = Promise.all([
    ensureLabel(LABEL_SCREENER),
    ensureLabel(LABEL_SCREENOUT),
    ensureLabel(LABEL_SET_ASIDE),
  ]).finally(() => { labelCachePromise = null; });
  const [screenerLabelId, screenoutLabelId, setAsideLabelId] = await labelCachePromise;
  return { screenerLabelId, screenoutLabelId, setAsideLabelId };
}

async function getLabelId(name) {
  const settings = await getSettings();
  const cacheKey = name === LABEL_SCREENER ? 'screenerLabelId'
    : name === LABEL_SCREENOUT ? 'screenoutLabelId'
    : 'setAsideLabelId';
  if (settings[cacheKey]) return settings[cacheKey];
  return ensureLabel(name);
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
  const screenoutLabelId = await getLabelId(LABEL_SCREENOUT);
  const filters = await getAllFilters();
  return filters.filter((f) => {
    if (!f.criteria || !f.criteria.from) return false;
    return (f.action?.addLabelIds || []).includes(screenoutLabelId);
  });
}

/** Find all allow filters (filters that remove Screener label with a from: criteria) */
async function getAllAllowFilters() {
  const screenerLabelId = await getLabelId(LABEL_SCREENER);
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
  const screenerLabelId = await getLabelId(LABEL_SCREENER);
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
  const screenerLabelId = await getLabelId(LABEL_SCREENER);
  const screenoutLabelId = await getLabelId(LABEL_SCREENOUT);

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
  const screenerLabelId = await getLabelId(LABEL_SCREENER);
  const screenoutLabelId = await getLabelId(LABEL_SCREENOUT);

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
  await gmailFetch('/messages/batchModify', {
    method: 'POST',
    body: JSON.stringify({ ids, addLabelIds, removeLabelIds }),
  });

  // Check if there are more
  const hasMore = result.resultSizeEstimate > ids.length || ids.length >= maxResults;
  return { moved: ids.length, ids, hasMore };
}

// ============================================================
// Enable / Disable Screener Mode
// ============================================================

async function enableScreenerMode(sweepInbox) {
  // 1. Ensure all labels
  const { screenerLabelId } = await ensureAllLabels();

  // 2. Create default routing filter
  await createDefaultRoutingFilter();

  // 3. Mark enabled
  await saveSettings({ screenerEnabled: true });

  // 4. Optional sweep of existing inbox
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
  // 1. Remove default routing filter
  await removeDefaultRoutingFilter();

  // 2. Mark disabled
  await saveSettings({ screenerEnabled: false });

  // 3. Optionally move Screener mail back to inbox
  let sweepResult = null;
  if (restoreToInbox) {
    const screenerLabelId = await getLabelId(LABEL_SCREENER);
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
// Action handlers: Allow, Screen Out, Set Aside
// ============================================================

async function handleAllow(target) {
  const screenerLabelId = await getLabelId(LABEL_SCREENER);

  // Remove any existing screenout filter for this target
  const screenoutFilters = await getAllScreenoutFilters();
  const existingScreenout = await findFilterByFrom(screenoutFilters, target);
  if (existingScreenout) await deleteFilter(existingScreenout.id);

  // Create allow filter
  const filterId = await createAllowFilter(target);

  // Sweep: move from Screener to Inbox
  const query = `from:${target} label:${LABEL_SCREENER}`;
  const sweep = await sweepMessages(query, ['INBOX'], [screenerLabelId], 500);

  // Also move from Screenout to Inbox
  const screenoutLabelId = await getLabelId(LABEL_SCREENOUT);
  const query2 = `from:${target} label:${LABEL_SCREENOUT}`;
  await sweepMessages(query2, ['INBOX'], [screenoutLabelId], 500);

  return { success: true, filterId, movedIds: sweep.ids };
}

async function handleScreenOut(target) {
  const screenerLabelId = await getLabelId(LABEL_SCREENER);
  const screenoutLabelId = await getLabelId(LABEL_SCREENOUT);

  // Remove any existing allow filter for this target
  const allowFilters = await getAllAllowFilters();
  const existingAllow = await findFilterByFrom(allowFilters, target);
  if (existingAllow) await deleteFilter(existingAllow.id);

  // Create screenout filter
  const filterId = await createScreenoutFilter(target);

  // Sweep: move from Screener to Screenout
  const query = `from:${target} (label:${LABEL_SCREENER} OR in:inbox)`;
  const sweep = await sweepMessages(
    query,
    [screenoutLabelId],
    ['INBOX', screenerLabelId],
    500
  );

  return { success: true, filterId, movedIds: sweep.ids };
}

async function handleSetAside(threadIds) {
  const setAsideLabelId = await getLabelId(LABEL_SET_ASIDE);

  // threadIds can be message IDs; batchModify works on messages
  await gmailFetch('/messages/batchModify', {
    method: 'POST',
    body: JSON.stringify({
      ids: threadIds,
      addLabelIds: [setAsideLabelId],
      removeLabelIds: ['INBOX'],
    }),
  });

  return { success: true, movedIds: threadIds };
}

async function handleUndoSetAside(messageIds) {
  const setAsideLabelId = await getLabelId(LABEL_SET_ASIDE);

  await gmailFetch('/messages/batchModify', {
    method: 'POST',
    body: JSON.stringify({
      ids: messageIds,
      addLabelIds: ['INBOX'],
      removeLabelIds: [setAsideLabelId],
    }),
  });

  return { success: true };
}

async function handleUndoAllow(target, movedIds) {
  const screenerLabelId = await getLabelId(LABEL_SCREENER);

  // Delete the allow filter
  const allowFilters = await getAllAllowFilters();
  const existing = await findFilterByFrom(allowFilters, target);
  if (existing) await deleteFilter(existing.id);

  // Move messages back to Screener
  if (movedIds && movedIds.length > 0) {
    await gmailFetch('/messages/batchModify', {
      method: 'POST',
      body: JSON.stringify({
        ids: movedIds,
        addLabelIds: [screenerLabelId],
        removeLabelIds: ['INBOX'],
      }),
    });
  }

  return { success: true };
}

async function handleUndoScreenOut(target, movedIds) {
  const screenerLabelId = await getLabelId(LABEL_SCREENER);
  const screenoutLabelId = await getLabelId(LABEL_SCREENOUT);

  // Delete the screenout filter
  const screenoutFilters = await getAllScreenoutFilters();
  const existing = await findFilterByFrom(screenoutFilters, target);
  if (existing) await deleteFilter(existing.id);

  // Move messages back to Screener
  if (movedIds && movedIds.length > 0) {
    await gmailFetch('/messages/batchModify', {
      method: 'POST',
      body: JSON.stringify({
        ids: movedIds,
        addLabelIds: [screenerLabelId],
        removeLabelIds: [screenoutLabelId],
      }),
    });
  }

  return { success: true };
}

// Screen in from Screenout (legacy deny-list behavior, still useful)
async function handleScreenIn(target) {
  const screenoutLabelId = await getLabelId(LABEL_SCREENOUT);

  const screenoutFilters = await getAllScreenoutFilters();
  const existing = await findFilterByFrom(screenoutFilters, target);
  if (existing) await deleteFilter(existing.id);

  // Move from Screenout to Inbox
  const query = `from:${target} label:${LABEL_SCREENOUT}`;
  const sweep = await sweepMessages(query, ['INBOX'], [screenoutLabelId], 500);

  return { success: true, movedIds: sweep.ids };
}

async function handleRemoveScreenedOut(target) {
  const screenoutLabelId = await getLabelId(LABEL_SCREENOUT);

  const screenoutFilters = await getAllScreenoutFilters();
  const existing = await findFilterByFrom(screenoutFilters, target);
  if (existing) await deleteFilter(existing.id);

  // Move messages back to inbox
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

// Get thread message IDs for Set Aside (from a thread in the DOM)
async function getThreadMessageIds(threadId) {
  const resp = await gmailFetch(`/threads/${threadId}?format=minimal`);
  return (resp.messages || []).map((m) => m.id);
}

// Get Screener label unread count
async function getScreenerCount() {
  try {
    const screenerLabelId = await getLabelId(LABEL_SCREENER);
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

    case 'SET_ASIDE': {
      if (msg.messageIds && msg.messageIds.length > 0) {
        return handleSetAside(msg.messageIds);
      }
      // If threadId provided, look up message IDs
      if (msg.threadId) {
        const ids = await getThreadMessageIds(msg.threadId);
        return handleSetAside(ids);
      }
      return { success: false, error: 'No messageIds or threadId' };
    }

    // --- Undo ---
    case 'UNDO_ALLOW':
      return handleUndoAllow((msg.target).toLowerCase(), msg.movedIds);

    case 'UNDO_SCREEN_OUT':
      return handleUndoScreenOut((msg.target).toLowerCase(), msg.movedIds);

    case 'UNDO_SET_ASIDE':
      return handleUndoSetAside(msg.movedIds || []);

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
