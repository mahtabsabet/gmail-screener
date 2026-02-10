// popup.js - Extension popup logic
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const blockedCountEl = document.getElementById('blocked-count');
  const authStatusEl = document.getElementById('auth-status');
  const signInBtn = document.getElementById('sign-in-btn');
  const optionsBtn = document.getElementById('options-btn');
  const openScreenoutLink = document.getElementById('open-screenout');

  // Check auth & load count
  try {
    const authResp = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' });
    if (authResp && authResp.authenticated) {
      authStatusEl.innerHTML =
        '<span class="dot dot-green"></span> Connected to Gmail';

      const resp = await chrome.runtime.sendMessage({ type: 'GET_SCREENED_OUT' });
      blockedCountEl.textContent = resp && resp.emails ? resp.emails.length : 0;
    } else {
      authStatusEl.innerHTML =
        '<span class="dot dot-red"></span> Not connected';
      signInBtn.style.display = 'block';
      blockedCountEl.textContent = '-';
    }
  } catch (_) {
    authStatusEl.innerHTML =
      '<span class="dot dot-red"></span> Not connected';
    signInBtn.style.display = 'block';
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

        const r = await chrome.runtime.sendMessage({ type: 'GET_SCREENED_OUT' });
        blockedCountEl.textContent = r && r.emails ? r.emails.length : 0;
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

  optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  openScreenoutLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://mail.google.com/mail/u/0/#label/Screenout' });
  });
});
