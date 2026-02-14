// background.js - Service Worker for Gmail Sender Screener (Screener Mode)
'use strict';

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';
const LABEL_SCREENER = 'Gatekeeper/Screener';
const LABEL_REPLY_LATER = 'Gatekeeper/Reply Later';
const LABEL_SET_ASIDE = 'Gatekeeper/Set Aside';
const LABEL_ALLOWED = 'Allowed';
const DEFAULT_SWEEP_CAP = 200;
const DEFAULT_FILTER_QUERY = '-is:chat';
const SYNC_ALARM_NAME = 'gatekeeper-cleanup-sync';
const SYNC_INTERVAL_MINUTES = 5;
const ensureLabelPromises = {};
const labelIdCache = {}; // In-memory cache: { labelName: { id, ts } }
const LABEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Convert a label name to a Gmail search query token (handles spaces/slashes). */
function labelQuery(labelName) {
  if (/[\s/]/.test(labelName)) return `label:"${labelName}"`;
  return `label:${labelName}`;
}

/** Convert a label name to a safe Chrome storage key. */
function safeStorageKey(labelName) {
  return labelName.replace(/[/\s]/g, '_');
}

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
  return `labelId_${safeStorageKey(labelName)}`;
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
  const keys = [LABEL_SCREENER, LABEL_REPLY_LATER, LABEL_SET_ASIDE, LABEL_ALLOWED].map(storageKeyForLabel);
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
  const [screenerLabelId, setAsideLabelId, replyLaterLabelId, allowedLabelId] = await Promise.all([
    ensureLabel(LABEL_SCREENER),
    ensureLabel(LABEL_SET_ASIDE),
    ensureLabel(LABEL_REPLY_LATER),
    ensureLabel(LABEL_ALLOWED),
  ]);
  return { screenerLabelId, setAsideLabelId, replyLaterLabelId, allowedLabelId };
}

// ============================================================
// Filter management
// ============================================================

let filtersCache = null; // { filters, ts }
const FILTERS_CACHE_TTL = 30 * 1000; // 30 seconds

