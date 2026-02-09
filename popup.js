// popup.js - Extension popup logic
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const allowedCountEl = document.getElementById('allowed-count');
  const blockedCountEl = document.getElementById('blocked-count');
  const authStatusEl = document.getElementById('auth-status');
  const signInBtn = document.getElementById('sign-in-btn');
  const optionsBtn = document.getElementById('options-btn');
  const openGmailLink = document.getElementById('open-gmail');

  // Load stats
  chrome.storage.sync.get(['allowedEmails', 'blockedEmails'], (data) => {
    allowedCountEl.textContent = (data.allowedEmails || []).length;
    blockedCountEl.textContent = (data.blockedEmails || []).length;
  });

  // Check auth
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' });
    if (resp && resp.authenticated) {
      authStatusEl.innerHTML =
        '<span class="dot dot-green"></span> Connected to Gmail';
      signInBtn.style.display = 'none';
    } else {
      authStatusEl.innerHTML =
        '<span class="dot dot-red"></span> Not connected';
      signInBtn.style.display = 'block';
    }
  } catch (_) {
    authStatusEl.innerHTML =
      '<span class="dot dot-red"></span> Not connected';
    signInBtn.style.display = 'block';
  }

  // Sign in
  signInBtn.addEventListener('click', async () => {
    signInBtn.disabled = true;
    signInBtn.textContent = 'Signing in\u2026';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
      if (resp && resp.success) {
        authStatusEl.innerHTML =
          '<span class="dot dot-green"></span> Connected to Gmail';
        signInBtn.style.display = 'none';
      } else {
        authStatusEl.innerHTML =
          '<span class="dot dot-red"></span> Sign-in failed';
        signInBtn.disabled = false;
        signInBtn.textContent = 'Sign in with Google';
      }
    } catch (err) {
      authStatusEl.innerHTML =
        '<span class="dot dot-red"></span> Error: ' + err.message;
      signInBtn.disabled = false;
      signInBtn.textContent = 'Sign in with Google';
    }
  });

  // Options
  optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Open Gmail
  openGmailLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://mail.google.com' });
  });
});
