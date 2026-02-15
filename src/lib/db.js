import { createClient } from '@libsql/client';

let _db = null;

function getDb() {
  if (_db) return _db;

  _db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  return _db;
}

// Initialize schema (called once on first use)
let schemaInitialized = false;
async function ensureSchema() {
  if (schemaInitialized) return;
  const db = getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS auth (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry INTEGER
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS approved_senders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('APPROVED', 'DENIED')),
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, email)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS thread_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      folder TEXT NOT NULL CHECK(folder IN ('IMBOX', 'REPLY_LATER', 'SET_ASIDE')),
      is_archived INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, thread_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, email)
    )
  `);

  schemaInitialized = true;
}

// ---- Auth ----

export async function getUser(userId) {
  await ensureSchema();
  const result = await getDb().execute({
    sql: 'SELECT * FROM auth WHERE user_id = ?',
    args: [userId],
  });
  return result.rows[0] || null;
}

export async function upsertUser({ userId, email, accessToken, refreshToken, tokenExpiry }) {
  await ensureSchema();
  await getDb().execute({
    sql: `
      INSERT INTO auth (user_id, email, access_token, refresh_token, token_expiry)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        email = excluded.email,
        access_token = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, auth.refresh_token),
        token_expiry = excluded.token_expiry
    `,
    args: [userId, email, accessToken, refreshToken, tokenExpiry],
  });
}

export async function updateTokens(userId, accessToken, tokenExpiry) {
  await getDb().execute({
    sql: 'UPDATE auth SET access_token = ?, token_expiry = ? WHERE user_id = ?',
    args: [accessToken, tokenExpiry, userId],
  });
}

// ---- Approved Senders ----

export async function getSenderStatus(userId, email) {
  const result = await getDb().execute({
    sql: 'SELECT status FROM approved_senders WHERE user_id = ? AND email = ?',
    args: [userId, email.toLowerCase()],
  });
  return result.rows[0]?.status || null;
}

export async function setSenderStatus(userId, email, status) {
  await getDb().execute({
    sql: `
      INSERT INTO approved_senders (user_id, email, status)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, email) DO UPDATE SET status = excluded.status
    `,
    args: [userId, email.toLowerCase(), status],
  });
}

export async function removeSender(userId, email) {
  await getDb().execute({
    sql: 'DELETE FROM approved_senders WHERE user_id = ? AND email = ?',
    args: [userId, email.toLowerCase()],
  });
}

export async function listSenders(userId, status = null) {
  if (status) {
    const result = await getDb().execute({
      sql: 'SELECT email, status, created_at FROM approved_senders WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
      args: [userId, status],
    });
    return result.rows;
  }
  const result = await getDb().execute({
    sql: 'SELECT email, status, created_at FROM approved_senders WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId],
  });
  return result.rows;
}

export async function getAllApprovedEmails(userId) {
  const result = await getDb().execute({
    sql: "SELECT email FROM approved_senders WHERE user_id = ? AND status = 'APPROVED'",
    args: [userId],
  });
  return result.rows.map(r => r.email);
}

export async function getAllDeniedEmails(userId) {
  const result = await getDb().execute({
    sql: "SELECT email FROM approved_senders WHERE user_id = ? AND status = 'DENIED'",
    args: [userId],
  });
  return result.rows.map(r => r.email);
}

// ---- Thread State ----

export async function getThreadState(userId, threadId) {
  const result = await getDb().execute({
    sql: 'SELECT * FROM thread_state WHERE user_id = ? AND thread_id = ?',
    args: [userId, threadId],
  });
  return result.rows[0] || null;
}

export async function setThreadFolder(userId, threadId, folder) {
  await getDb().execute({
    sql: `
      INSERT INTO thread_state (user_id, thread_id, folder, is_archived, updated_at)
      VALUES (?, ?, ?, 0, unixepoch())
      ON CONFLICT(user_id, thread_id) DO UPDATE SET
        folder = excluded.folder, is_archived = 0, updated_at = unixepoch()
    `,
    args: [userId, threadId, folder],
  });
}

export async function archiveThread(userId, threadId) {
  await getDb().execute({
    sql: 'UPDATE thread_state SET is_archived = 1, updated_at = unixepoch() WHERE user_id = ? AND thread_id = ?',
    args: [userId, threadId],
  });
}

export async function getThreadsByFolder(userId, folder) {
  const result = await getDb().execute({
    sql: 'SELECT thread_id, folder, is_archived, updated_at FROM thread_state WHERE user_id = ? AND folder = ? AND is_archived = 0 ORDER BY updated_at DESC',
    args: [userId, folder],
  });
  return result.rows;
}

export async function removeThreadState(userId, threadId) {
  await getDb().execute({
    sql: 'DELETE FROM thread_state WHERE user_id = ? AND thread_id = ?',
    args: [userId, threadId],
  });
}

// ---- Contacts ----

export async function upsertContact(userId, email, name) {
  await getDb().execute({
    sql: `
      INSERT INTO contacts (user_id, email, name, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(user_id, email) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
        updated_at = unixepoch()
    `,
    args: [userId, email.toLowerCase(), name],
  });
}

export async function getContact(userId, email) {
  const result = await getDb().execute({
    sql: 'SELECT email, name, updated_at FROM contacts WHERE user_id = ? AND email = ?',
    args: [userId, email.toLowerCase()],
  });
  return result.rows[0] || null;
}

export async function searchContacts(userId, query) {
  const pattern = `%${query.toLowerCase()}%`;
  const result = await getDb().execute({
    sql: `
      SELECT c.email, c.name, a.status
      FROM contacts c
      LEFT JOIN approved_senders a ON c.user_id = a.user_id AND c.email = a.email
      WHERE c.user_id = ? AND (LOWER(c.name) LIKE ? OR c.email LIKE ?)
      ORDER BY c.updated_at DESC
      LIMIT 20
    `,
    args: [userId, pattern, pattern],
  });
  return result.rows;
}
