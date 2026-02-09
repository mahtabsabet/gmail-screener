// options.js - Options page logic
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const authStatusEl = document.getElementById('auth-status');
  const signInBtn = document.getElementById('sign-in-btn');
  const blockedListEl = document.getElementById('blocked-list');
  const allowedListEl = document.getElementById('allowed-list');
  const blockedCountEl = document.getElementById('blocked-count');
  const allowedCountEl = document.getElementById('allowed-count');
  const resetBtn = document.getElementById('reset-btn');

  // ---- Auth ----
  async function checkAuth() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' });
      if (resp && resp.authenticated) {
        authStatusEl.innerHTML =
          '<span class="dot dot-green"></span> Connected to Gmail';
        signInBtn.style.display = 'none';
      } else {
        authStatusEl.innerHTML =
          '<span class="dot dot-red"></span> Not connected to Gmail';
        signInBtn.style.display = 'inline-block';
      }
    } catch (_) {
      authStatusEl.innerHTML =
        '<span class="dot dot-red"></span> Unable to check connection';
      signInBtn.style.display = 'inline-block';
    }
  }

  signInBtn.addEventListener('click', async () => {
    signInBtn.disabled = true;
    signInBtn.textContent = 'Signing in\u2026';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
      if (resp && resp.success) {
        await checkAuth();
      } else {
        authStatusEl.innerHTML =
          '<span class="dot dot-red"></span> Sign-in failed: ' +
          (resp?.error || 'Unknown error');
      }
    } catch (err) {
      authStatusEl.innerHTML =
        '<span class="dot dot-red"></span> Error: ' + err.message;
    }
    signInBtn.disabled = false;
    signInBtn.textContent = 'Sign in with Google';
  });

  // ---- Render sender lists ----
  function renderList(container, emails, type) {
    container.innerHTML = '';
    const countEl = type === 'blocked' ? blockedCountEl : allowedCountEl;
    countEl.textContent = emails.length;

    if (emails.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent =
        type === 'blocked'
          ? 'No screened-out senders yet.'
          : 'No allowed senders yet.';
      container.appendChild(empty);
      return;
    }

    const sorted = [...emails].sort();
    for (const email of sorted) {
      const row = document.createElement('div');
      row.className = 'sender-row';

      const label = document.createElement('span');
      label.className = 'sender-email';
      label.textContent = email;
      row.appendChild(label);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-sm btn-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.title = `Remove ${email}`;
      removeBtn.addEventListener('click', () => removeSender(email, type));
      row.appendChild(removeBtn);

      container.appendChild(row);
    }
  }

  async function loadLists() {
    const data = await chrome.storage.sync.get([
      'allowedEmails',
      'blockedEmails',
    ]);
    renderList(blockedListEl, data.blockedEmails || [], 'blocked');
    renderList(allowedListEl, data.allowedEmails || [], 'allowed');
  }

  async function removeSender(email, type) {
    const msgType = type === 'blocked' ? 'REMOVE_BLOCKED' : 'REMOVE_ALLOWED';
    try {
      const resp = await chrome.runtime.sendMessage({ type: msgType, email });
      if (resp && resp.success) {
        await loadLists();
      } else {
        alert('Failed to remove sender: ' + (resp?.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  // ---- Reset ----
  resetBtn.addEventListener('click', async () => {
    if (
      !confirm(
        'This will clear all allowed and screened-out sender data from this extension.\n\n' +
          'Gmail filters already created will NOT be removed.\n\n' +
          'Continue?'
      )
    ) {
      return;
    }
    await chrome.storage.sync.set({
      allowedEmails: [],
      blockedEmails: [],
    });
    await chrome.storage.local.set({ filterMap: {} });
    await loadLists();
  });

  // ---- Watch for external changes ----
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.allowedEmails || changes.blockedEmails) {
        loadLists();
      }
    }
  });

  // ---- Init ----
  checkAuth();
  loadLists();
});
