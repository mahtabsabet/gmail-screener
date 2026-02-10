// content.js - Content Script for Gmail Sender Screener (Screener Mode)
// Injected into https://mail.google.com/*
(function () {
  'use strict';

  let observer = null;
  let debounceTimer = null;
  let authenticated = false;
  let periodicTimer = null;
  let screenerEnabled = false;

  // ============================================================
  // View detection
  // ============================================================

  function getCurrentView() {
    const hash = location.hash || '';
    if (/label\/Screener\b/i.test(hash)) return 'screener';
    if (/label\/SetAside/i.test(hash)) return 'setaside';
    if (/label\/ReplyLater/i.test(hash)) return 'replylater';
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

  async function checkScreenerStatus() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      screenerEnabled = resp && resp.screenerEnabled;
    } catch (_) {
      screenerEnabled = false;
    }
  }

  // ============================================================
  // Sender extraction from DOM
  // ============================================================

  function extractSenderEmail(row) {
    for (const span of row.querySelectorAll('[email]')) {
      const email = span.getAttribute('email');
      if (email && email.includes('@')) return email.toLowerCase().trim();
    }
    for (const el of row.querySelectorAll('[data-hovercard-id]')) {
      const id = el.getAttribute('data-hovercard-id');
      if (id && id.includes('@')) return id.toLowerCase().trim();
    }
    return null;
  }

  // ============================================================
  // Thread ID extraction (improved, from main)
  // ============================================================

  function decimalToHex(decStr) {
    try {
      return BigInt(decStr).toString(16);
    } catch (_) {
      return decStr;
    }
  }

  function normalizeThreadId(raw) {
    if (!raw) return null;
    const threadFMatch = raw.match(/#thread-f:(\d+)/);
    if (threadFMatch) return decimalToHex(threadFMatch[1]);
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
  // UI helpers
  // ============================================================

  function getDomain(email) {
    const at = email.indexOf('@');
    return at !== -1 ? email.substring(at + 1) : null;
  }

  function escapeHtml(str) {
    const d = document.createElement('span');
    d.textContent = str;
    return d.innerHTML;
  }

  // SVG icons
  const ICON_PERSON = '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  const ICON_GLOBE = '<svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 00-1.38-3.56A8.03 8.03 0 0118.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 015.08 16zm2.95-8H5.08a7.987 7.987 0 014.33-3.56A15.65 15.65 0 008.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
  const ICON_REMOVE = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"/></svg>';
  const ICON_SCHEDULE = '<svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>';
  const ICON_BOOKMARK = '<svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
  const ICON_TRIAGE = '<svg viewBox="0 0 24 24"><path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z"/></svg>';
  const ICON_INBOX = '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5v-3h3.56c.69 1.19 1.97 2 3.45 2s2.75-.81 3.45-2H19v3zm0-5h-4.99c0 1.1-.9 2-2 2s-2-.9-2-2H5V5h14v9z"/></svg>';
  const ICON_FILTER = '<svg viewBox="0 0 24 24"><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/></svg>';

  // ============================================================
  // Dropdown menus
  // ============================================================

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
    if (e.key === 'Escape') closeActiveDropdown();
  }

  function closeActiveTriageDropdown() {
    if (activeTriageDropdown) {
      activeTriageDropdown.remove();
      activeTriageDropdown = null;
    }
  }

  // ============================================================
  // UI injection - context-aware buttons per view
  // ============================================================

  function injectButtons(row, email, view) {
    if (row.querySelector('.gs-trigger')) return;

    const domain = getDomain(email);
    const container = document.createElement('span');
    container.className = 'gs-trigger';

    if (view === 'screener') {
      // Screener label view: Allow button
      const allowBtn = createIconBtn(ICON_CHECK, 'Allow sender', 'gs-btn-allow', () => {
        showAllowDropdown(row, email, domain, container);
      });
      container.appendChild(allowBtn);
    } else if (view === 'inbox') {
      // Inbox view: button depends on filter mode
      if (gsFilterMode === 'screened') {
        // Screened In tab: Remove (un-allow) button
        const removeBtn = createIconBtn(ICON_REMOVE, 'Remove sender', 'gs-btn-remove', () => {
          showRemoveDropdown(row, email, domain, container);
        });
        container.appendChild(removeBtn);
      } else if (gsFilterMode === 'screener') {
        // Screener tab: Allow button
        const allowBtn = createIconBtn(ICON_CHECK, 'Allow sender', 'gs-btn-allow', () => {
          showAllowDropdown(row, email, domain, container);
        });
        container.appendChild(allowBtn);
      }
      // All Mail tab (gsFilterMode === null): no buttons
    }

    // Only append if we added buttons
    if (container.children.length === 0) return;

    const senderCell =
      row.querySelector('td.yX') ||
      row.querySelector('[email]')?.closest('td') ||
      row.querySelector('td:nth-child(4)') ||
      row.querySelector('td:nth-child(3)');
    if (senderCell) {
      senderCell.style.position = 'relative';
      senderCell.appendChild(container);
    }
  }

  function createIconBtn(iconSvg, title, extraClass, onClick) {
    const btn = document.createElement('button');
    btn.className = 'gs-trigger-btn' + (extraClass ? ' ' + extraClass : '');
    btn.title = title;
    btn.innerHTML = iconSvg;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      onClick(e);
    });
    return btn;
  }

  // ============================================================
  // Triage button (Reply Later / Set Aside) - from main
  // ============================================================

  function injectTriageButton(row, view) {
    if (view !== 'inbox' && view !== 'screener') return;
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

  // ============================================================
  // Allow dropdown
  // ============================================================

  function showAllowDropdown(row, email, domain, anchor) {
    closeActiveDropdown();
    closeActiveTriageDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'gs-dropdown';

    const header = document.createElement('div');
    header.className = 'gs-dropdown-header';
    header.innerHTML = ICON_CHECK + ' ALLOW';
    dropdown.appendChild(header);

    addDivider(dropdown);

    const senderItem = createDropdownItem(ICON_PERSON, 'Allow sender', email, () => {
      closeActiveDropdown();
      doAllow(email, row);
    });
    dropdown.appendChild(senderItem);

    if (domain) {
      addDivider(dropdown);
      const domainItem = createDropdownItem(ICON_GLOBE, 'Allow domain', 'All from @' + domain, () => {
        closeActiveDropdown();
        doAllow('@' + domain, row);
      });
      dropdown.appendChild(domainItem);
    }

    anchor.style.position = 'relative';
    anchor.appendChild(dropdown);
    activeDropdown = dropdown;

    setTimeout(() => {
      document.addEventListener('click', onDocumentClick, true);
      document.addEventListener('keydown', onEscapeKey, true);
    }, 0);
  }

  // ============================================================
  // Remove (un-allow) dropdown
  // ============================================================

  function showRemoveDropdown(row, email, domain, anchor) {
    closeActiveDropdown();
    closeActiveTriageDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'gs-dropdown';

    const header = document.createElement('div');
    header.className = 'gs-dropdown-header';
    header.innerHTML = ICON_REMOVE + ' REMOVE';
    dropdown.appendChild(header);

    addDivider(dropdown);

    const senderItem = createDropdownItem(ICON_PERSON, 'Remove sender', email, () => {
      closeActiveDropdown();
      doRemoveAllowed(email, row);
    });
    dropdown.appendChild(senderItem);

    if (domain) {
      addDivider(dropdown);
      const domainItem = createDropdownItem(ICON_GLOBE, 'Remove domain', 'All from @' + domain, () => {
        closeActiveDropdown();
        doRemoveAllowed('@' + domain, row);
      });
      dropdown.appendChild(domainItem);
    }

    anchor.style.position = 'relative';
    anchor.appendChild(dropdown);
    activeDropdown = dropdown;

    setTimeout(() => {
      document.addEventListener('click', onDocumentClick, true);
      document.addEventListener('keydown', onEscapeKey, true);
    }, 0);
  }

  // ============================================================
  // Triage dropdown (Reply Later / Set Aside) - from main
  // ============================================================

  function showTriageDropdown(row, threadId, anchor) {
    closeActiveDropdown();
    closeActiveTriageDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'gs-dropdown';

    const header = document.createElement('div');
    header.className = 'gs-dropdown-header';
    header.innerHTML = ICON_TRIAGE + ' TRIAGE';
    dropdown.appendChild(header);

    const div1 = document.createElement('div');
    div1.className = 'gs-dropdown-divider';
    dropdown.appendChild(div1);

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

    const div2 = document.createElement('div');
    div2.className = 'gs-dropdown-divider';
    dropdown.appendChild(div2);

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

  // ============================================================
  // Shared dropdown helpers
  // ============================================================

  function addDivider(parent) {
    const d = document.createElement('div');
    d.className = 'gs-dropdown-divider';
    parent.appendChild(d);
  }

  function createDropdownItem(iconSvg, label, sub, onClick) {
    const item = document.createElement('button');
    item.className = 'gs-dropdown-item';
    item.innerHTML =
      '<span class="gs-dropdown-icon">' + iconSvg + '</span>' +
      '<span><span class="gs-dropdown-label">' + escapeHtml(label) + '</span><br>' +
      '<span class="gs-dropdown-sub">' + escapeHtml(sub) + '</span></span>';
    item.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      onClick();
    });
    return item;
  }

  // ============================================================
  // Screener action handlers
  // ============================================================

  function rowMatchesTarget(rowEmail, target) {
    if (!rowEmail) return false;
    if (target.startsWith('@')) return rowEmail.endsWith(target);
    return rowEmail === target;
  }

  function hideMatchingRows(target) {
    const rows = getVisibleRows();
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

  function findMatchingRows(target) {
    const all = document.querySelectorAll('tr.zA');
    const matched = [];
    for (const r of all) {
      const rowEmail = extractSenderEmail(r);
      if (rowMatchesTarget(rowEmail, target)) matched.push(r);
    }
    return matched;
  }

  function showRows(hiddenRows) {
    for (const r of hiddenRows) {
      r.style.display = '';
      r.classList.remove('gs-row-exit');
    }
  }

  async function doAllow(target, row) {
    if (!(await ensureAuth())) return;
    disableRowBtns(row);

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'ALLOW', target });
      if (resp && resp.success) {
        invalidateAllowedCache();
        await filterInboxRows();
        const hiddenRows = findMatchingRows(target);
        showToast(`Allowed ${target}`, 'success', {
          action: 'Undo',
          onAction: () => undoAllow(target, hiddenRows, resp.movedIds),
        });
      } else {
        showToast(`Failed: ${resp?.error || 'Unknown error'}`, 'error');
        enableRowBtns(row);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
      enableRowBtns(row);
    }
  }

  async function doRemoveAllowed(target, row) {
    if (!(await ensureAuth())) return;
    disableRowBtns(row);

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'REMOVE_ALLOWED', email: target });
      if (resp && resp.success) {
        invalidateAllowedCache();
        await filterInboxRows();
        showToast(`Removed ${target}`, 'success');
      } else {
        showToast(`Failed: ${resp?.error || 'Unknown error'}`, 'error');
        enableRowBtns(row);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
      enableRowBtns(row);
    }
  }

  async function undoAllow(target, hiddenRows, movedIds) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'UNDO_ALLOW', target, movedIds });
      if (resp && resp.success) {
        invalidateAllowedCache();
        showRows(hiddenRows);
        showToast(`Undo: ${target} back in Screener`, 'success');
      } else {
        showToast('Undo failed', 'error');
      }
    } catch (err) {
      showToast(`Undo error: ${err.message}`, 'error');
    }
  }

  function disableRowBtns(row) {
    for (const b of row.querySelectorAll('.gs-trigger-btn')) b.disabled = true;
  }
  function enableRowBtns(row) {
    for (const b of row.querySelectorAll('.gs-trigger-btn')) b.disabled = false;
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
  // Bottom bar + drawer (Reply Later / Set Aside) - from main
  // ============================================================

  let bottomBarEl = null;
  let bottomDrawerEl = null;
  let activeDrawerTab = null;

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

  let _countRefreshTimer = null;
  function refreshBottomBarCounts() {
    // Debounce: coalesce rapid calls into one (500ms)
    if (_countRefreshTimer) clearTimeout(_countRefreshTimer);
    _countRefreshTimer = setTimeout(_doRefreshBottomBarCounts, 500);
  }

  async function _doRefreshBottomBarCounts() {
    _countRefreshTimer = null;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_LABEL_COUNTS' });
      const replyCount = document.getElementById('gs-reply-count');
      const asideCount = document.getElementById('gs-aside-count');
      if (replyCount) replyCount.textContent = resp?.replyLater || 0;
      if (asideCount) asideCount.textContent = resp?.setAside || 0;
    } catch (err) {
      console.warn('[Gmail Screener] refreshBottomBarCounts failed:', err);
    }
  }

  function formatFrom(fromHeader) {
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
    if (view === 'screener' || view === 'inbox') {
      // Remove stale buttons if filter mode changed
      const existing = row.querySelector('.gs-trigger');
      if (existing) {
        const hasAllow = existing.querySelector('.gs-btn-allow');
        const hasRemove = existing.querySelector('.gs-btn-remove');
        const needsAllow = gsFilterMode === 'screener' || view === 'screener';
        const needsRemove = gsFilterMode === 'screened';
        if ((needsAllow && !hasAllow) || (needsRemove && !hasRemove) ||
            (!needsAllow && !needsRemove && (hasAllow || hasRemove))) {
          existing.remove();
        }
      }

      if (!row.querySelector('.gs-trigger')) {
        injectButtons(row, email, view);
      }
      if (!row.querySelector('.gs-triage-trigger')) {
        injectTriageButton(row, view);
      }
    }

    row.classList.add('gs-has-action');
  }

  function getVisibleRows() {
    const rows = document.querySelectorAll('tr.zA');
    if (rows.length > 0) return Array.from(rows);
    const main = document.querySelector('div[role="main"]');
    if (main) return Array.from(main.querySelectorAll('tr'));
    return [];
  }

  function processAllVisible() {
    for (const row of getVisibleRows()) {
      processRow(row);
    }
    // Re-apply filter if in screened or screener mode (new rows may have appeared)
    if (gsFilterMode === 'screened' || gsFilterMode === 'screener') {
      filterInboxRows();
    }
    // Ensure tabs are injected
    injectTabs();
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
        // Reset filter mode on navigation
        if (gsFilterMode) clearInboxFilter();
        setTimeout(() => {
          processAllVisible();
          injectTabs();
          // Auto-activate Screened In when navigating back to inbox
          if (getCurrentView() === 'inbox' && !gsFilterMode) {
            activateScreenedFilter();
          }
        }, 1000);
      }
    }, 500);
  }

  // ============================================================
  // Custom tabs + inbox filtering
  // ============================================================

  let gsFilterMode = null; // null = All Mail, 'screened' = Screened In, 'screener' = Screener
  let gsAllowedCache = null; // { emails: Set, ts }
  const GS_ALLOWED_CACHE_TTL = 30 * 1000; // 30s
  let screenedTabEl = null;
  let screenerTabEl = null;
  let allMailTabEl = null;

  /**
   * Find Gmail's category tab bar and inject our custom tabs.
   * Hides native Gmail tabs and shows: Screened In, Screener, All Mail.
   *
   * Gmail's tab DOM structure:
   *   tr[role="tablist"]                    ← the tab row
   *     td.aRz[role="heading"]             ← each tab cell (Primary, etc.)
   *       div.aAy[role="tab"]              ← clickable tab
   *     td.aRy                             ← "+" button cell
   */
  function injectTabs() {
    if (!screenerEnabled) return;
    const view = getCurrentView();
    if (view !== 'inbox') return;

    // Already injected and still in DOM?
    if (screenedTabEl && document.contains(screenedTabEl)) return;

    // Find the tab row: tr[role="tablist"]
    const tabRow = document.querySelector('tr[role="tablist"]');
    if (!tabRow) return;

    // Hide all native Gmail tabs
    const nativeCells = tabRow.querySelectorAll('td.aRz, td[role="heading"], td.aRy');
    for (const cell of nativeCells) {
      if (!cell.classList.contains('gs-screened-td') &&
          !cell.classList.contains('gs-screener-td') &&
          !cell.classList.contains('gs-allmail-td')) {
        cell.style.display = 'none';
      }
    }

    // Create the three tabs
    screenedTabEl = createTab('gs-screened-td', 'gs-screened-tab', ICON_CHECK, 'Screened In', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activateScreenedFilter();
    });

    screenerTabEl = createTab('gs-screener-td', 'gs-screener-tab', ICON_FILTER, 'Screener', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activateScreenerFilter();
    });

    allMailTabEl = createTab('gs-allmail-td', 'gs-allmail-tab', ICON_INBOX, 'All Mail', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearInboxFilter();
    });

    // Insert our tabs at the beginning
    const firstCell = tabRow.querySelector('td');
    tabRow.insertBefore(allMailTabEl, firstCell);
    tabRow.insertBefore(screenerTabEl, allMailTabEl);
    tabRow.insertBefore(screenedTabEl, screenerTabEl);

    // Auto-activate Screened In on first injection
    if (!gsFilterMode) {
      activateScreenedFilter();
    }
  }

  function createTab(tdClass, tabClass, icon, label, onClick) {
    const td = document.createElement('td');
    td.className = 'aRz J-KU ' + tdClass;
    td.setAttribute('role', 'heading');
    td.setAttribute('aria-level', '3');
    td.style.userSelect = 'none';

    const tabDiv = document.createElement('div');
    tabDiv.className = tabClass;
    tabDiv.setAttribute('role', 'tab');
    tabDiv.setAttribute('tabindex', '0');
    tabDiv.setAttribute('aria-selected', 'false');
    tabDiv.setAttribute('aria-label', label);
    tabDiv.style.userSelect = 'none';

    tabDiv.innerHTML =
      '<div class="gs-tab-inner">' +
        '<span class="gs-tab-icon">' + icon + '</span>' +
        '<span class="gs-tab-label">' + label + '</span>' +
      '</div>';

    td.appendChild(tabDiv);
    tabDiv.addEventListener('click', onClick);

    return td;
  }

  async function getOrFetchAllowed() {
    if (gsAllowedCache && (Date.now() - gsAllowedCache.ts) < GS_ALLOWED_CACHE_TTL) {
      return gsAllowedCache.emails;
    }
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_ALLOWED' });
      const emails = new Set((resp?.emails || []).map((e) => e.toLowerCase()));
      gsAllowedCache = { emails, ts: Date.now() };
      return emails;
    } catch (err) {
      console.warn('[Gmail Screener] Failed to fetch allowed list:', err);
      return gsAllowedCache?.emails || new Set();
    }
  }

  function invalidateAllowedCache() {
    gsAllowedCache = null;
  }

  function setActiveTab(activeEl) {
    // Deactivate all custom tabs
    for (const el of [screenedTabEl, screenerTabEl, allMailTabEl]) {
      if (!el) continue;
      const tabDiv = el.querySelector('div[role="tab"]');
      if (tabDiv) {
        tabDiv.classList.remove('gs-tab-active');
        tabDiv.setAttribute('aria-selected', 'false');
      }
    }
    // Activate the specified tab
    if (activeEl) {
      const tabDiv = activeEl.querySelector('div[role="tab"]');
      if (tabDiv) {
        tabDiv.classList.add('gs-tab-active');
        tabDiv.setAttribute('aria-selected', 'true');
      }
    }
  }

  async function activateScreenedFilter() {
    gsFilterMode = 'screened';
    document.body.classList.add('gs-filter-screened');
    document.body.classList.remove('gs-filter-screener');
    setActiveTab(screenedTabEl);
    // Clear stale buttons and re-inject for new mode
    clearAllTriggerButtons();
    await filterInboxRows();
  }

  async function activateScreenerFilter() {
    gsFilterMode = 'screener';
    document.body.classList.remove('gs-filter-screened');
    document.body.classList.add('gs-filter-screener');
    setActiveTab(screenerTabEl);
    clearAllTriggerButtons();
    await filterInboxRows();
  }

  function clearInboxFilter() {
    gsFilterMode = null;
    document.body.classList.remove('gs-filter-screened');
    document.body.classList.remove('gs-filter-screener');
    setActiveTab(allMailTabEl);

    // Show all filtered rows
    const filtered = document.querySelectorAll('tr.gs-filtered');
    for (const row of filtered) {
      row.style.display = '';
      row.classList.remove('gs-filtered');
    }

    // Clear buttons (All Mail has no buttons)
    clearAllTriggerButtons();
  }

  function clearAllTriggerButtons() {
    for (const el of document.querySelectorAll('.gs-trigger')) {
      el.remove();
    }
  }

  async function filterInboxRows() {
    const allowed = await getOrFetchAllowed();

    for (const row of getVisibleRows()) {
      const email = extractSenderEmail(row);
      if (!email) continue;

      const emailLower = email.toLowerCase();
      const domain = getDomain(emailLower);
      const isAllowed = allowed.has(emailLower) || (domain && allowed.has('@' + domain));

      if (gsFilterMode === 'screened') {
        // Screened In: show only allowed senders
        if (isAllowed) {
          row.style.display = '';
          row.classList.remove('gs-filtered');
        } else {
          row.style.display = 'none';
          row.classList.add('gs-filtered');
        }
      } else if (gsFilterMode === 'screener') {
        // Screener: show only non-allowed senders
        if (!isAllowed) {
          row.style.display = '';
          row.classList.remove('gs-filtered');
        } else {
          row.style.display = 'none';
          row.classList.add('gs-filtered');
        }
      }

      // Re-inject buttons for visible rows
      if (row.style.display !== 'none' && !row.querySelector('.gs-trigger')) {
        processRow(row);
      }
    }
  }

  // ============================================================
  // Init
  // ============================================================

  async function init() {
    await checkAuth();
    await checkScreenerStatus();
    createBottomBar();
    startObserver();
    startPeriodicScan();
    watchUrlChanges();
    setTimeout(processAllVisible, 2000);
    // Gmail's tab bar loads async, retry injection a few times
    setTimeout(() => {
      injectTabs();
    }, 3000);
    setTimeout(() => {
      injectTabs();
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
