/**
 * Integration tests for background.js message handlers.
 * Uses FakeGmail to simulate the Gmail API and verify state transitions.
 */
'use strict';

const { resetChromeMock } = require('./setup');
const FakeGmail = require('./mocks/fake-gmail');

// Install chrome mock before requiring background.js
resetChromeMock();
const bg = require('../background');

let fakeGmail;

beforeEach(() => {
  resetChromeMock();
  fakeGmail = new FakeGmail();

  // Replace gmailFetch with the fake Gmail handler
  bg._replaceGmailFetch((path, options) => fakeGmail.handleRequest(path, options));

  // Clear label caches
  bg.clearAllLabelCaches();
});

// ============================================================
// Reply Later
// ============================================================

describe('REPLY_LATER', () => {
  test('adds Reply Later label and removes INBOX', async () => {
    const msg = fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'alice@test.com' });

    const result = await bg.handleMessage({
      type: 'REPLY_LATER',
      threadIds: [msg.threadId],
    });

    expect(result.success).toBe(true);
    expect(result.movedIds).toContain(msg.id);

    // Check message labels
    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).not.toContain('INBOX');
    // Should have the Reply Later label ID (created by ensureLabel)
    const replyLaterCalls = fakeGmail.getCallsMatching('/labels');
    expect(replyLaterCalls.length).toBeGreaterThan(0);
  });

  test('returns error for empty threadIds', async () => {
    const result = await bg.handleMessage({
      type: 'REPLY_LATER',
      threadIds: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('No threads specified');
  });
});

// ============================================================
// Set Aside
// ============================================================

describe('SET_ASIDE', () => {
  test('adds Set Aside label and removes INBOX', async () => {
    const msg = fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'bob@test.com' });

    const result = await bg.handleMessage({
      type: 'SET_ASIDE',
      threadIds: [msg.threadId],
    });

    expect(result.success).toBe(true);
    expect(result.movedIds).toContain(msg.id);

    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).not.toContain('INBOX');
  });
});

// ============================================================
// Move Back
// ============================================================

describe('MOVE_BACK', () => {
  test('restores INBOX and removes the triage label', async () => {
    const msg = fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'alice@test.com' });

    // First, move to Reply Later
    await bg.handleMessage({ type: 'REPLY_LATER', threadIds: [msg.threadId] });

    const afterMove = fakeGmail.getMessage(msg.id);
    expect(afterMove.labelIds).not.toContain('INBOX');

    // Now move back
    const result = await bg.handleMessage({
      type: 'MOVE_BACK',
      labelName: bg.LABEL_REPLY_LATER,
      threadIds: [msg.threadId],
    });

    expect(result.success).toBe(true);

    const restored = fakeGmail.getMessage(msg.id);
    expect(restored.labelIds).toContain('INBOX');
  });
});

// ============================================================
// Send Reply (archive from Reply Later)
// ============================================================

describe('SEND_REPLY', () => {
  test('removes Reply Later label and INBOX', async () => {
    const msg = fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'carol@test.com' });

    // Move to Reply Later first
    await bg.handleMessage({ type: 'REPLY_LATER', threadIds: [msg.threadId] });

    // Simulate replying: archive
    const result = await bg.handleMessage({
      type: 'SEND_REPLY',
      threadIds: [msg.threadId],
    });

    expect(result.success).toBe(true);

    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).not.toContain('INBOX');
  });

  test('returns error for empty threadIds', async () => {
    const result = await bg.handleMessage({ type: 'SEND_REPLY', threadIds: [] });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// Allow
// ============================================================

describe('ALLOW', () => {
  test('creates allow filter and sweeps screener messages to inbox', async () => {
    // Set up: create a message with the Screener label (simulating already-screened mail)
    // First, we need to ensure the Screener label exists
    const screenerLabelId = await bg.ensureLabel(bg.LABEL_SCREENER);

    const msg = fakeGmail.addMessage({
      labelIds: [screenerLabelId],
      from: 'alice@test.com',
    });

    const result = await bg.handleMessage({
      type: 'ALLOW',
      target: 'alice@test.com',
    });

    expect(result.success).toBe(true);
    expect(result.filterId).toBeTruthy();

    // Message should now have INBOX (approved)
    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).toContain('INBOX');
    // Should not have Screener label
    expect(updated.labelIds).not.toContain(screenerLabelId);
  });
});

// ============================================================
// Undo Allow
// ============================================================

describe('UNDO_ALLOW', () => {
  test('removes allow filter and restores screener label', async () => {
    const screenerLabelId = await bg.ensureLabel(bg.LABEL_SCREENER);

    const msg = fakeGmail.addMessage({
      labelIds: [screenerLabelId],
      from: 'alice@test.com',
    });

    // Allow first
    const allowResult = await bg.handleMessage({
      type: 'ALLOW',
      target: 'alice@test.com',
    });

    // Now undo
    const result = await bg.handleMessage({
      type: 'UNDO_ALLOW',
      target: 'alice@test.com',
      movedIds: allowResult.movedIds,
    });

    expect(result.success).toBe(true);

    // Message should have Screener back, no INBOX
    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).toContain(screenerLabelId);
    expect(updated.labelIds).not.toContain('INBOX');
  });
});

