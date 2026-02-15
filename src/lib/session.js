import { cookies } from 'next/headers';
import crypto from 'crypto';

const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 32) {
  throw new Error(
    'SESSION_SECRET environment variable is required and must be at least 32 characters. ' +
    'Generate one with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
  );
}
const COOKIE_NAME = 'gk_session';

// Derive a stable encryption key using scrypt with an application-specific salt
const ENCRYPTION_KEY = crypto.scryptSync(SECRET, 'gatekeeper-session-v1', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  const parts = text.split(':');
  if (parts.length !== 2) throw new Error('Invalid session format');
  const [ivHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  if (iv.length !== 16) throw new Error('Invalid IV length');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export async function setSession(userId) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, encrypt(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export async function getSession() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  try {
    return decrypt(cookie.value);
  } catch {
    return null;
  }
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
