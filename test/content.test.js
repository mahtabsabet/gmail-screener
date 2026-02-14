/**
 * Tests for content.js pure functions.
 * Uses jsdom (built into Jest) for DOM-dependent functions.
 *
 * @jest-environment jsdom
 */
'use strict';

// Set up minimal chrome mock for content.js
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    lastError: null,
  },
};

// Set up location.hash for view detection tests
// jsdom logs a "not implemented: navigation" warning which is harmless
delete window.location;
window.location = { hash: '', href: 'https://mail.google.com/mail/u/0/' };

const content = require('../content');

describe('getCurrentView', () => {
  function setHash(hash) {
    window.location.hash = hash;
  }

  afterEach(() => {
    window.location.hash = '';
  });

  test('returns screener for Gatekeeper/Screener label', () => {
    setHash('#label/Gatekeeper%2FScreener');
    expect(content.getCurrentView()).toBe('screener');
  });

  test('returns setaside for Gatekeeper/Set Aside label', () => {
    setHash('#label/Gatekeeper%2FSet%20Aside');
    expect(content.getCurrentView()).toBe('setaside');
  });

  test('returns replylater for Gatekeeper/Reply Later label', () => {
    setHash('#label/Gatekeeper%2FReply%20Later');
    expect(content.getCurrentView()).toBe('replylater');
  });

  test('returns screener for legacy Screener label', () => {
    setHash('#label/Screener');
    expect(content.getCurrentView()).toBe('screener');
  });

  test('returns setaside for legacy SetAside label', () => {
    setHash('#label/SetAside');
    expect(content.getCurrentView()).toBe('setaside');
  });

  test('returns replylater for legacy ReplyLater label', () => {
    setHash('#label/ReplyLater');
    expect(content.getCurrentView()).toBe('replylater');
  });

  test('returns inbox for empty hash', () => {
    setHash('');
    expect(content.getCurrentView()).toBe('inbox');
  });

  test('returns inbox for #inbox', () => {
    setHash('#inbox');
    expect(content.getCurrentView()).toBe('inbox');
  });

  test('returns inbox for #inbox/thread', () => {
    setHash('#inbox/abc123');
    expect(content.getCurrentView()).toBe('inbox');
  });

  test('returns inbox for #search/', () => {
    setHash('#search/query');
    expect(content.getCurrentView()).toBe('inbox');
  });

  test('returns inbox for #category/', () => {
    setHash('#category/social');
    expect(content.getCurrentView()).toBe('inbox');
  });

  test('returns other for unknown hash', () => {
    setHash('#settings/general');
    expect(content.getCurrentView()).toBe('other');
  });

  test('returns other for #label/SomeOtherLabel', () => {
    setHash('#label/SomeOtherLabel');
    expect(content.getCurrentView()).toBe('other');
  });
});

describe('getDomain', () => {
  test('extracts domain from email', () => {
    expect(content.getDomain('user@example.com')).toBe('example.com');
  });

  test('returns null for no @', () => {
    expect(content.getDomain('noatsign')).toBeNull();
  });
});

describe('formatFrom', () => {
  test('extracts name from "Name <email>" format', () => {
    expect(content.formatFrom('Alice Smith <alice@test.com>')).toBe('Alice Smith');
  });

  test('extracts name from quoted "Name" <email> format', () => {
    expect(content.formatFrom('"Bob Jones" <bob@test.com>')).toBe('Bob Jones');
  });

  test('returns raw string if no angle bracket pattern', () => {
    expect(content.formatFrom('alice@test.com')).toBe('alice@test.com');
  });
});

describe('formatDate', () => {
  test('formats today as time', () => {
    const now = new Date();
    const result = content.formatDate(now.toISOString());
    // Should be a short time string (not a date)
    expect(result).toBeTruthy();
    expect(result.length).toBeLessThan(15);
  });

  test('formats past date as month/day', () => {
    const result = content.formatDate('2024-01-15T10:30:00Z');
    expect(result).toBeTruthy();
    // Should contain month abbreviation
    expect(result).toMatch(/Jan|15/);
  });

  test('handles invalid date gracefully', () => {
    const result = content.formatDate('not-a-date');
    expect(result).toBeTruthy();
  });
});

describe('decimalToHex', () => {
  test('converts decimal string to hex', () => {
    expect(content.decimalToHex('255')).toBe('ff');
    expect(content.decimalToHex('16')).toBe('10');
    expect(content.decimalToHex('0')).toBe('0');
  });

  test('handles large numbers (BigInt)', () => {
    expect(content.decimalToHex('1234567890123456789')).toBe('112210f47de98115');
  });

  test('returns input for non-numeric strings', () => {
    expect(content.decimalToHex('abc')).toBe('abc');
  });
});

describe('normalizeThreadId', () => {
  test('returns null for null/undefined', () => {
    expect(content.normalizeThreadId(null)).toBeNull();
    expect(content.normalizeThreadId(undefined)).toBeNull();
  });

  test('extracts hex from #thread-f: pattern', () => {
    expect(content.normalizeThreadId('#thread-f:255')).toBe('ff');
  });

  test('returns raw value when no pattern matches', () => {
    expect(content.normalizeThreadId('abc123')).toBe('abc123');
  });
});

describe('extractSenderEmail', () => {
  test('extracts email from [email] attribute', () => {
    const row = document.createElement('tr');
    const span = document.createElement('span');
    span.setAttribute('email', 'Alice@Test.com');
    row.appendChild(span);

    expect(content.extractSenderEmail(row)).toBe('alice@test.com');
  });

  test('extracts email from [data-hovercard-id]', () => {
    const row = document.createElement('tr');
    const el = document.createElement('div');
    el.setAttribute('data-hovercard-id', 'Bob@Example.com');
    row.appendChild(el);

    expect(content.extractSenderEmail(row)).toBe('bob@example.com');
  });

  test('returns null when no email found', () => {
    const row = document.createElement('tr');
    row.innerHTML = '<td>No email here</td>';
    expect(content.extractSenderEmail(row)).toBeNull();
  });

  test('ignores values without @', () => {
    const row = document.createElement('tr');
    const span = document.createElement('span');
    span.setAttribute('email', 'not-an-email');
    row.appendChild(span);

    expect(content.extractSenderEmail(row)).toBeNull();
  });
});

describe('extractThreadId', () => {
  test('extracts from anchor href with thread ID', () => {
    const row = document.createElement('tr');
    const a = document.createElement('a');
    a.setAttribute('href', '#inbox/18f4a2b3c4d5e6f7');
    row.appendChild(a);

    expect(content.extractThreadId(row)).toBe('18f4a2b3c4d5e6f7');
  });

  test('extracts from data-legacy-thread-id', () => {
    const row = document.createElement('tr');
    row.setAttribute('data-legacy-thread-id', 'thread123abc');

    expect(content.extractThreadId(row)).toBe('thread123abc');
  });

  test('extracts from jslog attribute with thread-f: pattern', () => {
    const row = document.createElement('tr');
    row.setAttribute('jslog', 'somedata;#thread-f:12345;moredata');

    expect(content.extractThreadId(row)).toBe('3039');
  });

  test('extracts from child data-thread-id', () => {
    const row = document.createElement('tr');
    const child = document.createElement('div');
    child.setAttribute('data-thread-id', 'childthread456');
    row.appendChild(child);

    expect(content.extractThreadId(row)).toBe('childthread456');
  });

  test('returns null when no thread ID found', () => {
    const row = document.createElement('tr');
    row.innerHTML = '<td>No thread info</td>';

    expect(content.extractThreadId(row)).toBeNull();
  });
});
