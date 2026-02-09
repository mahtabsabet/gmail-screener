// content.js - Content Script for Gmail Sender Screener
// Injected into https://mail.google.com/*
(function () {
  'use strict';

  // ============================================================
  // State
  // ============================================================

  let allowedEmails = new Set();
  let blockedEmails = new Set();
  const processedRows = new WeakSet();
  let observer = null;
  let debounceTimer = null;
  let authenticated = false;

  // ============================================================
  // Storage: load & watch sender lists
  // ============================================================

  function loadSenderLists() {
    chrome.storage.sync.get(['allowedEmails', 'blockedEmails'], (data) => {
      allowedEmails = new Set((data.allowedEmails || []).map((e) => e.toLowerCase()));
      blockedEmails = new Set((data.blockedEmails || []).map((e) => e.toLowerCase()));
      reprocessAllRows();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let changed = false;
    if (changes.allowedEmails) {
      allowedEmails = new Set(
        (changes.allowedEmails.newValue || []).map((e) => e.toLowerCase())
      );
      changed = true;
    }
    if (changes.blockedEmails) {
      blockedEmails = new Set(
        (changes.blockedEmails.newValue || []).map((e) => e.toLowerCase())
      );
      changed = true;
    }
    if (changed) reprocessAllRows();
  });

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

  async function promptSignIn() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
      if (resp && resp.success) {
        authenticated = true;
        showToast('Signed in successfully.', 'success');
        reprocessAllRows();
      } else {
        showToast('Sign-in failed. Check the extension options.', 'error');
      }
    } catch (err) {
      showToast(`Sign-in error: ${err.message}`, 'error');
    }
  }

  // ============================================================
  // Sender extraction from DOM
  // ============================================================

  function extractSenderEmail(row) {
    // Primary: <span email="user@example.com">
    const spans = row.querySelectorAll('[email]');
    for (const span of spans) {
      const email = span.getAttribute('email');
      if (email && email.includes('@')) {
        return email.toLowerCase().trim();
      }
    }

    // Fallback: data-hovercard-id
    const hovercards = row.querySelectorAll('[data-hovercard-id]');
    for (const el of hovercards) {
      const id = el.getAttribute('data-hovercard-id');
      if (id && id.includes('@')) {
        return id.toLowerCase().trim();
      }
    }

    return null;
  }

  // ============================================================
  // Sender status
  // ============================================================

  function getSenderStatus(email) {
    if (!email) return 'unknown';
    const lower = email.toLowerCase();
    if (allowedEmails.has(lower)) return 'allowed';
    if (blockedEmails.has(lower)) return 'blocked';
    return 'unknown';
  }

  // ============================================================
  // UI injection
  // ============================================================

  function injectScreeningUI(row, email) {
    if (row.querySelector('.gs-screening-ui')) return;

    // Find the sender cell
    const senderCell =
      row.querySelector('td.yX') ||
      row.querySelector('[email]')?.closest('td') ||
      row.querySelector('td:nth-child(4)') ||
      row.querySelector('td:nth-child(3)');
    if (!senderCell) return;

    const container = document.createElement('div');
    container.className = 'gs-screening-ui';
    container.dataset.email = email;

    // "New sender" badge
    const badge = document.createElement('span');
    badge.className = 'gs-badge';
    badge.textContent = 'New sender';
    container.appendChild(badge);

    // Action buttons (visible on row hover)
    const actions = document.createElement('span');
    actions.className = 'gs-actions';

    const allowBtn = document.createElement('button');
    allowBtn.className = 'gs-btn gs-allow';
    allowBtn.textContent = 'Allow';
    allowBtn.title = `Allow emails from ${email}`;
    allowBtn.addEventListener('click', handleClick((e) => handleAllow(email, row)));
    actions.appendChild(allowBtn);

    const screenOutBtn = document.createElement('button');
    screenOutBtn.className = 'gs-btn gs-screenout';
    screenOutBtn.textContent = 'Screen out';
    screenOutBtn.title = `Screen out emails from ${email}`;
    screenOutBtn.addEventListener('click', handleClick((e) => handleScreenOut(email, row)));
    actions.appendChild(screenOutBtn);

    container.appendChild(actions);

    // Insert after the sender name content
    senderCell.style.position = 'relative';
    senderCell.appendChild(container);

    // Also mark the row so we can style on hover
    row.classList.add('gs-has-screening');
  }

  /** Wrap a click handler to prevent Gmail from navigating */
  function handleClick(fn) {
    return function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      fn(e);
    };
  }

  function removeScreeningUI(row) {
    const ui = row.querySelector('.gs-screening-ui');
    if (ui) ui.remove();
    row.classList.remove('gs-has-screening');
  }

  // ============================================================
  // Sign-in banner
  // ============================================================

  let signInBannerShown = false;

  function showSignInBanner() {
    if (signInBannerShown) return;
    if (document.querySelector('.gs-signin-banner')) return;
    signInBannerShown = true;

    const banner = document.createElement('div');
    banner.className = 'gs-signin-banner';
    banner.innerHTML =
      '<span>Gmail Sender Screener needs permission to manage filters. </span>';

    const btn = document.createElement('button');
    btn.className = 'gs-btn gs-allow';
    btn.textContent = 'Sign in with Google';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      await promptSignIn();
      if (authenticated) {
        banner.remove();
      } else {
        btn.disabled = false;
        btn.textContent = 'Sign in with Google';
      }
    });
    banner.appendChild(btn);

    const dismiss = document.createElement('button');
    dismiss.className = 'gs-banner-dismiss';
    dismiss.textContent = '\u00d7';
    dismiss.title = 'Dismiss';
    dismiss.addEventListener('click', () => banner.remove());
    banner.appendChild(dismiss);

    // Insert at top of Gmail main content
    const target =
      document.querySelector('div[role="main"]') || document.body;
    target.prepend(banner);
  }

  // ============================================================
  // Action handlers
  // ============================================================

  async function handleAllow(email, row) {
    if (!authenticated) {
      await promptSignIn();
      if (!authenticated) return;
    }

    const ui = row.querySelector('.gs-screening-ui');
    if (ui) ui.classList.add('gs-processing');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ALLOW',
        email,
      });
      if (response && response.success) {
        removeScreeningUI(row);
        showToast(`Allowed ${email}`, 'success');
      } else {
        showToast(`Failed to allow sender: ${response?.error || 'Unknown error'}`, 'error');
        if (ui) ui.classList.remove('gs-processing');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
      if (ui) ui.classList.remove('gs-processing');
    }
  }

  async function handleScreenOut(email, row) {
    if (!authenticated) {
      await promptSignIn();
      if (!authenticated) return;
    }

    const ui = row.querySelector('.gs-screening-ui');
    if (ui) {
      ui.classList.add('gs-processing');
      const btn = ui.querySelector('.gs-screenout');
      if (btn) {
        btn.textContent = 'Screening\u2026';
        btn.disabled = true;
      }
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SCREEN_OUT',
        email,
      });
      if (response && response.success) {
        // Animate removal
        row.classList.add('gs-screened-out');
        setTimeout(() => {
          row.style.display = 'none';
        }, 300);

        showToast(`Screened out ${email}`, 'success', {
          action: 'Undo',
          onAction: () => handleUndo(email, row),
        });
      } else {
        showToast(
          `Failed to screen out: ${response?.error || 'Unknown error'}`,
          'error'
        );
        resetScreenOutButton(ui);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
      resetScreenOutButton(ui);
    }
  }

  function resetScreenOutButton(ui) {
    if (!ui) return;
    ui.classList.remove('gs-processing');
    const btn = ui.querySelector('.gs-screenout');
    if (btn) {
      btn.textContent = 'Screen out';
      btn.disabled = false;
    }
  }

  async function handleUndo(email, row) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UNDO_SCREEN_OUT',
        email,
      });
      if (response && response.success) {
        row.style.display = '';
        row.classList.remove('gs-screened-out');
        removeScreeningUI(row);
        processedRows.delete(row);
        processRow(row);
        showToast(`Undo successful for ${email}`, 'success');
      } else {
        showToast(`Undo failed: ${response?.error || 'Unknown error'}`, 'error');
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

    // Force reflow for CSS animation
    toast.offsetHeight; // eslint-disable-line no-unused-expressions
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

    const status = getSenderStatus(email);
    if (status === 'unknown') {
      injectScreeningUI(row, email);
    }
    // For 'allowed' or 'blocked' we don't show anything
  }

  function reprocessAllRows() {
    const rows = getInboxRows();
    for (const row of rows) {
      removeScreeningUI(row);
      processedRows.delete(row);
      processRow(row);
    }
  }

  function getInboxRows() {
    // Gmail message rows typically use <tr> with class zA
    const rows = document.querySelectorAll('tr.zA');
    if (rows.length > 0) return Array.from(rows);

    // Fallback: look for rows inside the main content area
    const main = document.querySelector('div[role="main"]');
    if (main) {
      return Array.from(main.querySelectorAll('tr'));
    }
    return [];
  }

  // ============================================================
  // DOM observation
  // ============================================================

  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const rows = getInboxRows();
        for (const row of rows) {
          processRow(row);
        }
      }, 250);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ============================================================
  // URL / view change detection (Gmail SPA)
  // ============================================================

  function watchUrlChanges() {
    let lastUrl = location.href;
    const check = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // View changed — re-scan after Gmail finishes rendering
        setTimeout(() => {
          const rows = getInboxRows();
          for (const row of rows) {
            if (!processedRows.has(row)) processRow(row);
          }
        }, 1000);
      }
    };
    setInterval(check, 500);
  }

  // ============================================================
  // Initialization
  // ============================================================

  async function init() {
    // Load sender lists from storage
    loadSenderLists();

    // Check auth
    const isAuthed = await checkAuth();
    if (!isAuthed) {
      // Show sign-in banner after Gmail renders
      setTimeout(showSignInBanner, 3000);
    }

    // Start observing DOM
    startObserver();

    // Watch for SPA navigation
    watchUrlChanges();

    // Initial row processing (Gmail may already be rendered)
    setTimeout(() => {
      const rows = getInboxRows();
      for (const row of rows) processRow(row);
    }, 2000);

    // Second pass for slower connections
    setTimeout(() => {
      const rows = getInboxRows();
      for (const row of rows) processRow(row);
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