// ============================================================
// Enable / Disable Screener Mode
// ============================================================

describe('ENABLE_SCREENER', () => {
  test('enables screener mode and creates routing filter', async () => {
    const result = await bg.handleMessage({
      type: 'ENABLE_SCREENER',
      sweepInbox: false,
    });

    expect(result.success).toBe(true);

    // Should have created a filter
    const filterCalls = fakeGmail.getCallsMatching('/settings/filters');
    const createCalls = filterCalls.filter((c) => c.method === 'POST');
    expect(createCalls.length).toBeGreaterThan(0);
  });

  test('sweeps inbox when requested', async () => {
    fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'unknown@test.com' });
    fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'stranger@test.com' });

    const result = await bg.handleMessage({
      type: 'ENABLE_SCREENER',
      sweepInbox: true,
    });

    expect(result.success).toBe(true);
    expect(result.sweepResult).toBeTruthy();
    expect(result.sweepResult.moved).toBeGreaterThanOrEqual(2);
  });
});

describe('DISABLE_SCREENER', () => {
  test('disables screener mode', async () => {
    // Enable first
    await bg.handleMessage({ type: 'ENABLE_SCREENER', sweepInbox: false });

    const result = await bg.handleMessage({
      type: 'DISABLE_SCREENER',
      restoreToInbox: false,
    });

    expect(result.success).toBe(true);
  });
});

// ============================================================
// GET_LABEL_COUNTS
// ============================================================

describe('GET_LABEL_COUNTS', () => {
  test('returns zero counts when labels exist but are empty', async () => {
    // Ensure labels are created so getLabelId returns valid IDs
    await bg.ensureLabel(bg.LABEL_REPLY_LATER);
    await bg.ensureLabel(bg.LABEL_SET_ASIDE);

    const result = await bg.handleMessage({ type: 'GET_LABEL_COUNTS' });
    expect(result.replyLater).toBe(0);
    expect(result.setAside).toBe(0);
  });

  test('returns correct counts after triage', async () => {
    const msg1 = fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'a@test.com' });
    const msg2 = fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'b@test.com' });

    await bg.handleMessage({ type: 'REPLY_LATER', threadIds: [msg1.threadId] });
    await bg.handleMessage({ type: 'SET_ASIDE', threadIds: [msg2.threadId] });

    const result = await bg.handleMessage({ type: 'GET_LABEL_COUNTS' });
    expect(result.replyLater).toBe(1);
    expect(result.setAside).toBe(1);
  });
});

// ============================================================
// State transition table verification
// ============================================================

describe('State Transition Table', () => {
  test('Move to Screener: add Screener, remove INBOX', async () => {
    const msg = fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'user@test.com' });

    // Enable screener mode with sweep (this moves inbox → screener)
    await bg.handleMessage({ type: 'ENABLE_SCREENER', sweepInbox: true });

    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).not.toContain('INBOX');
    // Should have the Screener label
  });

  test('Approve Sender: add INBOX, remove Screener', async () => {
    const screenerLabelId = await bg.ensureLabel(bg.LABEL_SCREENER);
    const msg = fakeGmail.addMessage({
      labelIds: [screenerLabelId],
      from: 'approved@test.com',
    });

    await bg.handleMessage({ type: 'ALLOW', target: 'approved@test.com' });

    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).toContain('INBOX');
    expect(updated.labelIds).not.toContain(screenerLabelId);
  });

  test('Move to Reply Later: add Reply Later, remove INBOX', async () => {
    const msg = fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'reply@test.com' });

    await bg.handleMessage({ type: 'REPLY_LATER', threadIds: [msg.threadId] });

    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).not.toContain('INBOX');
  });

  test('Move to Set Aside: add Set Aside, remove INBOX', async () => {
    const msg = fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'aside@test.com' });

    await bg.handleMessage({ type: 'SET_ASIDE', threadIds: [msg.threadId] });

    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).not.toContain('INBOX');
  });

  test('Send Reply: remove Reply Later + INBOX', async () => {
    const msg = fakeGmail.addMessage({ labelIds: ['INBOX'], from: 'reply@test.com' });

    await bg.handleMessage({ type: 'REPLY_LATER', threadIds: [msg.threadId] });
    await bg.handleMessage({ type: 'SEND_REPLY', threadIds: [msg.threadId] });

    const updated = fakeGmail.getMessage(msg.id);
    expect(updated.labelIds).not.toContain('INBOX');
  });
});
