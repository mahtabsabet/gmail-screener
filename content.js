// content.js - Content Script for Gmail Sender Screener
// Injected into https://mail.google.com/*
(function () {
  'use strict';

  let observer = null;
  let debounceTimer = null;
  let authenticated = false;
  let periodicTimer = null;

  // ============================================================
  // View detection
  // ============================================================

  function getCurrentView() {
    const hash = location.hash || '';
    // Gmail uses #label/Screenout for custom labels
    if (/label\/Screenout/i.test(hash)) return 'screenout';
    // Default: inbox or any other view
    if (
      hash === '' ||
      hash === '#inbox' ||
      hash.startsWith('#inbox/') ||
      hash.startsWith('#category/') ||
      hash === '#all' ||
      hash.startsWith('#all/') ||
      hash.startsWith('#search/')
    ) {
      return 'inbox';
    }
    return 'other';
  }

  // ============================================================
  // Auth helpers
  // ============================================================

  async function checkAuth() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' });
      authenticated = resp && resp.authenticated;
    } catch (err) {
      console.warn('[Gmail Screener] Auth check failed:', err);
      authenticated = false;
    }
    return authenticated;
  }

  async function ensureAuth() {
    if (authenticated) return true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
      if (resp && resp.success) {
        authenticated = true;
        showToast('Signed in successfully.', 'success');
        return true;
      }
      showToast('Sign-in failed.', 'error');
    } catch (err) {
      showToast(`Sign-in error: ${err.message}`, 'error');
    }
    return false;
  }

  // ============================================================
  // Sender extraction from DOM
  // ============================================================

  function extractSenderEmail(row) {
    // <span email="user@example.com">
    for (const span of row.querySelectorAll('[email]')) {
      const email = span.getAttribute('email');
      if (email && email.includes('@')) return email.toLowerCase().trim();
    }
    // Fallback: data-hovercard-id
    for (const el of row.querySelectorAll('[data-hovercard-id]')) {
      const id = el.getAttribute('data-hovercard-id');
      if (id && id.includes('@')) return id.toLowerCase().trim();
    }
    return null;
  }

  // ============================================================
  // Thread ID extraction
  // ============================================================

  /**
   * Convert a decimal thread ID (from Gmail's jslog) to the hex format
   * the Gmail API expects. Uses BigInt to handle the large numbers.
   */
  function decimalToHex(decStr) {
    try {
      return BigInt(decStr).toString(16);
    } catch (_) {
      return decStr;
    }
  }

  /**
   * Normalize a raw thread ID value found in the DOM.
   * Gmail stores IDs as #thread-f:DECIMAL — the API needs hex.
   */
  function normalizeThreadId(raw) {
    if (!raw) return null;
    // #thread-f:1234567890 → convert decimal to hex
    const threadFMatch = raw.match(/#thread-f:(\d+)/);
    if (threadFMatch) return decimalToHex(threadFMatch[1]);
    // Already looks like a hex or alphanumeric thread ID
    return raw;
  }

  function extractThreadId(row) {
    // Strategy 1: look for <a> links with thread IDs in href
    for (const a of row.querySelectorAll('a[href*="#"]')) {
      const href = a.getAttribute('href') || '';
      const match = href.match(/#(?:inbox|label\/[^/]+|all|search\/[^/]+)\/([A-Za-z0-9_-]{10,})/);
      if (match) return match[1];
    }
    // Strategy 2: data attributes on the row itself
    for (const attr of ['data-legacy-thread-id', 'data-thread-id', 'data-item-id']) {
      const val = row.getAttribute(attr);
      if (val) return normalizeThreadId(val);
    }
    // Strategy 3: jslog attribute
    const jslog = row.getAttribute('jslog') || '';
    const jslogMatch = jslog.match(/#thread-f:(\d+)/);
    if (jslogMatch) return decimalToHex(jslogMatch[1]);
    // Strategy 4: data attributes on child elements
    for (const el of row.querySelectorAll('[data-thread-id], [data-legacy-thread-id], [data-item-id]')) {
      const val = el.getAttribute('data-thread-id') || el.getAttribute('data-legacy-thread-id') || el.getAttribute('data-item-id');
      if (val) return normalizeThreadId(val);
    }
    // Strategy 5: data-message-id
    for (const el of row.querySelectorAll('[data-message-id]')) {
      return el.getAttribute('data-message-id');
    }
    return null;
  }

  // ============================================================
  // UI injection
  // ============================================================

  function getDomain(email) {
    const at = email.indexOf('@');
    return at !== -1 ? email.substring(at + 1) : null;
  }

  // SVG icons
  const ICON_BLOCK = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 014 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0120 12c0 4.42-3.58 8-8 8z"/></svg>';
  const ICON_PERSON_BLOCK = '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  const ICON_GLOBE = '<svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 00-1.38-3.56A8.03 8.03 0 0118.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 015.08 16zm2.95-8H5.08a7.987 7.987 0 014.33-3.56A15.65 15.65 0 008.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
  // Triage icons
  const ICON_SCHEDULE = '<svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>';
  const ICON_BOOKMARK = '<svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
  const ICON_TRIAGE = '<svg viewBox="0 0 24 24"><path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z"/></svg>';

  let activeDropdown = null;
  let activeTriageDropdown = null;

  function closeActiveDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('keydown', onEscapeKey, true);
  }

  function onDocumentClick(e) {
    if (activeDropdown && !activeDropdown.contains(e.target)) {
      closeActiveDropdown();
    }
  }

  function onEscapeKey(e) {
    if (e.key === 'Escape') {
      closeActiveDropdown();
    }
  }

  function injectButton(row, email, view) {
    if (row.querySelector('.gs-trigger')) return;

    const domain = getDomain(email);
    const isScreenout = view === 'screenout';
    const actionLabel = isScreenout ? 'Screen in' : 'Screen out';

    // Trigger button
    const container = document.createElement('span');
    container.className = 'gs-trigger';

    const triggerBtn = document.createElement('button');
    triggerBtn.className = 'gs-trigger-btn';
    triggerBtn.title = actionLabel + ' sender';
    triggerBtn.innerHTML = ICON_BLOCK;
    triggerBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      showDropdown(row, email, domain, view, container);
    });
    container.appendChild(triggerBtn);

    const senderCell =
      row.querySelector('td.yX') ||
      row.querySelector('[email]')?.closest('td') ||
      row.querySelector('td:nth-child(4)') ||
      row.querySelector('td:nth-child(3)');
    if (senderCell) {
      senderCell.style.position = 'relative';
      senderCell.appendChild(container);
    }

    row.classList.add('gs-has-action');
  }

  function showDropdown(row, email, domain, view, anchor) {
    closeActiveDropdown();

    const isScreenout = view === 'screenout';
    const headerLabel = isScreenout ? 'SCREEN IN' : 'SCREEN OUT';
    const headerIcon = isScreenout ? ICON_CHECK : ICON_BLOCK;
    const senderAction = isScreenout ? 'Screen in sender' : 'Screen out sender';
    const domainAction = isScreenout ? 'Screen in domain' : 'Screen out domain';

    const dropdown = document.createElement('div');
    dropdown.className = 'gs-dropdown';

    // Header
    const header = document.createElement('div');
    header.className = 'gs-dropdown-header';
    header.innerHTML = headerIcon + ' ' + headerLabel;
    dropdown.appendChild(header);

    // Divider
    const div1 = document.createElement('div');
    div1.className = 'gs-dropdown-divider';
    dropdown.appendChild(div1);

    // Sender item
    const senderItem = document.createElement('button');
    senderItem.className = 'gs-dropdown-item';
    senderItem.innerHTML =
      '<span class="gs-dropdown-icon">' + ICON_PERSON_BLOCK + '</span>' +
      '<span><span class="gs-dropdown-label">' + senderAction + '</span><br>' +
      '<span class="gs-dropdown-sub">' + escapeHtml(email) + '</span></span>';
    senderItem.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closeActiveDropdown();
      if (isScreenout) {
        handleScreenIn(email, row);
      } else {
        handleScreenOut(email, row);
      }
    });
    dropdown.appendChild(senderItem);

    // Domain item
    if (domain) {
      const div2 = document.createElement('div');
      div2.className = 'gs-dropdown-divider';
      dropdown.appendChild(div2);

      const domainItem = document.createElement('button');
      domainItem.className = 'gs-dropdown-item';
      domainItem.innerHTML =
        '<span class="gs-dropdown-icon">' + ICON_GLOBE + '</span>' +
        '<span><span class="gs-dropdown-label">' + domainAction + '</span><br>' +
        '<span class="gs-dropdown-sub">All from @' + escapeHtml(domain) + '</span></span>';
      domainItem.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeActiveDropdown();
        if (isScreenout) {
          handleScreenIn('@' + domain, row);
        } else {
          handleScreenOut('@' + domain, row);
        }
      });
      dropdown.appendChild(domainItem);
    }

    anchor.style.position = 'relative';
    anchor.appendChild(dropdown);
    activeDropdown = dropdown;

    // Close on outside click or Escape (next tick)
    setTimeout(() => {
      document.addEventListener('click', onDocumentClick, true);
      document.addEventListener('keydown', onEscapeKey, true);
    }, 0);
  }

  function closeActiveTriageDropdown() {
    if (activeTriageDropdown) {
      activeTriageDropdown.remove();
      activeTriageDropdown = null;
    }
  }

  function injectTriageButton(row, view) {
    if (view !== 'inbox') return;
    if (row.querySelector('.gs-triage-trigger')) return;

    const threadId = extractThreadId(row);
    if (!threadId) return;

    const container = document.createElement('span');
    container.className = 'gs-triage-trigger';

    const triggerBtn = document.createElement('button');
    triggerBtn.className = 'gs-triage-btn';
    triggerBtn.title = 'Reply Later / Set Aside';
    triggerBtn.innerHTML = ICON_TRIAGE;
    triggerBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      showTriageDropdown(row, threadId, container);
    });
    container.appendChild(triggerBtn);

    const senderCell =
      row.querySelector('td.yX') ||
      row.querySelector('[email]')?.closest('td') ||
      row.querySelector('td:nth-child(4)') ||
      row.querySelector('td:nth-child(3)');
    if (senderCell) {
      senderCell.appendChild(container);
    }
  }

  function showTriageDropdown(row, threadId, anchor) {
    closeActiveDropdown();
    closeActiveTriageDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'gs-dropdown';

    // Header
    const header = document.createElement('div');
    header.className = 'gs-dropdown-header';
    header.innerHTML = ICON_TRIAGE + ' TRIAGE';
    dropdown.appendChild(header);

    // Divider
    const div1 = document.createElement('div');
    div1.className = 'gs-dropdown-divider';
    dropdown.appendChild(div1);

    // Reply Later item
    const replyLaterItem = document.createElement('button');
    replyLaterItem.className = 'gs-dropdown-item';
    replyLaterItem.innerHTML =
      '<span class="gs-dropdown-icon gs-icon-reply-later">' + ICON_SCHEDULE + '</span>' +
      '<span><span class="gs-dropdown-label">Reply Later</span><br>' +
      '<span class="gs-dropdown-sub">Come back and respond</span></span>';
    replyLaterItem.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closeActiveTriageDropdown();
      handleTriage('REPLY_LATER', threadId, row);
    });
    dropdown.appendChild(replyLaterItem);

    // Divider
    const div2 = document.createElement('div');
    div2.className = 'gs-dropdown-divider';
    dropdown.appendChild(div2);

    // Set Aside item
    const setAsideItem = document.createElement('button');
    setAsideItem.className = 'gs-dropdown-item';
    setAsideItem.innerHTML =
      '<span class="gs-dropdown-icon gs-icon-set-aside">' + ICON_BOOKMARK + '</span>' +
      '<span><span class="gs-dropdown-label">Set Aside</span><br>' +
      '<span class="gs-dropdown-sub">Keep handy for reference</span></span>';
    setAsideItem.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closeActiveTriageDropdown();
      handleTriage('SET_ASIDE', threadId, row);
    });
    dropdown.appendChild(setAsideItem);

    anchor.style.position = 'relative';
    anchor.appendChild(dropdown);
    activeTriageDropdown = dropdown;

    setTimeout(() => {
      const closeHandler = (evt) => {
        if (activeTriageDropdown && !activeTriageDropdown.contains(evt.target)) {
          closeActiveTriageDropdown();
          document.removeEventListener('click', closeHandler, true);
          document.removeEventListener('keydown', escHandler, true);
        }
      };
      const escHandler = (evt) => {
        if (evt.key === 'Escape') {
          closeActiveTriageDropdown();
          document.removeEventListener('click', closeHandler, true);
          document.removeEventListener('keydown', escHandler, true);
        }
      };
      document.addEventListener('click', closeHandler, true);
      document.addEventListener('keydown', escHandler, true);
    }, 0);
  }

  async function handleTriage(type, threadId, row) {
    if (!(await ensureAuth())) return;

    console.log('[Gmail Screener] handleTriage:', type, 'threadId:', threadId);
    const label = type === 'REPLY_LATER' ? 'Reply Later' : 'Set Aside';
    try {
      const resp = await chrome.runtime.sendMessage({ type, threadIds: [threadId] });
      console.log('[Gmail Screener] handleTriage response:', JSON.stringify(resp));
      if (resp && resp.success) {
        row.classList.add('gs-row-exit');
        setTimeout(() => { row.style.display = 'none'; }, 300);
        refreshBottomBarCounts();
        showToast(`Moved to ${label}`, 'success', {
          action: 'Undo',
          onAction: () => handleUndoTriage(type, threadId, row, resp.movedIds),
        });
      } else {
        showToast(`Failed: ${resp?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  async function handleUndoTriage(type, threadId, row, movedIds) {
    const labelName = type === 'REPLY_LATER' ? 'ReplyLater' : 'SetAside';
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'MOVE_BACK',
        labelName,
        threadIds: [threadId],
      });
      if (resp && resp.success) {
        row.style.display = '';
        row.classList.remove('gs-row-exit');
        refreshBottomBarCounts();
        showToast('Undo successful', 'success');
      } else {
        showToast(`Undo failed: ${resp?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      showToast(`Undo error: ${err.message}`, 'error');
    }
  }

  function escapeHtml(str) {
    const d = document.createElement('span');
    d.textContent = str;
    return d.innerHTML;
  }

  // ============================================================
  // Action handlers
  // ============================================================

  /** Check if a row's sender matches a target (email or @domain) */
  function rowMatchesTarget(rowEmail, target) {
    if (!rowEmail) return false;
    if (target.startsWith('@')) {
      return rowEmail.endsWith(target);
    }
    return rowEmail === target;
  }

  function hideMatchingRows(target) {
    const rows = getInboxRows();
    const hidden = [];
    for (const r of rows) {
      const rowEmail = extractSenderEmail(r);
      if (rowMatchesTarget(rowEmail, target)) {
        r.classList.add('gs-row-exit');
        setTimeout(() => { r.style.display = 'none'; }, 300);
        hidden.push(r);
      }
    }
    return hidden;
  }

  function showRows(hiddenRows) {
    for (const r of hiddenRows) {
      r.style.display = '';
      r.classList.remove('gs-row-exit');
    }
  }

  async function handleScreenOut(target, row) {
    if (!(await ensureAuth())) return;

    const btns = row.querySelectorAll('.gs-trigger-btn');
    for (const b of btns) { b.disabled = true; }

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SCREEN_OUT', target });
      if (resp && resp.success) {
        const hiddenRows = hideMatchingRows(target);

        updatePanelCount(resp.screenedOutCount);
        showToast(`Screened out ${target}`, 'success', {
          action: 'Undo',
          onAction: () => handleUndoScreenOut(target, hiddenRows, resp.movedIds),
        });
      } else {
        showToast(`Failed: ${resp?.error || 'Unknown error'}`, 'error');
        for (const b of btns) { b.disabled = false; }
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
      for (const b of btns) { b.disabled = false; }
    }
  }

  async function handleScreenIn(target, row) {
    if (!(await ensureAuth())) return;

    const btns = row.querySelectorAll('.gs-trigger-btn');
    for (const b of btns) { b.disabled = true; }

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SCREEN_IN', target });
      if (resp && resp.success) {
        hideMatchingRows(target);
        updatePanelCount(resp.screenedOutCount);
        showToast(`Screened in ${target} — moved to inbox`, 'success');
      } else {
        showToast(`Failed: ${resp?.error || 'Unknown error'}`, 'error');
        for (const b of btns) { b.disabled = false; }
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
      for (const b of btns) { b.disabled = false; }
    }
  }

  async function handleUndoScreenOut(target, hiddenRows, movedIds) {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'UNDO_SCREEN_OUT',
        target,
        movedIds,
      });
      if (resp && resp.success) {
        showRows(hiddenRows);
        updatePanelCount(resp.screenedOutCount);
        showToast(`Undo successful for ${target}`, 'success');
      } else {
        showToast(`Undo failed: ${resp?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      showToast(`Undo error: ${err.message}`, 'error');
    }
  }

  // ============================================================
  // Toast / snackbar
  // ============================================================

  function showToast(message, type, options) {
    const existing = document.querySelector('.gs-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `gs-toast gs-toast-${type || 'info'}`;

    const text = document.createElement('span');
    text.className = 'gs-toast-text';
    text.textContent = message;
    toast.appendChild(text);

    if (options && options.action) {
      const btn = document.createElement('button');
      btn.className = 'gs-toast-action';
      btn.textContent = options.action;
      btn.addEventListener('click', () => {
        toast.remove();
        if (options.onAction) options.onAction();
      });
      toast.appendChild(btn);
    }

    document.body.appendChild(toast);
    toast.offsetHeight; // reflow
    toast.classList.add('gs-toast-visible');

    const timeout = options && options.action ? 8000 : 4000;
    setTimeout(() => {
      toast.classList.remove('gs-toast-visible');
      toast.classList.add('gs-toast-dismiss');
      setTimeout(() => toast.remove(), 300);
    }, timeout);
  }

  // ============================================================
  // Screened-out panel (in-Gmail UI)
  // ============================================================

  let panelEl = null;
  let panelTabEl = null;
  let overlayEl = null;

  function createPanel() {
    if (panelEl) return;

    // Tab on right edge
    panelTabEl = document.createElement('div');
    panelTabEl.className = 'gs-panel-tab';
    panelTabEl.innerHTML = 'Screened out <span class="gs-panel-tab-count" id="gs-tab-count">0</span>';
    panelTabEl.addEventListener('click', togglePanel);
    document.body.appendChild(panelTabEl);

    // Overlay
    overlayEl = document.createElement('div');
    overlayEl.className = 'gs-panel-overlay';
    overlayEl.addEventListener('click', closePanel);
    document.body.appendChild(overlayEl);

    // Panel
    panelEl = document.createElement('div');
    panelEl.className = 'gs-panel';
    panelEl.innerHTML =
      '<div class="gs-panel-header">' +
        '<span class="gs-panel-title">Screened out <span class="gs-panel-count" id="gs-panel-count">0</span></span>' +
        '<button class="gs-panel-close" title="Close">\u00d7</button>' +
      '</div>' +
      '<div class="gs-panel-list" id="gs-panel-list">' +
        '<div class="gs-panel-empty">Loading\u2026</div>' +
      '</div>' +
      '<div class="gs-panel-footer">' +
        '<a id="gs-panel-screenout-link">Open Screenout folder</a>' +
      '</div>';
    document.body.appendChild(panelEl);

    panelEl.querySelector('.gs-panel-close').addEventListener('click', closePanel);
    panelEl.querySelector('#gs-panel-screenout-link').addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = '#label/Screenout';
      closePanel();
    });

    // Load count for tab badge
    refreshPanelCount();
  }

  function togglePanel() {
    if (panelEl.classList.contains('gs-panel-open')) {
      closePanel();
    } else {
      openPanel();
    }
  }

  async function openPanel() {
    panelEl.classList.add('gs-panel-open');
    overlayEl.classList.add('gs-panel-overlay-visible');
    await refreshPanelList();
  }

  function closePanel() {
    panelEl.classList.remove('gs-panel-open');
    overlayEl.classList.remove('gs-panel-overlay-visible');
  }

  function updatePanelCount(count) {
    const tabCount = document.getElementById('gs-tab-count');
    if (tabCount) tabCount.textContent = count;
  }

  async function refreshPanelCount() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SCREENED_OUT' });
      updatePanelCount(resp && resp.emails ? resp.emails.length : 0);
    } catch (err) {
      console.warn('[Gmail Screener] refreshPanelCount failed:', err);
    }
  }

  async function refreshPanelList() {
    const listEl = document.getElementById('gs-panel-list');
    const countEl = document.getElementById('gs-panel-count');
    const tabCount = document.getElementById('gs-tab-count');
    listEl.innerHTML = '<div class="gs-panel-empty">Loading\u2026</div>';

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SCREENED_OUT' });
      const emails = resp && resp.emails ? resp.emails : [];
      countEl.textContent = emails.length;
      if (tabCount) tabCount.textContent = emails.length;

      if (emails.length === 0) {
        listEl.innerHTML = '<div class="gs-panel-empty">No screened-out senders yet.</div>';
        return;
      }

      listEl.innerHTML = '';
      const sorted = [...emails].sort();
      for (const email of sorted) {
        const row = document.createElement('div');
        row.className = 'gs-panel-row';

        const label = document.createElement('span');
        label.className = 'gs-panel-email';
        if (email.startsWith('@')) label.classList.add('gs-panel-domain');
        label.textContent = email;
        row.appendChild(label);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'gs-panel-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.title = 'Delete Gmail filter for ' + email;
        removeBtn.addEventListener('click', async () => {
          removeBtn.disabled = true;
          removeBtn.textContent = '\u2026';
          try {
            await chrome.runtime.sendMessage({ type: 'REMOVE_SCREENED_OUT', email });
            await refreshPanelList();
            location.reload();
          } catch (err) {
            console.warn('[Gmail Screener] Remove sender failed:', err);
            removeBtn.disabled = false;
            removeBtn.textContent = 'Remove';
          }
        });
        row.appendChild(removeBtn);

        listEl.appendChild(row);
      }
    } catch (err) {
      listEl.innerHTML = '<div class="gs-panel-empty">Failed to load.</div>';
    }
  }

  // ============================================================
  // Bottom bar + drawer
  // ============================================================

  let bottomBarEl = null;
  let bottomDrawerEl = null;
  let activeDrawerTab = null; // 'ReplyLater' or 'SetAside'

  function createBottomBar() {
    if (bottomBarEl) return;

    bottomBarEl = document.createElement('div');
    bottomBarEl.className = 'gs-bottom-bar';

    const replyTab = document.createElement('button');
    replyTab.className = 'gs-bottom-tab gs-bottom-tab-reply';
    replyTab.innerHTML = ICON_SCHEDULE + ' Reply Later <span class="gs-bottom-count" id="gs-reply-count">0</span>';
    replyTab.addEventListener('click', () => toggleDrawer('ReplyLater'));
    bottomBarEl.appendChild(replyTab);

    const setAsideTab = document.createElement('button');
    setAsideTab.className = 'gs-bottom-tab gs-bottom-tab-aside';
    setAsideTab.innerHTML = ICON_BOOKMARK + ' Set Aside <span class="gs-bottom-count" id="gs-aside-count">0</span>';
    setAsideTab.addEventListener('click', () => toggleDrawer('SetAside'));
    bottomBarEl.appendChild(setAsideTab);

    document.body.appendChild(bottomBarEl);

    // Drawer
    bottomDrawerEl = document.createElement('div');
    bottomDrawerEl.className = 'gs-bottom-drawer';
    bottomDrawerEl.innerHTML =
      '<div class="gs-drawer-header">' +
        '<span class="gs-drawer-title" id="gs-drawer-title">Reply Later</span>' +
        '<button class="gs-drawer-close" title="Close">\u00d7</button>' +
      '</div>' +
      '<div class="gs-drawer-list" id="gs-drawer-list">' +
        '<div class="gs-panel-empty">Loading\u2026</div>' +
      '</div>';
    document.body.appendChild(bottomDrawerEl);

    bottomDrawerEl.querySelector('.gs-drawer-close').addEventListener('click', closeDrawer);

    refreshBottomBarCounts();
  }

  function toggleDrawer(labelName) {
    if (activeDrawerTab === labelName && bottomDrawerEl.classList.contains('gs-drawer-open')) {
      closeDrawer();
    } else {
      openDrawer(labelName);
    }
  }

  async function openDrawer(labelName) {
    activeDrawerTab = labelName;
    const title = labelName === 'ReplyLater' ? 'Reply Later' : 'Set Aside';
    document.getElementById('gs-drawer-title').textContent = title;

    // Update active tab styling
    bottomBarEl.querySelector('.gs-bottom-tab-reply').classList.toggle('gs-tab-active', labelName === 'ReplyLater');
    bottomBarEl.querySelector('.gs-bottom-tab-aside').classList.toggle('gs-tab-active', labelName === 'SetAside');

    bottomDrawerEl.classList.add('gs-drawer-open');
    await refreshDrawerList(labelName);
  }

  function closeDrawer() {
    activeDrawerTab = null;
    bottomDrawerEl.classList.remove('gs-drawer-open');
    bottomBarEl.querySelector('.gs-bottom-tab-reply').classList.remove('gs-tab-active');
    bottomBarEl.querySelector('.gs-bottom-tab-aside').classList.remove('gs-tab-active');
  }

  async function refreshBottomBarCounts() {
    try {
      const [replyResp, asideResp] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_LABELED_THREADS', labelName: 'ReplyLater' }),
        chrome.runtime.sendMessage({ type: 'GET_LABELED_THREADS', labelName: 'SetAside' }),
      ]);
      const replyCount = document.getElementById('gs-reply-count');
      const asideCount = document.getElementById('gs-aside-count');
      if (replyCount) replyCount.textContent = (replyResp?.threads || []).length;
      if (asideCount) asideCount.textContent = (asideResp?.threads || []).length;
    } catch (err) {
      console.warn('[Gmail Screener] refreshBottomBarCounts failed:', err);
    }
  }

  function formatFrom(fromHeader) {
    // "John Doe <john@example.com>" → "John Doe"
    const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
    if (match) return match[1].trim();
    return fromHeader;
  }

  function formatDate(dateStr) {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (_) {
      return dateStr;
    }
  }

  async function refreshDrawerList(labelName) {
    const listEl = document.getElementById('gs-drawer-list');
    listEl.innerHTML = '<div class="gs-panel-empty">Loading\u2026</div>';

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_LABELED_THREADS', labelName });
      const threads = resp?.threads || [];

      if (threads.length === 0) {
        const emptyLabel = labelName === 'ReplyLater' ? 'reply later' : 'set aside';
        listEl.innerHTML = `<div class="gs-panel-empty">No ${emptyLabel} messages.</div>`;
        return;
      }

      listEl.innerHTML = '';
      for (const t of threads) {
        const row = document.createElement('div');
        row.className = 'gs-drawer-row';

        const info = document.createElement('a');
        info.className = 'gs-drawer-info';
        info.href = `#inbox/${t.threadId}`;
        info.addEventListener('click', (e) => {
          e.preventDefault();
          window.location.hash = `#inbox/${t.threadId}`;
          closeDrawer();
        });

        const sender = document.createElement('span');
        sender.className = 'gs-drawer-sender';
        sender.textContent = formatFrom(t.from);
        info.appendChild(sender);

        const subject = document.createElement('span');
        subject.className = 'gs-drawer-subject';
        subject.textContent = t.subject || '(no subject)';
        info.appendChild(subject);

        const snippet = document.createElement('span');
        snippet.className = 'gs-drawer-snippet';
        snippet.textContent = t.snippet;
        info.appendChild(snippet);

        row.appendChild(info);

        const meta = document.createElement('div');
        meta.className = 'gs-drawer-meta';

        const date = document.createElement('span');
        date.className = 'gs-drawer-date';
        date.textContent = formatDate(t.date);
        meta.appendChild(date);

        const moveBtn = document.createElement('button');
        moveBtn.className = 'gs-drawer-move';
        moveBtn.textContent = 'Move to Inbox';
        moveBtn.addEventListener('click', async () => {
          moveBtn.disabled = true;
          moveBtn.textContent = '\u2026';
          try {
            await chrome.runtime.sendMessage({
              type: 'MOVE_BACK',
              labelName,
              threadIds: [t.threadId],
            });
            await refreshDrawerList(labelName);
            refreshBottomBarCounts();
            showToast('Moved back to inbox', 'success');
          } catch (err) {
            moveBtn.disabled = false;
            moveBtn.textContent = 'Move to Inbox';
            showToast(`Error: ${err.message}`, 'error');
          }
        });
        meta.appendChild(moveBtn);

        row.appendChild(meta);
        listEl.appendChild(row);
      }
    } catch (err) {
      listEl.innerHTML = '<div class="gs-panel-empty">Failed to load.</div>';
    }
  }

  // ============================================================
  // Row processing
  // ============================================================

  function processRow(row) {
    const email = extractSenderEmail(row);
    if (!email) return;

    const view = getCurrentView();
    if (view === 'inbox' || view === 'screenout') {
      if (!row.querySelector('.gs-trigger')) {
        injectButton(row, email, view);
      }
      if (!row.querySelector('.gs-triage-trigger')) {
        injectTriageButton(row, view);
      }
    }

    row.classList.add('gs-has-action');
  }

  function getInboxRows() {
    const rows = document.querySelectorAll('tr.zA');
    if (rows.length > 0) return Array.from(rows);
    const main = document.querySelector('div[role="main"]');
    if (main) return Array.from(main.querySelectorAll('tr'));
    return [];
  }

  function processAllVisible() {
    for (const row of getInboxRows()) {
      processRow(row);
    }
  }

  // ============================================================
  // DOM observation
  // ============================================================

  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processAllVisible, 250);
    });

    const root = document.querySelector('div[role="main"]') || document.body;
    observer.observe(root, { childList: true, subtree: true });
  }

  // Periodic scan to catch rows the MutationObserver misses
  // (Gmail aggressively re-renders unread/top rows)
  function startPeriodicScan() {
    if (periodicTimer) clearInterval(periodicTimer);
    periodicTimer = setInterval(processAllVisible, 2000);
  }

  // ============================================================
  // URL change detection (Gmail SPA)
  // ============================================================

  function watchUrlChanges() {
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(processAllVisible, 1000);
      }
    }, 500);
  }

  // ============================================================
  // Init
  // ============================================================

  async function init() {
    await checkAuth();
    createPanel();
    createBottomBar();
    startObserver();
    startPeriodicScan();
    watchUrlChanges();
    setTimeout(processAllVisible, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
