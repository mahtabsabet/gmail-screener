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
const labelIdCache = {}; // In-memory cache: { labelName: { id, ts } }
const LABEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cachedAllowedEmails = null; // { emails, ts } - used by periodic sweep

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

/** Force re-authorization: revoke current token and get a fresh one with current scopes */
async function forceReauth() {
  try {
    const oldToken = await getAuthToken(false);
    // Revoke the token on Google's side so we get fresh scopes
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${oldToken}`);
    await removeCachedToken(oldToken);
  } catch (_) {
    // If we can't get the old token, that's fine - just clear everything
    await new Promise((resolve) => {
      chrome.identity.clearAllCachedAuthTokens(resolve);
    });
  }
  // Now get a fresh token with interactive consent
  return getAuthToken(true);
}

// ============================================================
// Gmail API helpers
// ============================================================

async function gmailFetch(path, options = {}) {
  let token;
  try {
    token = await getAuthToken(false);
  } catch (authErr) {
    // Non-interactive auth failed - try interactive (will prompt user)
    console.warn('[Gmail Screener] Non-interactive auth failed, trying interactive:', authErr.message);
    token = await getAuthToken(true);
  }

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

  // Retry on 429 (rate limit) with exponential backoff
  if (response.status === 429) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const delay = 1000 * Math.pow(2, attempt); // 2s, 4s, 8s
      console.warn(`[Gmail Screener] Rate limited, retrying in ${delay}ms (attempt ${attempt}/3)`);
      await new Promise((r) => setTimeout(r, delay));
      response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      if (response.status !== 429) break;
    }
  }

  if (!response.ok) {
    let body = '';
    try { body = JSON.stringify(await response.json()); } catch (_) {}
    const reqInfo = `${options.method || 'GET'} ${path}`;
    const reqBody = options.body ? ` | Req: ${options.body.substring(0, 300)}` : '';
    throw new Error(`Gmail API ${response.status} [${reqInfo}]: ${body}${reqBody}`);
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
  // Fast path: in-memory cache
  const cached = labelIdCache[labelName];
  if (cached && (Date.now() - cached.ts) < LABEL_CACHE_TTL) {
    return cached.id;
  }

  const key = storageKeyForLabel(labelName);
  const stored = await chrome.storage.local.get([key]);
  if (stored[key]) {
    // Trust storage cache without API verification (ensureLabel will verify if needed)
    labelIdCache[labelName] = { id: stored[key], ts: Date.now() };
    return stored[key];
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
  // Fastest path: in-memory cache with TTL (no API call)
  const cached = labelIdCache[labelName];
  if (cached && (Date.now() - cached.ts) < LABEL_CACHE_TTL) {
    return cached.id;
  }

  // Fast path: check storage-cached ID and verify it still exists
  const key = storageKeyForLabel(labelName);
  const stored = await chrome.storage.local.get([key]);
  if (stored[key]) {
    try {
      await gmailFetch(`/labels/${stored[key]}`);
      labelIdCache[labelName] = { id: stored[key], ts: Date.now() };
      return stored[key];
    } catch (_) {
      // Cached ID is stale, fall through to full lookup
    }
  }

  // Slow path: fetch all labels to find by name
  const labelsResp = await gmailFetch('/labels');
  const existing = (labelsResp.labels || []).find(
    (l) => l.name === labelName
  );
  if (existing) {
    await chrome.storage.local.set({ [key]: existing.id });
    labelIdCache[labelName] = { id: existing.id, ts: Date.now() };
    console.log(`[Gmail Screener] Label ${labelName} => ${existing.id}`);
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
  await chrome.storage.local.set({ [key]: newLabel.id });
  labelIdCache[labelName] = { id: newLabel.id, ts: Date.now() };
  console.log(`[Gmail Screener] Label ${labelName} => ${newLabel.id} (created)`);
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

let filtersCache = null; // { filters, ts }
const FILTERS_CACHE_TTL = 30 * 1000; // 30 seconds

function invalidateFiltersCache() {
  filtersCache = null;
  cachedAllowedEmails = null;
}

async function getAllFilters() {
  if (filtersCache && (Date.now() - filtersCache.ts) < FILTERS_CACHE_TTL) {
    return filtersCache.filters;
  }
  const resp = await gmailFetch('/settings/filters');
  const filters = resp.filter || [];
  filtersCache = { filters, ts: Date.now() };
  return filters;
}

/** Find all screenout filters (filters that add Screenout label with a from: criteria) */
async function getAllScreenoutFilters(screenoutLabelId, filters) {
  if (!screenoutLabelId) screenoutLabelId = await ensureLabel(LABEL_SCREENOUT);
  if (!filters) filters = await getAllFilters();
  return filters.filter((f) => {
    if (!f.criteria || !f.criteria.from) return false;
    return (f.action?.addLabelIds || []).includes(screenoutLabelId);
  });
}

/** Find all allow filters (filters that remove Screener label with a from: criteria) */
async function getAllAllowFilters(screenoutLabelId, screenerLabelId, filters) {
  if (!screenoutLabelId) screenoutLabelId = await ensureLabel(LABEL_SCREENOUT);
  if (!screenerLabelId) screenerLabelId = await ensureLabel(LABEL_SCREENER);
  if (!filters) filters = await getAllFilters();
  return filters.filter((f) => {
    if (!f.criteria || !f.criteria.from) return false;
    const removeIds = f.action?.removeLabelIds || [];
    const addIds = f.action?.addLabelIds || [];
    // Allow filter: removes Screener label but doesn't add Screenout
    return removeIds.includes(screenerLabelId) && !addIds.includes(screenoutLabelId);
  });
}

async function getScreenedOutEmails() {
  const filters = await getAllScreenoutFilters();
  return filters.map((f) => f.criteria.from.toLowerCase());
}

async function getAllowedEmails() {
  const [screenoutLabelId, screenerLabelId] = await Promise.all([
    ensureLabel(LABEL_SCREENOUT),
    ensureLabel(LABEL_SCREENER),
  ]);
  const filters = await getAllAllowFilters(screenoutLabelId, screenerLabelId);
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
    invalidateFiltersCache();
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
  invalidateFiltersCache();
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

/**
 * Create an allow filter: counteracts the default routing filter for this sender.
 * Gmail filters API doesn't allow 'INBOX' in addLabelIds, so the allow filter
 * removes the Screener label (counteracting the default filter that adds it).
 * INBOX restoration for new mail is handled by the periodic allowed-senders sweep.
 * Existing messages are swept to INBOX immediately in handleAllow().
 */
async function createAllowFilter(target, existingAllowFilters, screenerLabelId) {
  // Check if allow filter already exists
  if (existingAllowFilters) {
    const existing = await findFilterByFrom(existingAllowFilters, target);
    if (existing) return existing.id;
  }

  if (!screenerLabelId) screenerLabelId = await ensureLabel(LABEL_SCREENER);

  const filter = await gmailFetch('/settings/filters', {
    method: 'POST',
    body: JSON.stringify({
      criteria: { from: target },
      action: {
        removeLabelIds: [screenerLabelId],
      },
    }),
  });
  invalidateFiltersCache();
  return filter.id;
}

/**
 * Create a screenout filter: adds Screenout, removes INBOX.
 * Note: Gmail filters API only allows system labels in removeLabelIds,
 * so Screener label removal is handled via sweeps.
 */
async function createScreenoutFilter(target, screenoutLabelId, existingScreenoutFilters) {
  if (!screenoutLabelId) screenoutLabelId = await ensureLabel(LABEL_SCREENOUT);

  if (existingScreenoutFilters) {
    const existing = await findFilterByFrom(existingScreenoutFilters, target);
    if (existing) return existing.id;
  }

  const filter = await gmailFetch('/settings/filters', {
    method: 'POST',
    body: JSON.stringify({
      criteria: { from: target },
      action: {
        addLabelIds: [screenoutLabelId],
        removeLabelIds: ['INBOX'],
      },
    }),
  });
  invalidateFiltersCache();
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
  await modifyMessages(ids, addLabelIds, removeLabelIds);

  const hasMore = result.resultSizeEstimate > ids.length || ids.length >= maxResults;
  return { moved: ids.length, ids, hasMore };
}

/**
 * Modify labels on messages. Uses individual messages.modify calls
 * instead of batchModify to avoid "Invalid label" errors.
 */
async function modifyMessages(ids, addLabelIds, removeLabelIds) {
  if (!ids || ids.length === 0) return;
  const body = JSON.stringify({ addLabelIds, removeLabelIds });
  // Process in parallel batches of 25, ignoring errors for individual messages
  // (message may have been deleted/moved since the search)
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    await Promise.all(batch.map((id) =>
      gmailFetch(`/messages/${id}/modify`, { method: 'POST', body })
        .catch((err) => console.warn(`[Gmail Screener] Skipping message ${id}:`, err.message))
    ));
  }
}

// ============================================================
// Enable / Disable Screener Mode
// ============================================================

async function enableScreenerMode(sweepInbox) {
  const { screenerLabelId } = await ensureAllLabels();

  await createDefaultRoutingFilter();
  await saveSettings({ screenerEnabled: true });
  await updateSweepAlarm();

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
  await updateSweepAlarm();

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
  // Fetch labels and filters once upfront
  const [screenerLabelId, screenoutLabelId, filters] = await Promise.all([
    ensureLabel(LABEL_SCREENER),
    ensureLabel(LABEL_SCREENOUT),
    getAllFilters(),
  ]);

  const screenoutFilters = await getAllScreenoutFilters(screenoutLabelId, filters);
  const allowFilters = await getAllAllowFilters(screenoutLabelId, screenerLabelId, filters);

  const existingScreenout = await findFilterByFrom(screenoutFilters, target);
  if (existingScreenout) await deleteFilter(existingScreenout.id);

  const filterId = await createAllowFilter(target, allowFilters, screenerLabelId);

  // Sweep both labels in parallel
  const [sweep] = await Promise.all([
    sweepMessages(`from:${target} label:${LABEL_SCREENER}`, ['INBOX'], [screenerLabelId], 500),
    sweepMessages(`from:${target} label:${LABEL_SCREENOUT}`, ['INBOX'], [screenoutLabelId], 500),
  ]);

  return { success: true, filterId, movedIds: sweep.ids };
}

async function handleScreenOut(target) {
  // Fetch labels and filters once upfront
  const [screenerLabelId, screenoutLabelId, filters] = await Promise.all([
    ensureLabel(LABEL_SCREENER),
    ensureLabel(LABEL_SCREENOUT),
    getAllFilters(),
  ]);

  const allowFilters = await getAllAllowFilters(screenoutLabelId, screenerLabelId, filters);
  const screenoutFilters = await getAllScreenoutFilters(screenoutLabelId, filters);

  const existingAllow = await findFilterByFrom(allowFilters, target);
  if (existingAllow) await deleteFilter(existingAllow.id);

  const filterId = await createScreenoutFilter(target, screenoutLabelId, screenoutFilters);

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
  const [screenoutLabelId, filters] = await Promise.all([
    ensureLabel(LABEL_SCREENOUT),
    getAllFilters(),
  ]);

  const screenoutFilters = await getAllScreenoutFilters(screenoutLabelId, filters);
  const existing = await findFilterByFrom(screenoutFilters, target);
  if (existing) await deleteFilter(existing.id);

  const query = `from:${target} label:${LABEL_SCREENOUT}`;
  const sweep = await sweepMessages(query, ['INBOX'], [screenoutLabelId], 500);

  return { success: true, movedIds: sweep.ids };
}

async function handleUndoAllow(target, movedIds) {
  const [screenerLabelId, screenoutLabelId] = await Promise.all([
    ensureLabel(LABEL_SCREENER),
    ensureLabel(LABEL_SCREENOUT),
  ]);

  const allowFilters = await getAllAllowFilters(screenoutLabelId, screenerLabelId);
  const existing = await findFilterByFrom(allowFilters, target);
  if (existing) await deleteFilter(existing.id);

  if (movedIds && movedIds.length > 0) {
    await modifyMessages(movedIds, [screenerLabelId], ['INBOX']);
  }

  return { success: true };
}

async function handleUndoScreenOut(target, movedIds) {
  const [screenerLabelId, screenoutLabelId, filters] = await Promise.all([
    ensureLabel(LABEL_SCREENER),
    ensureLabel(LABEL_SCREENOUT),
    getAllFilters(),
  ]);

  const screenoutFilters = await getAllScreenoutFilters(screenoutLabelId, filters);
  const existing = await findFilterByFrom(screenoutFilters, target);
  if (existing) await deleteFilter(existing.id);

  if (movedIds && movedIds.length > 0) {
    await modifyMessages(movedIds, [screenerLabelId], [screenoutLabelId]);
  }

  return { success: true };
}

async function handleRemoveScreenedOut(target) {
  const [screenoutLabelId, filters] = await Promise.all([
    ensureLabel(LABEL_SCREENOUT),
    getAllFilters(),
  ]);

  const screenoutFilters = await getAllScreenoutFilters(screenoutLabelId, filters);
  const existing = await findFilterByFrom(screenoutFilters, target);
  if (existing) await deleteFilter(existing.id);

  const query = `from:${target} label:${LABEL_SCREENOUT}`;
  await sweepMessages(query, ['INBOX'], [screenoutLabelId], 500);

  return { success: true };
}

async function handleRemoveAllowed(target) {
  const [screenoutLabelId, screenerLabelId] = await Promise.all([
    ensureLabel(LABEL_SCREENOUT),
    ensureLabel(LABEL_SCREENER),
  ]);
  const allowFilters = await getAllAllowFilters(screenoutLabelId, screenerLabelId);
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
// Periodic sweep for allowed senders
// ============================================================
// Because Gmail filters can't add INBOX via addLabelIds, the allow filter
// only removes the Screener label. New mail from allowed senders ends up
// with no INBOX and no Screener (in "All Mail" limbo). This periodic sweep
// finds those messages and moves them to INBOX.

const ALLOWED_SWEEP_ALARM = 'allowedSendersSweep';

const ALLOWED_CACHE_TTL = 60 * 1000; // 1 minute

async function sweepAllowedSenders() {
  const settings = await getSettings();
  if (!settings.screenerEnabled) return;

  try {
    // Use cached allowed emails to avoid extra API calls
    let allowedEmails;
    if (cachedAllowedEmails && (Date.now() - cachedAllowedEmails.ts) < ALLOWED_CACHE_TTL) {
      allowedEmails = cachedAllowedEmails.emails;
    } else {
      allowedEmails = await getAllowedEmails();
      cachedAllowedEmails = { emails: allowedEmails, ts: Date.now() };
    }
    if (allowedEmails.length === 0) return;

    // Build a query to find messages from allowed senders that are
    // not in INBOX and not in Screener and not in Screenout (i.e., in limbo)
    // Process in batches to avoid query length limits
    const batchSize = 20;
    for (let i = 0; i < allowedEmails.length; i += batchSize) {
      const batch = allowedEmails.slice(i, i + batchSize);
      const fromClause = batch.map((e) => `from:${e}`).join(' OR ');
      const query = `(${fromClause}) -in:inbox -in:trash -in:spam -label:${LABEL_SCREENER} -label:${LABEL_SCREENOUT} newer_than:1d`;
      await sweepMessages(query, ['INBOX'], [], 100);
    }
    console.log(`[Gmail Screener] Allowed-senders sweep done (${allowedEmails.length} senders)`);
  } catch (err) {
    console.warn('[Gmail Screener] Allowed-senders sweep failed:', err.message);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALLOWED_SWEEP_ALARM) {
    sweepAllowedSenders();
  }
});

// Start/stop the periodic sweep alarm based on screener state
async function updateSweepAlarm() {
  const settings = await getSettings();
  if (settings.screenerEnabled) {
    chrome.alarms.create(ALLOWED_SWEEP_ALARM, { periodInMinutes: 5 });
    console.log('[Gmail Screener] Allowed-senders sweep alarm started');
  } else {
    chrome.alarms.clear(ALLOWED_SWEEP_ALARM);
    console.log('[Gmail Screener] Allowed-senders sweep alarm stopped');
  }
}

// On service worker startup, configure the alarm
updateSweepAlarm();

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
      const threadResults = await Promise.all(
        threadIds.map((id) => gmailFetch(`/threads/${id}?format=minimal`))
      );
      const allMessageIds = threadResults.flatMap(
        (thread) => (thread.messages || []).map((m) => m.id)
      );
      if (allMessageIds.length > 0) {
        await modifyMessages(allMessageIds, [labelId], ['INBOX']);
      }
      return { success: true, movedIds: allMessageIds };
    }

    case 'MOVE_BACK': {
      const labelName = msg.labelName;
      const threadIds = msg.threadIds || [];
      if (threadIds.length === 0) return { success: false, error: 'No threads specified' };
      const labelId = await ensureLabel(labelName);
      const threadResults = await Promise.all(
        threadIds.map((id) => gmailFetch(`/threads/${id}?format=minimal`))
      );
      const allMessageIds = threadResults.flatMap(
        (thread) => (thread.messages || []).map((m) => m.id)
      );
      if (allMessageIds.length > 0) {
        await modifyMessages(allMessageIds, ['INBOX'], [labelId]);
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
      const threads = await Promise.all(result.threads.map(async (t) => {
        try {
          const thread = await gmailFetch(`/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
          const lastMsg = thread.messages?.[thread.messages.length - 1];
          if (!lastMsg) return null;
          const headers = lastMsg.payload?.headers || [];
          const getHeader = (name) => headers.find((h) => h.name === name)?.value || '';
          return {
            threadId: t.id,
            subject: getHeader('Subject'),
            from: getHeader('From'),
            date: getHeader('Date'),
            snippet: thread.snippet || lastMsg.snippet || '',
          };
        } catch (err) {
          console.warn(`[Gmail Screener] Skipping thread ${t.id}:`, err.message);
          return null;
        }
      }));
      return { threads: threads.filter(Boolean) };
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

    case 'GET_LABEL_COUNTS': {
      const [rlId, saId] = await Promise.all([
        getLabelId(LABEL_REPLY_LATER),
        getLabelId(LABEL_SET_ASIDE),
      ]);
      const [rlLabel, saLabel] = await Promise.all([
        rlId ? gmailFetch(`/labels/${rlId}`) : null,
        saId ? gmailFetch(`/labels/${saId}`) : null,
      ]);
      return {
        replyLater: rlLabel?.threadsTotal || 0,
        setAside: saLabel?.threadsTotal || 0,
      };
    }

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
        await forceReauth();
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}
