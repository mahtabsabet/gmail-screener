/**
 * Tests for contacts-related database functions.
 * Uses an in-memory SQLite database to test the actual SQL logic.
 */
import Database from 'better-sqlite3';

// Create an in-memory DB with the same schema as production
let db;

function createTestDb() {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS approved_senders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('APPROVED', 'DENIED')),
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, email)
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, email)
    );
  `);
  return db;
}

// Replicate the DB functions using test DB directly
function upsertContact(userId, email, name) {
  db.prepare(`
    INSERT INTO contacts (user_id, email, name, updated_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(user_id, email) DO UPDATE SET
      name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
      updated_at = unixepoch()
  `).run(userId, email.toLowerCase(), name);
}

function getContact(userId, email) {
  return db.prepare(
    'SELECT email, name, updated_at FROM contacts WHERE user_id = ? AND email = ?'
  ).get(userId, email.toLowerCase()) || null;
}

function searchContacts(userId, query) {
  const pattern = `%${query.toLowerCase()}%`;
  return db.prepare(`
    SELECT c.email, c.name, a.status
    FROM contacts c
    LEFT JOIN approved_senders a ON c.user_id = a.user_id AND c.email = a.email
    WHERE c.user_id = ? AND (LOWER(c.name) LIKE ? OR c.email LIKE ?)
    ORDER BY c.updated_at DESC
    LIMIT 20
  `).all(userId, pattern, pattern);
}

function setSenderStatus(userId, email, status) {
  db.prepare(`
    INSERT INTO approved_senders (user_id, email, status)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, email) DO UPDATE SET status = excluded.status
  `).run(userId, email.toLowerCase(), status);
}

const USER = 'test-user-1';

beforeEach(() => {
  createTestDb();
});

afterEach(() => {
  db.close();
});

describe('upsertContact', () => {
  test('inserts a new contact', () => {
    upsertContact(USER, 'michael@example.com', 'Michael Scott');
    const contact = getContact(USER, 'michael@example.com');
    expect(contact).not.toBeNull();
    expect(contact.email).toBe('michael@example.com');
    expect(contact.name).toBe('Michael Scott');
  });

  test('normalizes email to lowercase', () => {
    upsertContact(USER, 'Michael@Example.COM', 'Michael Scott');
    const contact = getContact(USER, 'michael@example.com');
    expect(contact).not.toBeNull();
    expect(contact.email).toBe('michael@example.com');
  });

  test('updates name on re-insert with non-empty name', () => {
    upsertContact(USER, 'michael@example.com', 'Michael');
    upsertContact(USER, 'michael@example.com', 'Michael Scott');
    const contact = getContact(USER, 'michael@example.com');
    expect(contact.name).toBe('Michael Scott');
  });

  test('preserves existing name when re-inserted with empty name', () => {
    upsertContact(USER, 'michael@example.com', 'Michael Scott');
    upsertContact(USER, 'michael@example.com', '');
    const contact = getContact(USER, 'michael@example.com');
    expect(contact.name).toBe('Michael Scott');
  });

  test('contacts are isolated per user', () => {
    upsertContact('user-a', 'shared@example.com', 'Name A');
    upsertContact('user-b', 'shared@example.com', 'Name B');
    expect(getContact('user-a', 'shared@example.com').name).toBe('Name A');
    expect(getContact('user-b', 'shared@example.com').name).toBe('Name B');
  });
});

describe('getContact', () => {
  test('returns null for non-existent contact', () => {
    expect(getContact(USER, 'nobody@example.com')).toBeNull();
  });

  test('lookup is case-insensitive', () => {
    upsertContact(USER, 'michael@example.com', 'Michael');
    expect(getContact(USER, 'MICHAEL@EXAMPLE.COM')).not.toBeNull();
  });
});

describe('searchContacts', () => {
  beforeEach(() => {
    upsertContact(USER, 'michael.scott@dundermifflin.com', 'Michael Scott');
    upsertContact(USER, 'jim@dundermifflin.com', 'Jim Halpert');
    upsertContact(USER, 'michael.jordan@nba.com', 'Michael Jordan');
    upsertContact(USER, 'pam@dundermifflin.com', 'Pam Beesly');
  });

  test('finds contacts by name', () => {
    const results = searchContacts(USER, 'Michael');
    expect(results).toHaveLength(2);
    const emails = results.map(r => r.email);
    expect(emails).toContain('michael.scott@dundermifflin.com');
    expect(emails).toContain('michael.jordan@nba.com');
  });

  test('finds contacts by email', () => {
    const results = searchContacts(USER, 'dundermifflin');
    expect(results).toHaveLength(3);
  });

  test('search is case-insensitive', () => {
    const results = searchContacts(USER, 'MICHAEL');
    expect(results).toHaveLength(2);
  });

  test('returns empty array for no matches', () => {
    const results = searchContacts(USER, 'nonexistent');
    expect(results).toHaveLength(0);
  });

  test('does not return other users contacts', () => {
    upsertContact('other-user', 'michael@other.com', 'Other Michael');
    const results = searchContacts(USER, 'Michael');
    expect(results).toHaveLength(2); // only USER's michaels
  });

  test('includes sender status from approved_senders', () => {
    setSenderStatus(USER, 'michael.scott@dundermifflin.com', 'APPROVED');
    setSenderStatus(USER, 'michael.jordan@nba.com', 'DENIED');

    const results = searchContacts(USER, 'Michael');
    const scott = results.find(r => r.email === 'michael.scott@dundermifflin.com');
    const jordan = results.find(r => r.email === 'michael.jordan@nba.com');
    expect(scott.status).toBe('APPROVED');
    expect(jordan.status).toBe('DENIED');
  });

  test('status is null for contacts without sender decision', () => {
    const results = searchContacts(USER, 'Pam');
    expect(results).toHaveLength(1);
    expect(results[0].status).toBeNull();
  });

  test('limits results to 20', () => {
    for (let i = 0; i < 25; i++) {
      upsertContact(USER, `test${i}@search.com`, `Search User ${i}`);
    }
    const results = searchContacts(USER, 'search.com');
    expect(results.length).toBeLessThanOrEqual(20);
  });
});
