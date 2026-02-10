// content.js - Content Script for Gmail Sender Screener
// Injected into https://mail.google.com/*
(function () {
  'use strict';

  let processedRows = new WeakSet(); // only used to avoid redundant extractSenderEmail calls
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
    } catch (_) {
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
  // UI injection
  // ============================================================

  function getDomain(email) {
    const at = email.indexOf('@');
    return at !== -1 ? email.substring(at + 1) : null;
  }

  function injectButton(row, email, view) {
    if (row.querySelector('.gs-actions')) return;

    const domain = getDomain(email);
    const container = document.createElement('span');
    container.className = 'gs-actions';

    if (view === 'screenout') {
      const emailBtn = document.createElement('button');
      emailBtn.className = 'gs-action-btn gs-screen-in';
      emailBtn.textContent = 'Screen in';
      emailBtn.title = `Screen in ${email}`;
      emailBtn.addEventListener('click', handleClick(() => handleScreenIn(email, row, email)));
      container.appendChild(emailBtn);

      if (domain) {
        const domainBtn = document.createElement('button');
        domainBtn.className = 'gs-action-btn gs-screen-in gs-domain-btn';
        domainBtn.textContent = `@${domain}`;
        domainBtn.title = `Screen in all of @${domain}`;
        domainBtn.addEventListener('click', handleClick(() => handleScreenIn(`@${domain}`, row, email)));
        container.appendChild(domainBtn);
      }
    } else {
      const emailBtn = document.createElement('button');
      emailBtn.className = 'gs-action-btn gs-screen-out';
      emailBtn.textContent = 'Screen out';
      emailBtn.title = `Screen out ${email}`;
      emailBtn.addEventListener('click', handleClick(() => handleScreenOut(email, row, email)));
      container.appendChild(emailBtn);

      if (domain) {
        const domainBtn = document.createElement('button');
        domainBtn.className = 'gs-action-btn gs-screen-out gs-domain-btn';
        domainBtn.textContent = `@${domain}`;
        domainBtn.title = `Screen out all of @${domain}`;
        domainBtn.addEventListener('click', handleClick(() => handleScreenOut(`@${domain}`, row, email)));
        container.appendChild(domainBtn);
      }
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

  function handleClick(fn) {
    return function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      fn();
    };
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

  async function handleScreenOut(target, row, rowEmail) {
    if (!(await ensureAuth())) return;

    const btns = row.querySelectorAll('.gs-action-btn');
    for (const b of btns) { b.disabled = true; }

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SCREEN_OUT', target });
      if (resp && resp.success) {
        const hiddenRows = hideMatchingRows(target);

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

  async function handleScreenIn(target, row, rowEmail) {
    if (!(await ensureAuth())) return;

    const btns = row.querySelectorAll('.gs-action-btn');
    for (const b of btns) { b.disabled = true; }

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SCREEN_IN', target });
      if (resp && resp.success) {
        hideMatchingRows(target);
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
        showToast(`Undo successful for ${target}`, 'success');
      } else {
        showToast(`Undo failed: ${resp?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      showToast(`Undo error: ${err.message}`, 'error');
    }
  }

  function resetButton(btn, label) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = label;
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
    // Always check if buttons are present — Gmail frequently re-renders rows
    if (row.querySelector('.gs-actions')) return;

    const email = extractSenderEmail(row);
    if (!email) return;

    const view = getCurrentView();
    if (view === 'inbox' || view === 'screenout') {
      injectButton(row, email, view);
    }
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

    observer.observe(document.body, { childList: true, subtree: true });
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
