import Database from 'better-sqlite3';
import path from 'path';

let _db = null;

function getDb() {
  if (_db) return _db;

  const dbPath = path.join(process.cwd(), 'gatekeeper.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS auth (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry INTEGER
    );

    CREATE TABLE IF NOT EXISTS approved_senders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('APPROVED', 'DENIED')),
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, email)
    );

    CREATE TABLE IF NOT EXISTS thread_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      folder TEXT NOT NULL CHECK(folder IN ('IMBOX', 'REPLY_LATER', 'SET_ASIDE')),
      is_archived INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, thread_id)
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

  return _db;
}

// ---- Auth ----

export function getUser(userId) {
  return getDb().prepare('SELECT * FROM auth WHERE user_id = ?').get(userId);
}

export function upsertUser({ userId, email, accessToken, refreshToken, tokenExpiry }) {
  getDb().prepare(`
    INSERT INTO auth (user_id, email, access_token, refresh_token, token_expiry)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      email = excluded.email,
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, auth.refresh_token),
      token_expiry = excluded.token_expiry
  `).run(userId, email, accessToken, refreshToken, tokenExpiry);
}

export function updateTokens(userId, accessToken, tokenExpiry) {
  getDb().prepare(
    'UPDATE auth SET access_token = ?, token_expiry = ? WHERE user_id = ?'
  ).run(accessToken, tokenExpiry, userId);
}

// ---- Approved Senders ----

export function getSenderStatus(userId, email) {
  const row = getDb().prepare(
    'SELECT status FROM approved_senders WHERE user_id = ? AND email = ?'
  ).get(userId, email.toLowerCase());
  return row?.status || null;
}

export function setSenderStatus(userId, email, status) {
  getDb().prepare(`
    INSERT INTO approved_senders (user_id, email, status)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, email) DO UPDATE SET status = excluded.status
  `).run(userId, email.toLowerCase(), status);
}

export function removeSender(userId, email) {
  getDb().prepare(
    'DELETE FROM approved_senders WHERE user_id = ? AND email = ?'
  ).run(userId, email.toLowerCase());
}

export function listSenders(userId, status = null) {
  if (status) {
    return getDb().prepare(
      'SELECT email, status, created_at FROM approved_senders WHERE user_id = ? AND status = ? ORDER BY created_at DESC'
    ).all(userId, status);
  }
  return getDb().prepare(
    'SELECT email, status, created_at FROM approved_senders WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
}

export function getAllApprovedEmails(userId) {
  return getDb().prepare(
    "SELECT email FROM approved_senders WHERE user_id = ? AND status = 'APPROVED'"
  ).all(userId).map(r => r.email);
}

export function getAllDeniedEmails(userId) {
  return getDb().prepare(
    "SELECT email FROM approved_senders WHERE user_id = ? AND status = 'DENIED'"
  ).all(userId).map(r => r.email);
}

// ---- Thread State ----

export function getThreadState(userId, threadId) {
  return getDb().prepare(
    'SELECT * FROM thread_state WHERE user_id = ? AND thread_id = ?'
  ).get(userId, threadId);
}

export function setThreadFolder(userId, threadId, folder) {
  getDb().prepare(`
    INSERT INTO thread_state (user_id, thread_id, folder, is_archived, updated_at)
    VALUES (?, ?, ?, 0, unixepoch())
    ON CONFLICT(user_id, thread_id) DO UPDATE SET
      folder = excluded.folder, is_archived = 0, updated_at = unixepoch()
  `).run(userId, threadId, folder);
}

export function archiveThread(userId, threadId) {
  getDb().prepare(
    'UPDATE thread_state SET is_archived = 1, updated_at = unixepoch() WHERE user_id = ? AND thread_id = ?'
  ).run(userId, threadId);
}

export function getThreadsByFolder(userId, folder) {
  return getDb().prepare(
    'SELECT thread_id, folder, is_archived, updated_at FROM thread_state WHERE user_id = ? AND folder = ? AND is_archived = 0 ORDER BY updated_at DESC'
  ).all(userId, folder);
}

export function removeThreadState(userId, threadId) {
  getDb().prepare(
    'DELETE FROM thread_state WHERE user_id = ? AND thread_id = ?'
  ).run(userId, threadId);
}

// ---- Contacts ----

export function upsertContact(userId, email, name) {
  getDb().prepare(`
    INSERT INTO contacts (user_id, email, name, updated_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(user_id, email) DO UPDATE SET
      name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
      updated_at = unixepoch()
  `).run(userId, email.toLowerCase(), name);
}

export function getContact(userId, email) {
  return getDb().prepare(
    'SELECT email, name, updated_at FROM contacts WHERE user_id = ? AND email = ?'
  ).get(userId, email.toLowerCase()) || null;
}

export function searchContacts(userId, query) {
  const pattern = `%${query.toLowerCase()}%`;
  return getDb().prepare(`
    SELECT c.email, c.name, a.status
    FROM contacts c
    LEFT JOIN approved_senders a ON c.user_id = a.user_id AND c.email = a.email
    WHERE c.user_id = ? AND (LOWER(c.name) LIKE ? OR c.email LIKE ?)
    ORDER BY c.updated_at DESC
    LIMIT 20
  `).all(userId, pattern, pattern);
}
