import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { config } from '../config.js';

const ROUNDS = 10;

export const hashPassword = (plain) => bcrypt.hashSync(plain, ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compareSync(plain, hash);

// The cookie carries the token; the database only ever sees its hash, so a
// leaked backup cannot be replayed as a live session.
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function createSession(userId, userAgent = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, user_agent, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha(token), userId, String(userAgent).slice(0, 255), expires);
  return { token, expiresAt: expires };
}

export function readSession(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.token_hash, s.expires_at, s.last_seen_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  ).get(sha(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now() || row.status !== 'active') {
    destroySession(token);
    return null;
  }
  // Touch at most once a minute; no need to write on every request.
  if (Date.now() - Date.parse(`${row.last_seen_at.replace(' ', 'T')}Z`) > 60_000) {
    db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE token_hash = ?").run(row.token_hash);
  }
  return {
    id: row.id,
    publicId: row.public_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    emailVerified: Boolean(row.email_verified),
  };
}

export const destroySession = (token) => {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
};

export const destroyUserSessions = (userId) =>
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;

export const purgeExpiredSessions = () =>
  db.prepare("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')").run().changes;

export function listSessions(userId) {
  return db.prepare('SELECT user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC')
    .all(userId);
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: String(process.env.COOKIE_SECURE || '') === 'true',
    expires: new Date(expiresAt),
    path: '/',
  });
}

export const clearSessionCookie = (res) => res.clearCookie(config.sessionCookie, { path: '/' });

/* ── One-time codes ─────────────────────────────────────────────────────── */

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

/** Issues a fresh 6-digit code, voiding any earlier unused one for the same purpose. */
export function issueOtp(email, purpose) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare("UPDATE otps SET consumed_at = datetime('now') WHERE email = ? AND purpose = ? AND consumed_at IS NULL")
    .run(email, purpose);
  db.prepare('INSERT INTO otps (email, purpose, code_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run(email, purpose, sha(`${email}|${purpose}|${code}`), new Date(Date.now() + OTP_MINUTES * 60_000).toISOString());
  return { code, minutes: OTP_MINUTES };
}

/** True once, for the latest unexpired code. Wrong guesses burn attempts. */
export function consumeOtp(email, purpose, code) {
  const row = db.prepare(
    'SELECT * FROM otps WHERE email = ? AND purpose = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1',
  ).get(email, purpose);
  if (!row) return { ok: false, reason: 'No active code. Ask for a new one.' };
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false, reason: 'That code has expired. Ask for a new one.' };
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'Too many wrong codes. Ask for a new one.' };

  const expected = Buffer.from(row.code_hash, 'hex');
  const given = Buffer.from(sha(`${email}|${purpose}|${String(code || '').trim()}`), 'hex');
  if (!crypto.timingSafeEqual(expected, given)) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return { ok: false, reason: 'That code is not right.' };
  }
  db.prepare("UPDATE otps SET consumed_at = datetime('now') WHERE id = ?").run(row.id);
  return { ok: true };
}

export const dashboardFor = (role) => (role === 'admin' ? '/admin' : role === 'lister' ? '/lister' : '/app');
