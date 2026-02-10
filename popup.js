// popup.js - Extension popup logic
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const blockedCountEl = document.getElementById('blocked-count');
  const authStatusEl = document.getElementById('auth-status');
  const signInBtn = document.getElementById('sign-in-btn');
  const senderListEl = document.getElementById('sender-list');
  const openScreenoutLink = document.getElementById('open-screenout');
  const openOptionsLink = document.getElementById('open-options');

  // ---- Render sender list ----
  function renderList(emails) {
    senderListEl.innerHTML = '';
    blockedCountEl.textContent = emails.length;

    if (emails.length === 0) {
      senderListEl.innerHTML =
        '<div class="empty-state">No screened-out senders yet.</div>';
      return;
    }

    const sorted = [...emails].sort();
    for (const email of sorted) {
      const row = document.createElement('div');
      row.className = 'sender-row';

      const label = document.createElement('span');
      label.className = 'sender-email';
      if (email.startsWith('@')) {
        label.classList.add('sender-domain');
      }
      label.textContent = email;
      row.appendChild(label);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = `Remove filter for ${email}`;
      removeBtn.addEventListener('click', () => removeSender(email));
      row.appendChild(removeBtn);

      senderListEl.appendChild(row);
    }
  }

  async function loadList() {
    senderListEl.innerHTML = '<div class="empty-state">Loading\u2026</div>';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SCREENED_OUT' });
      const emails = resp && resp.emails ? resp.emails : [];
      renderList(emails);
    } catch (err) {
      senderListEl.innerHTML =
        '<div class="empty-state">Failed to load.</div>';
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
        // Reload Gmail tabs so moved messages appear in inbox
        const gmailTabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
        for (const tab of gmailTabs) chrome.tabs.reload(tab.id);
      }
    } catch (err) {
      console.warn('[Gmail Screener] Remove sender failed:', err);
    }
  }

  // ---- Auth ----
  try {
    const authResp = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' });
    if (authResp && authResp.authenticated) {
      authStatusEl.innerHTML =
        '<span class="dot dot-green"></span> Connected to Gmail';
      await loadList();
    } else {
      authStatusEl.innerHTML =
        '<span class="dot dot-red"></span> Not connected';
      signInBtn.style.display = 'block';
      senderListEl.innerHTML =
        '<div class="empty-state">Sign in to view screened-out senders.</div>';
    }
  } catch (err) {
    console.warn('[Gmail Screener] Auth check failed:', err);
    authStatusEl.innerHTML =
      '<span class="dot dot-red"></span> Not connected';
    signInBtn.style.display = 'block';
    senderListEl.innerHTML =
      '<div class="empty-state">Sign in to view screened-out senders.</div>';
  }

  signInBtn.addEventListener('click', async () => {
    signInBtn.disabled = true;
    signInBtn.textContent = 'Signing in\u2026';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
      if (resp && resp.success) {
        authStatusEl.innerHTML =
          '<span class="dot dot-green"></span> Connected to Gmail';
        signInBtn.style.display = 'none';
        await loadList();
      } else {
        authStatusEl.innerHTML =
          '<span class="dot dot-red"></span> Sign-in failed';
        signInBtn.disabled = false;
        signInBtn.textContent = 'Sign in with Google';
      }
    } catch (err) {
      authStatusEl.innerHTML =
        '<span class="dot dot-red"></span> Error';
      signInBtn.disabled = false;
      signInBtn.textContent = 'Sign in with Google';
    }
  });

  // ---- Links ----
  openScreenoutLink.addEventListener('click', async (e) => {
    e.preventDefault();
    // Find active Gmail tab to preserve the correct account (/u/0/, /u/1/, etc.)
    const [tab] = await chrome.tabs.query({ url: 'https://mail.google.com/*', active: true, currentWindow: true });
    if (tab) {
      const base = tab.url.match(/https:\/\/mail\.google\.com\/mail\/u\/\d+\//)?.[0]
        || 'https://mail.google.com/mail/u/0/';
      chrome.tabs.update(tab.id, { url: base + '#label/Screenout' });
    } else {
      chrome.tabs.create({ url: 'https://mail.google.com/mail/u/0/#label/Screenout' });
    }
  });

  openOptionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
