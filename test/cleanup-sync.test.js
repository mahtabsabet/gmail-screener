/**
 * Tests for the cleanup sync (history-based poller).
 * Verifies that:
 *  - historyId is seeded on first run
 *  - Reply Later threads with sent replies are auto-archived
 *  - Expired historyId is re-seeded
 */
'use strict';

const { resetChromeMock } = require('./setup');
const FakeGmail = require('./mocks/fake-gmail');

resetChromeMock();
const bg = require('../background');

let fakeGmail;

beforeEach(() => {
  resetChromeMock();
  fakeGmail = new FakeGmail();
  bg._replaceGmailFetch((path, options) => fakeGmail.handleRequest(path, options));
  bg.clearAllLabelCaches();
});

describe('Cleanup Sync', () => {
  test('seeds historyId on first run', async () => {
    // Enable screener so sync will run
    await chrome.storage.local.set({ screenerEnabled: true });

    // No historyId stored yet
    await bg.runCleanupSync();

    // Should have stored the historyId
    const stored = await chrome.storage.local.get(['lastHistoryId']);
    expect(stored.lastHistoryId).toBeTruthy();
  });

  test('skips when screener is disabled', async () => {
    await chrome.storage.local.set({ screenerEnabled: false });

    // Should not throw and not make any API calls
    await bg.runCleanupSync();

    const calls = fakeGmail.getCalls();
    expect(calls.length).toBe(0);
  });

  test('auto-archives Reply Later thread when user sent a reply', async () => {
    await chrome.storage.local.set({ screenerEnabled: true });

    // Create a Reply Later label and message
    const replyLaterLabelId = await bg.ensureLabel(bg.LABEL_REPLY_LATER);
    const msg = fakeGmail.addMessage({
      labelIds: [replyLaterLabelId, 'INBOX'],
      from: 'alice@test.com',
      subject: 'Need your input',
    });

    // Seed historyId first
    await bg.runCleanupSync();

    // Simulate user replying (adds a SENT message to the same thread)
    fakeGmail.addSentReply(msg.threadId);

    // Run sync again - should detect the reply and remove Reply Later label
    await bg.runCleanupSync();

    // Check that the Reply Later label was removed
    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).not.toContain(replyLaterLabelId);
  });

  test('does not archive thread without sent reply', async () => {
    await chrome.storage.local.set({ screenerEnabled: true });

    const replyLaterLabelId = await bg.ensureLabel(bg.LABEL_REPLY_LATER);
    const msg = fakeGmail.addMessage({
      labelIds: [replyLaterLabelId],
      from: 'bob@test.com',
    });

    // Seed historyId
    await bg.runCleanupSync();

    // Add a new incoming message (not SENT) to the same thread
    fakeGmail.addMessage({
      threadId: msg.threadId,
      labelIds: [replyLaterLabelId],
      from: 'bob@test.com',
      subject: 'Re: follow up',
    });

    // Run sync
    await bg.runCleanupSync();

    // Reply Later label should still be there (no sent reply)
    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).toContain(replyLaterLabelId);
  });

  test('handles expired historyId gracefully', async () => {
    await chrome.storage.local.set({ screenerEnabled: true });

    // Seed with a very old historyId
    await bg.saveLastHistoryId('1');

    // Create the Reply Later label so it exists
    await bg.ensureLabel(bg.LABEL_REPLY_LATER);

    // Sync should reseed without throwing
    await bg.runCleanupSync();

    // Check that historyId was updated
    const stored = await chrome.storage.local.get(['lastHistoryId']);
    expect(parseInt(stored.lastHistoryId, 10)).toBeGreaterThan(1);
  });

  test('startCleanupSync creates an alarm', () => {
    bg.startCleanupSync();
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'gatekeeper-cleanup-sync',
      { periodInMinutes: 5 }
    );
  });

  test('stopCleanupSync clears the alarm', () => {
    bg.stopCleanupSync();
    expect(chrome.alarms.clear).toHaveBeenCalledWith('gatekeeper-cleanup-sync');
  });
});
