// options.js - Options page logic
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const authStatusEl = document.getElementById('auth-status');
  const signInBtn = document.getElementById('sign-in-btn');
  const blockedListEl = document.getElementById('blocked-list');
  const blockedCountEl = document.getElementById('blocked-count');

  // ---- Auth ----
  async function checkAuth() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' });
      if (resp && resp.authenticated) {
        authStatusEl.innerHTML =
          '<span class="dot dot-green"></span> Connected to Gmail';
        signInBtn.style.display = 'none';
        return true;
      }
    } catch (_) {}
    authStatusEl.innerHTML =
      '<span class="dot dot-red"></span> Not connected to Gmail';
    signInBtn.style.display = 'inline-block';
    return false;
  }

  signInBtn.addEventListener('click', async () => {
    signInBtn.disabled = true;
    signInBtn.textContent = 'Signing in\u2026';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
      if (resp && resp.success) {
        await checkAuth();
        await loadList();
      } else {
        authStatusEl.innerHTML =
          '<span class="dot dot-red"></span> Sign-in failed';
      }
    } catch (err) {
      authStatusEl.innerHTML =
        '<span class="dot dot-red"></span> Error: ' + err.message;
    }
    signInBtn.disabled = false;
    signInBtn.textContent = 'Sign in with Google';
  });

  // ---- Render screened-out list (from Gmail filters) ----
  async function loadList() {
    blockedListEl.innerHTML = '<div class="empty-state">Loading&hellip;</div>';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SCREENED_OUT' });
      const emails = resp && resp.emails ? resp.emails : [];
      renderList(emails);
    } catch (err) {
      blockedListEl.innerHTML =
        '<div class="empty-state">Failed to load: ' + err.message + '</div>';
    }
  }

  function renderList(emails) {
    blockedListEl.innerHTML = '';
    blockedCountEl.textContent = emails.length;

    if (emails.length === 0) {
      blockedListEl.innerHTML =
        '<div class="empty-state">No screened-out senders.</div>';
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
      removeBtn.textContent = 'Remove filter';
      removeBtn.title = `Delete the Gmail filter for ${email}`;
      removeBtn.addEventListener('click', () => removeSender(email));
      row.appendChild(removeBtn);

      blockedListEl.appendChild(row);
    }
  }

  async function removeSender(email) {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'REMOVE_SCREENED_OUT',
        email,
      });
      if (resp && resp.success) {
        await loadList();
      } else {
        alert('Failed to remove: ' + (resp?.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  // ---- Init ----
  checkAuth().then((authed) => {
    if (authed) loadList();
    else {
      blockedListEl.innerHTML =
        '<div class="empty-state">Sign in to view screened-out senders.</div>';
    }
  });
});