function invalidateFiltersCache() {
  filtersCache = null;
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

/** Find all allow filters (filters that add Allowed label with a from: criteria) */
async function getAllAllowFilters(allowedLabelId, filters) {
  if (!allowedLabelId) allowedLabelId = await ensureLabel(LABEL_ALLOWED);
  if (!filters) filters = await getAllFilters();
  return filters.filter((f) => {
    if (!f.criteria || !f.criteria.from) return false;
    return (f.action?.addLabelIds || []).includes(allowedLabelId);
  });
}

async function getAllowedEmails() {
  const allowedLabelId = await ensureLabel(LABEL_ALLOWED);
  const filters = await getAllAllowFilters(allowedLabelId);
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
 * Create an allow filter: marks this sender as allowed by adding the Allowed label.
 * Gmail filters API only allows system labels in removeLabelIds, so we can't
 * remove Screener via filter. Instead, we add the Allowed label and sweep
 * to remove Screener from existing messages in handleAllow().
 */
async function createAllowFilter(target, existingAllowFilters, allowedLabelId) {
  // Check if allow filter already exists
  if (existingAllowFilters) {
    const existing = await findFilterByFrom(existingAllowFilters, target);
    if (existing) return existing.id;
  }

  if (!allowedLabelId) allowedLabelId = await ensureLabel(LABEL_ALLOWED);

  const filter = await gmailFetch('/settings/filters', {
    method: 'POST',
    body: JSON.stringify({
      criteria: { from: target },
      action: {
        addLabelIds: [allowedLabelId],
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
  startCleanupSync();

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
  stopCleanupSync();

  let sweepResult = null;
  if (restoreToInbox) {
    const screenerLabelId = await ensureLabel(LABEL_SCREENER);
    const settings = await getSettings();
    sweepResult = await sweepMessages(
      labelQuery(LABEL_SCREENER),
      ['INBOX'],
      [screenerLabelId],
      settings.sweepCap || DEFAULT_SWEEP_CAP
    );
  }

  return { success: true, sweepResult };
}

// ============================================================
// Action handlers: Allow
// ============================================================

async function handleAllow(target) {
  const [screenerLabelId, allowedLabelId, filters] = await Promise.all([
    ensureLabel(LABEL_SCREENER),
    ensureLabel(LABEL_ALLOWED),
    getAllFilters(),
  ]);

  const allowFilters = await getAllAllowFilters(allowedLabelId, filters);
  const filterId = await createAllowFilter(target, allowFilters, allowedLabelId);

  // Sweep: add Allowed + INBOX labels, remove Screener label
  const sweep = await sweepMessages(
    `from:${target} ${labelQuery(LABEL_SCREENER)}`,
    [allowedLabelId, 'INBOX'],
    [screenerLabelId],
    500
  );

  return { success: true, filterId, movedIds: sweep.ids };
}

async function handleUndoAllow(target, movedIds) {
  const [screenerLabelId, allowedLabelId] = await Promise.all([
    ensureLabel(LABEL_SCREENER),
    ensureLabel(LABEL_ALLOWED),
  ]);

  const allowFilters = await getAllAllowFilters(allowedLabelId);
  const existing = await findFilterByFrom(allowFilters, target);
  if (existing) await deleteFilter(existing.id);

  if (movedIds && movedIds.length > 0) {
    // Restore Screener label, remove Allowed + INBOX labels
    await modifyMessages(movedIds, [screenerLabelId], [allowedLabelId, 'INBOX']);
  }

  return { success: true };
}

async function handleRemoveAllowed(target) {
  const allowedLabelId = await ensureLabel(LABEL_ALLOWED);
  const allowFilters = await getAllAllowFilters(allowedLabelId);
  const existing = await findFilterByFrom(allowFilters, target);
  if (existing) await deleteFilter(existing.id);

  // Remove the Allowed label from existing messages, restore Screener + remove INBOX
  const screenerLabelId = await ensureLabel(LABEL_SCREENER);
  await sweepMessages(
    `from:${target} ${labelQuery(LABEL_ALLOWED)}`,
    [screenerLabelId],
    [allowedLabelId, 'INBOX'],
    500
  );

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
// Cleanup Sync (History-based poller)
// ============================================================

/**
 * Initialize the cleanup sync alarm. Called on extension startup and
 * after enabling screener mode.
 */
function startCleanupSync() {
  chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: SYNC_INTERVAL_MINUTES });
  console.log(`[Gatekeeper] Cleanup sync alarm set (every ${SYNC_INTERVAL_MINUTES} min)`);
}

function stopCleanupSync() {
  chrome.alarms.clear(SYNC_ALARM_NAME);
}

/** Get or initialize the historyId used for incremental sync. */
async function getLastHistoryId() {
  const { lastHistoryId } = await chrome.storage.local.get('lastHistoryId');
  return lastHistoryId || null;
}

async function saveLastHistoryId(historyId) {
  await chrome.storage.local.set({ lastHistoryId: historyId });
}

/**
 * Fetch the user's current profile to get the latest historyId.
 * Used to seed the initial historyId if we don't have one.
 */
async function fetchCurrentHistoryId() {
  const profile = await gmailFetch('/profile');
  return profile.historyId;
}

/**
 * The cleanup sync function. Uses Gmail History API to detect:
 * 1. Reply Later threads where the user removed the label in Gmail → no action needed
 *    (Gmail is already the source of truth for labels)
 * 2. Reply Later threads where the user sent a reply → remove the Reply Later label
 */
async function runCleanupSync() {
  const settings = await getSettings();
  if (!settings.screenerEnabled) return;

  try {
    let startHistoryId = await getLastHistoryId();

    // If no historyId stored, seed it from the profile and skip this cycle
    if (!startHistoryId) {
      const currentId = await fetchCurrentHistoryId();
      await saveLastHistoryId(currentId);
      console.log('[Gatekeeper] Seeded historyId:', currentId);
      return;
    }

    const replyLaterLabelId = await getLabelId(LABEL_REPLY_LATER);
    if (!replyLaterLabelId) return; // Label doesn't exist yet

    // Fetch history since last sync
    let history = [];
    let pageToken = null;
    let latestHistoryId = startHistoryId;

    do {
      const params = new URLSearchParams({
        startHistoryId,
        historyTypes: 'labelRemoved,messageAdded',
        labelId: replyLaterLabelId,
        maxResults: '100',
      });
      if (pageToken) params.set('pageToken', pageToken);

      let resp;
      try {
        resp = await gmailFetch(`/history?${params}`);
      } catch (err) {
        // historyId too old (404) → reseed and return
        if (err.message?.includes('404')) {
          const currentId = await fetchCurrentHistoryId();
          await saveLastHistoryId(currentId);
          console.log('[Gatekeeper] History expired, reseeded historyId:', currentId);
          return;
        }
        throw err;
      }

      if (resp.history) history = history.concat(resp.history);
      if (resp.historyId) latestHistoryId = resp.historyId;
      pageToken = resp.nextPageToken || null;
    } while (pageToken);

    // Save the latest historyId for next cycle
    await saveLastHistoryId(latestHistoryId);

    if (history.length === 0) return;

    // Check Reply Later threads for sent replies
    // Collect thread IDs that had Reply Later label activity
    const replyLaterThreadIds = new Set();
    for (const h of history) {
      // messagesAdded: new messages in threads with the Reply Later label
      for (const added of (h.messagesAdded || [])) {
        const msg = added.message;
        if (msg && (msg.labelIds || []).includes(replyLaterLabelId)) {
          replyLaterThreadIds.add(msg.threadId);
        }
      }
    }

    // For each affected thread, check if a SENT message exists
    for (const threadId of replyLaterThreadIds) {
      try {
        const thread = await gmailFetch(`/threads/${threadId}?format=minimal`);
        const hasSent = (thread.messages || []).some(
          (m) => (m.labelIds || []).includes('SENT')
        );
        if (hasSent) {
          // User replied: remove Reply Later label
          const messageIds = (thread.messages || []).map((m) => m.id);
          await modifyMessages(messageIds, [], [replyLaterLabelId]);
          console.log(`[Gatekeeper] Auto-archived replied thread: ${threadId}`);
        }
      } catch (err) {
        console.warn(`[Gatekeeper] Sync error for thread ${threadId}:`, err.message);
      }
    }

    console.log(`[Gatekeeper] Cleanup sync complete. Processed ${history.length} history records.`);
  } catch (err) {
    console.warn('[Gatekeeper] Cleanup sync failed:', err.message);
  }
}

// Listen for alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    runCleanupSync();
  }
});

// Start sync on service worker startup if screener is enabled
getSettings().then((settings) => {
  if (settings.screenerEnabled) startCleanupSync();
});

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
        try {
          await modifyMessages(allMessageIds, [labelId], ['INBOX']);
        } catch (err) {
          // Rollback: restore INBOX, remove the label we just added
          try {
            await modifyMessages(allMessageIds, ['INBOX'], [labelId]);
          } catch (_) { /* best-effort rollback */ }
          throw err;
        }
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

    // --- Lists ---
    case 'GET_ALLOWED':
      return { emails: await getAllowedEmails() };

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

    // --- Send Reply: archive from Reply Later (spec: remove Reply Later + INBOX) ---
    case 'SEND_REPLY': {
      const threadIds = msg.threadIds || [];
      if (threadIds.length === 0) return { success: false, error: 'No threads specified' };
      const replyLaterLabelId = await ensureLabel(LABEL_REPLY_LATER);
      const threadResults = await Promise.all(
        threadIds.map((id) => gmailFetch(`/threads/${id}?format=minimal`))
      );
      const allMessageIds = threadResults.flatMap(
        (thread) => (thread.messages || []).map((m) => m.id)
      );
      if (allMessageIds.length > 0) {
        await modifyMessages(allMessageIds, [], [replyLaterLabelId, 'INBOX']);
      }
      return { success: true, archivedIds: allMessageIds };
    }

    // --- Trigger cleanup sync ---
    case 'SYNC_NOW':
      await runCleanupSync();
      return { success: true };

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
