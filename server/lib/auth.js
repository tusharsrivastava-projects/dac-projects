import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { config } from '../config.js';

const ROUNDS = 10;

export const hashPassword = (plain) => bcrypt.hashSync(plain, ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compareSync(plain, hash);

export const normaliseEmail = (email) => String(email || '').trim().toLowerCase();

export function createSession(userId, userAgent = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5).toISOString();
  db.prepare(
    'INSERT INTO sessions (token, user_id, user_agent, expires_at) VALUES (?, ?, ?, ?)',
  ).run(token, userId, String(userAgent).slice(0, 255), expires);
  return { token, expiresAt: expires };
}

export function readSession(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.token, s.expires_at, u.id, u.full_name, u.email, u.phone, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
  ).get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now() || row.status !== 'active') {
    destroySession(token);
    return null;
  }
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
  };
}

export const destroySession = (token) => {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
};

export const purgeExpiredSessions = () =>
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run().changes;

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
