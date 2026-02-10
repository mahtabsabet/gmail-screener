// content.js - Content Script for Gmail Sender Screener
// Injected into https://mail.google.com/*
(function () {
  'use strict';

  let processedRows = new WeakSet();
  let observer = null;
  let debounceTimer = null;
  let authenticated = false;

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

  function injectButton(row, email, view) {
    if (row.querySelector('.gs-action-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'gs-action-btn';

    if (view === 'screenout') {
      btn.classList.add('gs-screen-in');
      btn.textContent = 'Screen in';
      btn.title = `Move ${email} back to inbox and remove filter`;
      btn.addEventListener('click', handleClick(() => handleScreenIn(email, row)));
    } else {
      btn.classList.add('gs-screen-out');
      btn.textContent = 'Screen out';
      btn.title = `Screen out ${email} — skip inbox, send to Screenout`;
      btn.addEventListener('click', handleClick(() => handleScreenOut(email, row)));
    }

    // Find a good place to insert — end of sender cell or row
    const senderCell =
      row.querySelector('td.yX') ||
      row.querySelector('[email]')?.closest('td') ||
      row.querySelector('td:nth-child(4)') ||
      row.querySelector('td:nth-child(3)');
    if (senderCell) {
      senderCell.style.position = 'relative';
      senderCell.appendChild(btn);
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

  async function handleScreenOut(email, row) {
    if (!(await ensureAuth())) return;

    const btn = row.querySelector('.gs-action-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Screening\u2026';
    }

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SCREEN_OUT', email });
      if (resp && resp.success) {
        row.classList.add('gs-row-exit');
        setTimeout(() => { row.style.display = 'none'; }, 300);

        showToast(`Screened out ${email}`, 'success', {
          action: 'Undo',
          onAction: () => handleUndoScreenOut(email, row, resp.movedIds),
        });
      } else {
        showToast(`Failed: ${resp?.error || 'Unknown error'}`, 'error');
        resetButton(btn, 'Screen out');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
      resetButton(btn, 'Screen out');
    }
  }

  async function handleScreenIn(email, row) {
    if (!(await ensureAuth())) return;

    const btn = row.querySelector('.gs-action-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Moving\u2026';
    }

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SCREEN_IN', email });
      if (resp && resp.success) {
        row.classList.add('gs-row-exit');
        setTimeout(() => { row.style.display = 'none'; }, 300);
        showToast(`Screened in ${email} — moved to inbox`, 'success');
      } else {
        showToast(`Failed: ${resp?.error || 'Unknown error'}`, 'error');
        resetButton(btn, 'Screen in');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
      resetButton(btn, 'Screen in');
    }
  }

  async function handleUndoScreenOut(email, row, movedIds) {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'UNDO_SCREEN_OUT',
        email,
        movedIds,
      });
      if (resp && resp.success) {
        row.style.display = '';
        row.classList.remove('gs-row-exit');
        showToast(`Undo successful for ${email}`, 'success');
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
    if (processedRows.has(row)) return;
    processedRows.add(row);

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

  // ============================================================
  // URL change detection (Gmail SPA)
  // ============================================================

  function watchUrlChanges() {
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // View changed — clear processed set, re-scan after render
        processedRows = new WeakSet();
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
    watchUrlChanges();
    setTimeout(processAllVisible, 2000);
    setTimeout(processAllVisible, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
