// options.js - Options page logic (Screener Mode)
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const authStatusEl = document.getElementById('auth-status');
  const signInBtn = document.getElementById('sign-in-btn');
  const settingsCard = document.getElementById('settings-card');
  const allowedCard = document.getElementById('allowed-card');
  const screenoutCard = document.getElementById('screenout-card');
  const allowedListEl = document.getElementById('allowed-list');
  const allowedCountEl = document.getElementById('allowed-count');
  const blockedListEl = document.getElementById('blocked-list');
  const blockedCountEl = document.getElementById('blocked-count');
  const filterQueryInput = document.getElementById('filter-query');
  const sweepCapInput = document.getElementById('sweep-cap');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const saveStatusEl = document.getElementById('save-status');

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
    } catch (err) {
      console.warn('[Gmail Screener] Auth check failed:', err);
    }
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
        showSettings();
        await loadAllLists();
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

  // ---- Settings ----
  async function loadSettings() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      if (resp) {
        filterQueryInput.value = resp.filterQuery || '-is:chat';
        sweepCapInput.value = resp.sweepCap || 200;
      }
    } catch (err) {
      console.warn('[Gmail Screener] Load settings failed:', err);
    }
  }

  saveSettingsBtn.addEventListener('click', async () => {
    saveSettingsBtn.disabled = true;
    try {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        filterQuery: filterQueryInput.value.trim(),
        sweepCap: parseInt(sweepCapInput.value, 10) || 200,
      });
      saveStatusEl.textContent = 'Saved!';
      saveStatusEl.className = 'save-status save-ok';
      setTimeout(() => { saveStatusEl.textContent = ''; }, 2000);
    } catch (err) {
      saveStatusEl.textContent = 'Error saving';
      saveStatusEl.className = 'save-status save-err';
    }
    saveSettingsBtn.disabled = false;
  });

  // ---- Allowed senders list ----
  async function loadAllowedList() {
    allowedListEl.innerHTML = '<div class="empty-state">Loading&hellip;</div>';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_ALLOWED' });
      const emails = resp && resp.emails ? resp.emails : [];
      renderList(allowedListEl, allowedCountEl, emails, 'allowed');
    } catch (err) {
      allowedListEl.innerHTML = '';
      const errDiv = document.createElement('div');
      errDiv.className = 'empty-state';
      errDiv.textContent = 'Failed to load: ' + err.message;
      allowedListEl.appendChild(errDiv);
    }
  }

  // ---- Screened-out senders list ----
  async function loadBlockedList() {
    blockedListEl.innerHTML = '<div class="empty-state">Loading&hellip;</div>';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SCREENED_OUT' });
      const emails = resp && resp.emails ? resp.emails : [];
      renderList(blockedListEl, blockedCountEl, emails, 'screenout');
    } catch (err) {
      blockedListEl.innerHTML = '';
      const errDiv = document.createElement('div');
      errDiv.className = 'empty-state';
      errDiv.textContent = 'Failed to load: ' + err.message;
      blockedListEl.appendChild(errDiv);
    }
  }

  function renderList(container, countEl, emails, listType) {
    container.innerHTML = '';
    countEl.textContent = emails.length;

    if (emails.length === 0) {
      container.innerHTML =
        '<div class="empty-state">No ' + (listType === 'allowed' ? 'allowed' : 'screened-out') + ' senders.</div>';
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
      removeBtn.addEventListener('click', () => removeSender(email, listType));
      row.appendChild(removeBtn);

      container.appendChild(row);
    }
  }

  async function removeSender(email, listType) {
    const msgType = listType === 'allowed' ? 'REMOVE_ALLOWED' : 'REMOVE_SCREENED_OUT';
    try {
      const resp = await chrome.runtime.sendMessage({ type: msgType, email });
      if (resp && resp.success) {
        await loadAllLists();
        const gmailTabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
        for (const tab of gmailTabs) chrome.tabs.reload(tab.id);
      } else {
        alert('Failed to remove: ' + (resp?.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  async function loadAllLists() {
    await Promise.all([loadAllowedList(), loadBlockedList()]);
  }

  function showSettings() {
    settingsCard.style.display = 'block';
    allowedCard.style.display = 'block';
    screenoutCard.style.display = 'block';
  }

  // ---- Init ----
  checkAuth().then((authed) => {
    if (authed) {
      showSettings();
      loadSettings();
      loadAllLists();
    } else {
      allowedListEl.innerHTML =
        '<div class="empty-state">Sign in to view.</div>';
      blockedListEl.innerHTML =
        '<div class="empty-state">Sign in to view.</div>';
    }
  });
});
