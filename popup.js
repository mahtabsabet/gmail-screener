// popup.js - Extension popup logic (Screener Mode)
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const authStatusEl = document.getElementById('auth-status');
  const signInBtn = document.getElementById('sign-in-btn');
  const screenerSection = document.getElementById('screener-section');
  const modeStatusEl = document.getElementById('mode-status');
  const modeStatsEl = document.getElementById('mode-stats');
  const enableBtn = document.getElementById('enable-btn');
  const disableBtn = document.getElementById('disable-btn');
  const sweepLabel = document.getElementById('sweep-label');
  const sweepCheckbox = document.getElementById('sweep-checkbox');
  const sweepText = document.getElementById('sweep-text');
  const openScreener = document.getElementById('open-screener');
  const openSetAside = document.getElementById('open-setaside');
  const openOptionsLink = document.getElementById('open-options');
  const reauthBtn = document.getElementById('reauth-btn');

  // ---- Status loading ----
  async function loadStatus() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      if (resp && resp.screenerEnabled) {
        modeStatusEl.textContent = 'ON';
        modeStatusEl.className = 'mode-status mode-status-on';
        enableBtn.style.display = 'none';
        disableBtn.style.display = 'block';
        sweepLabel.style.display = 'flex';
        sweepText.textContent = 'Move Screener mail back to inbox';
        sweepCheckbox.checked = true;

        if (resp.screenerCount) {
          modeStatsEl.style.display = 'block';
          modeStatsEl.innerHTML =
            `<strong>${resp.screenerCount.threads}</strong> threads in Screener` +
            (resp.screenerCount.unread > 0
              ? ` (<strong>${resp.screenerCount.unread}</strong> unread)`
              : '');
        }
      } else {
        modeStatusEl.textContent = 'OFF';
        modeStatusEl.className = 'mode-status mode-status-off';
        enableBtn.style.display = 'block';
        disableBtn.style.display = 'none';
        sweepLabel.style.display = 'flex';
        sweepText.textContent = 'Sweep existing inbox into Screener';
        sweepCheckbox.checked = true;
        modeStatsEl.style.display = 'none';
      }
    } catch (err) {
      console.warn('[Gmail Screener] Status check failed:', err);
    }
  }

  // ---- Enable/Disable ----
  enableBtn.addEventListener('click', async () => {
    enableBtn.disabled = true;
    enableBtn.textContent = 'Enabling\u2026';
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'ENABLE_SCREENER',
        sweepInbox: sweepCheckbox.checked,
      });
      if (resp && resp.success) {
        await loadStatus();
        // Reload Gmail tabs
        const gmailTabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
        for (const tab of gmailTabs) chrome.tabs.reload(tab.id);
      } else {
        enableBtn.textContent = 'Failed - try again';
      }
    } catch (err) {
      enableBtn.textContent = 'Error - try again';
    }
    enableBtn.disabled = false;
    if (enableBtn.style.display !== 'none') {
      enableBtn.textContent = 'Enable Screener Mode';
    }
  });

  disableBtn.addEventListener('click', async () => {
    disableBtn.disabled = true;
    disableBtn.textContent = 'Disabling\u2026';
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'DISABLE_SCREENER',
        restoreToInbox: sweepCheckbox.checked,
      });
      if (resp && resp.success) {
        await loadStatus();
        const gmailTabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
        for (const tab of gmailTabs) chrome.tabs.reload(tab.id);
      } else {
        disableBtn.textContent = 'Failed - try again';
      }
    } catch (err) {
      disableBtn.textContent = 'Error - try again';
    }
    disableBtn.disabled = false;
    if (disableBtn.style.display !== 'none') {
      disableBtn.textContent = 'Disable Screener Mode';
    }
  });

  // ---- Auth ----
  try {
    const authResp = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' });
    if (authResp && authResp.authenticated) {
      authStatusEl.innerHTML =
        '<span class="dot dot-green"></span> Connected to Gmail';
      screenerSection.style.display = 'block';
      if (reauthBtn) reauthBtn.style.display = 'block';
      await loadStatus();
    } else {
      authStatusEl.innerHTML =
        '<span class="dot dot-red"></span> Not connected';
      signInBtn.style.display = 'block';
      if (reauthBtn) reauthBtn.style.display = 'block';
    }
  } catch (err) {
    console.warn('[Gmail Screener] Auth check failed:', err);
    authStatusEl.innerHTML =
      '<span class="dot dot-red"></span> Not connected';
    signInBtn.style.display = 'block';
    if (reauthBtn) reauthBtn.style.display = 'block';
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
        screenerSection.style.display = 'block';
        await loadStatus();
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

  // Re-authorize button handler
  if (reauthBtn) {
    reauthBtn.addEventListener('click', async () => {
      reauthBtn.disabled = true;
      reauthBtn.textContent = 'Re-authorizing\u2026';
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
        if (resp && resp.success) {
          authStatusEl.innerHTML =
            '<span class="dot dot-green"></span> Connected to Gmail';
          reauthBtn.style.display = 'none';
          signInBtn.style.display = 'none';
          screenerSection.style.display = 'block';
          await loadStatus();
        } else {
          reauthBtn.textContent = 'Re-authorize failed - try again';
        }
      } catch (_) {
        reauthBtn.textContent = 'Error - try again';
      }
      reauthBtn.disabled = false;
    });
  }

  // ---- Folder links ----
  async function openGmailLabel(labelHash) {
    const [tab] = await chrome.tabs.query({ url: 'https://mail.google.com/*', active: true, currentWindow: true });
    if (tab) {
      const base = tab.url.match(/https:\/\/mail\.google\.com\/mail\/u\/\d+\//)?.[0]
        || 'https://mail.google.com/mail/u/0/';
      chrome.tabs.update(tab.id, { url: base + labelHash });
    } else {
      chrome.tabs.create({ url: 'https://mail.google.com/mail/u/0/' + labelHash });
    }
  }

  openScreener.addEventListener('click', (e) => {
    e.preventDefault();
    openGmailLabel('#label/Gatekeeper%2FScreener');
  });

  openSetAside.addEventListener('click', (e) => {
    e.preventDefault();
    openGmailLabel('#label/Gatekeeper%2FSet+Aside');
  });

  openOptionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
