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
    if (/label\/Screener\b/i.test(hash) && !/label\/Screenout/i.test(hash)) return 'screener';
    if (/label\/Screenout/i.test(hash)) return 'screenout';
    if (/label\/Set%20Aside/i.test(hash) || /label\/Set\+Aside/i.test(hash)) return 'setaside';
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

  function extractThreadId(row) {
    // Gmail rows have data-legacy-thread-id or we can get it from the checkbox
    const legacy = row.getAttribute('data-legacy-thread-id');
    if (legacy) return legacy;
    // Fallback: try to find message ID from the row's link
    const link = row.querySelector('a[id]');
    if (link && link.id) return link.id;
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
  const ICON_BLOCK = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 014 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0120 12c0 4.42-3.58 8-8 8z"/></svg>';
  const ICON_PERSON = '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  const ICON_GLOBE = '<svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 00-1.38-3.56A8.03 8.03 0 0118.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 015.08 16zm2.95-8H5.08a7.987 7.987 0 014.33-3.56A15.65 15.65 0 008.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
  const ICON_BOOKMARK = '<svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';

  // ============================================================
  // Dropdown menu
  // ============================================================

  let activeDropdown = null;

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

  // ============================================================
  // UI injection - context-aware buttons per view
  // ============================================================

  function injectButtons(row, email, view) {
    if (row.querySelector('.gs-trigger')) return;

    const domain = getDomain(email);
    const container = document.createElement('span');
    container.className = 'gs-trigger';

    if (view === 'screener') {
      // Screener view: Allow + Screen out + Set Aside
      const allowBtn = createIconBtn(ICON_CHECK, 'Allow sender', 'gs-btn-allow', () => {
        showTriageDropdown(row, email, domain, 'allow', container);
      });
      const blockBtn = createIconBtn(ICON_BLOCK, 'Screen out sender', 'gs-btn-screenout', () => {
        showTriageDropdown(row, email, domain, 'screenout', container);
      });
      const asideBtn = createIconBtn(ICON_BOOKMARK, 'Set aside', 'gs-btn-setaside', (e) => {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        handleSetAside(row);
      });
      container.appendChild(allowBtn);
      container.appendChild(blockBtn);
      container.appendChild(asideBtn);
    } else if (view === 'screenout') {
      // Screenout view: Screen in (unblock)
      const triggerBtn = createIconBtn(ICON_CHECK, 'Screen in sender', 'gs-btn-allow', () => {
        showTriageDropdown(row, email, domain, 'screenin', container);
      });
      container.appendChild(triggerBtn);
    } else if (view === 'inbox') {
      // Inbox view: Screen out + Set Aside
      const blockBtn = createIconBtn(ICON_BLOCK, 'Screen out sender', 'gs-btn-screenout', () => {
        showTriageDropdown(row, email, domain, 'screenout', container);
      });
      const asideBtn = createIconBtn(ICON_BOOKMARK, 'Set aside', 'gs-btn-setaside', (e) => {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        handleSetAside(row);
      });
      container.appendChild(blockBtn);
      container.appendChild(asideBtn);
    }

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
  // Triage dropdown
  // ============================================================

  function showTriageDropdown(row, email, domain, action, anchor) {
    closeActiveDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'gs-dropdown';

    let headerLabel, headerIcon;
    if (action === 'allow') {
      headerLabel = 'ALLOW'; headerIcon = ICON_CHECK;
    } else if (action === 'screenout') {
      headerLabel = 'SCREEN OUT'; headerIcon = ICON_BLOCK;
    } else {
      headerLabel = 'SCREEN IN'; headerIcon = ICON_CHECK;
    }

    // Header
    const header = document.createElement('div');
    header.className = 'gs-dropdown-header';
    header.innerHTML = headerIcon + ' ' + headerLabel;
    dropdown.appendChild(header);

    addDivider(dropdown);

    // Sender item
    const senderLabel = action === 'allow' ? 'Allow sender'
      : action === 'screenin' ? 'Screen in sender'
      : 'Screen out sender';
    const senderItem = createDropdownItem(ICON_PERSON, senderLabel, email, () => {
      closeActiveDropdown();
      if (action === 'allow') doAllow(email, row);
      else if (action === 'screenin') doScreenIn(email, row);
      else doScreenOut(email, row);
    });
    dropdown.appendChild(senderItem);

    // Domain item
    if (domain) {
      addDivider(dropdown);
      const domainLabel = action === 'allow' ? 'Allow domain'
        : action === 'screenin' ? 'Screen in domain'
        : 'Screen out domain';
      const domainItem = createDropdownItem(ICON_GLOBE, domainLabel, 'All from @' + domain, () => {
        closeActiveDropdown();
        if (action === 'allow') doAllow('@' + domain, row);
        else if (action === 'screenin') doScreenIn('@' + domain, row);
        else doScreenOut('@' + domain, row);
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
  // Action handlers
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
        const hiddenRows = hideMatchingRows(target);
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

  async function doScreenOut(target, row) {
    if (!(await ensureAuth())) return;
    disableRowBtns(row);

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SCREEN_OUT', target });
      if (resp && resp.success) {
        const hiddenRows = hideMatchingRows(target);
        showToast(`Screened out ${target}`, 'success', {
          action: 'Undo',
          onAction: () => undoScreenOut(target, hiddenRows, resp.movedIds),
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

  async function doScreenIn(target, row) {
    if (!(await ensureAuth())) return;
    disableRowBtns(row);

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SCREEN_IN', target });
      if (resp && resp.success) {
        hideMatchingRows(target);
        showToast(`Screened in ${target} — moved to inbox`, 'success');
      } else {
        showToast(`Failed: ${resp?.error || 'Unknown error'}`, 'error');
        enableRowBtns(row);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
      enableRowBtns(row);
    }
  }

  async function handleSetAside(row) {
    if (!(await ensureAuth())) return;
    disableRowBtns(row);

    // Get message IDs from the thread
    const threadId = extractThreadId(row);
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'SET_ASIDE',
        threadId: threadId || undefined,
        messageIds: threadId ? undefined : [],
      });
      if (resp && resp.success) {
        row.classList.add('gs-row-exit');
        setTimeout(() => { row.style.display = 'none'; }, 300);
        showToast('Set aside', 'success', {
          action: 'Undo',
          onAction: () => undoSetAside(resp.movedIds, [row]),
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

  async function undoAllow(target, hiddenRows, movedIds) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'UNDO_ALLOW', target, movedIds });
      if (resp && resp.success) {
        showRows(hiddenRows);
        showToast(`Undo: ${target} back in Screener`, 'success');
      } else {
        showToast('Undo failed', 'error');
      }
    } catch (err) {
      showToast(`Undo error: ${err.message}`, 'error');
    }
  }

  async function undoScreenOut(target, hiddenRows, movedIds) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'UNDO_SCREEN_OUT', target, movedIds });
      if (resp && resp.success) {
        showRows(hiddenRows);
        showToast(`Undo: ${target} back in Screener`, 'success');
      } else {
        showToast('Undo failed', 'error');
      }
    } catch (err) {
      showToast(`Undo error: ${err.message}`, 'error');
    }
  }

  async function undoSetAside(movedIds, hiddenRows) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'UNDO_SET_ASIDE', movedIds });
      if (resp && resp.success) {
        showRows(hiddenRows);
        showToast('Undo: moved back', 'success');
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
  // Row processing
  // ============================================================

  function processRow(row) {
    if (row.querySelector('.gs-trigger')) return;

    const email = extractSenderEmail(row);
    if (!email) return;

    const view = getCurrentView();
    if (view === 'screener' || view === 'screenout' || view === 'inbox') {
      injectButtons(row, email, view);
    }
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
        setTimeout(processAllVisible, 1000);
      }
    }, 500);
  }

  // ============================================================
  // Init
  // ============================================================

  async function init() {
    await checkAuth();
    await checkScreenerStatus();
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
