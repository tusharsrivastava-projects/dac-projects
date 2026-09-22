import express from 'express';
import { db, logActivity } from '../db/index.js';
import {
  clearSessionCookie, createSession, destroySession,
  hashPassword, setSessionCookie, verifyPassword,
} from '../lib/auth.js';
import { conflict, unauthorized, wrap } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { loginKey, rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/session.js';

export const authRouter = express.Router();

// Only failed sign-ins count, so someone legitimately signing in on several
// devices is never locked out by their own success.
const loginLimit = rateLimit({
  max: 8, windowMs: 15 * 60 * 1000, key: loginKey, onlyFailures: true,
  message: 'Too many failed sign-in attempts. Wait a few minutes and try again.',
});
const registerLimit = rateLimit({
  max: 10, windowMs: 60 * 60 * 1000,
  message: 'Too many accounts created from here. Try again later.',
});
const passwordLimit = rateLimit({
  max: 5, windowMs: 15 * 60 * 1000, onlyFailures: true,
  message: 'Too many attempts. Wait a few minutes and try again.',
});

const publicUser = (u) => ({
  id: u.id,
  fullName: u.full_name ?? u.fullName,
  email: u.email,
  phone: u.phone ?? null,
  role: u.role,
});

authRouter.post('/register', registerLimit, wrap((req, res) => {
  const fullName = v.str(req.body.fullName, 'Full name', { min: 2, max: 120 });
  const emailAddr = v.email(req.body.email);
  const phone = v.str(req.body.phone, 'Phone', { required: false, max: 30 });
  const pass = v.password(req.body.password);

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(emailAddr)) {
    throw conflict('An account already uses that email. Try signing in instead.');
  }

  // Candidates only — admin accounts are created by another admin or the seed script.
  const id = db.prepare(
    "INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'candidate')",
  ).run(fullName, emailAddr, phone, hashPassword(pass)).lastInsertRowid;

  logActivity({ actorId: id, actorName: fullName, action: 'account.registered', entity: 'user', entityId: id });

  const { token, expiresAt } = createSession(id, req.get('user-agent'));
  setSessionCookie(res, token, expiresAt);
  res.status(201).json({ user: publicUser({ id, full_name: fullName, email: emailAddr, phone, role: 'candidate' }) });
}));

authRouter.post('/login', loginLimit, wrap((req, res) => {
  const emailAddr = v.email(req.body.email);
  const pass = v.str(req.body.password, 'Password', { trim: false, max: 200 });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(emailAddr);
  // Same message either way so the form cannot be used to enumerate accounts.
  if (!user || !verifyPassword(pass, user.password_hash)) {
    throw unauthorized('That email and password do not match.');
  }
  if (user.status !== 'active') throw unauthorized('This account has been disabled. Contact the AI Cell office.');

  const { token, expiresAt } = createSession(user.id, req.get('user-agent'));
  setSessionCookie(res, token, expiresAt);
  logActivity({ actorId: user.id, actorName: user.full_name, action: 'account.login', entity: 'user', entityId: user.id });
  res.json({ user: publicUser(user) });
}));

authRouter.post('/logout', wrap((req, res) => {
  if (req.user) {
    logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'account.logout', entity: 'user', entityId: req.user.id });
  }
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

authRouter.get('/me', wrap((req, res) => {
  res.json({ user: req.user ?? null });
}));

authRouter.patch('/me', requireAuth, wrap((req, res) => {
  const fullName = v.str(req.body.fullName, 'Full name', { min: 2, max: 120 });
  const phone = v.str(req.body.phone, 'Phone', { required: false, max: 30 });
  db.prepare('UPDATE users SET full_name = ?, phone = ? WHERE id = ?').run(fullName, phone, req.user.id);
  res.json({ user: { ...req.user, fullName, phone } });
}));

authRouter.post('/me/password', requireAuth, passwordLimit, wrap((req, res) => {
  const current = v.str(req.body.currentPassword, 'Current password', { trim: false, max: 200 });
  const next = v.password(req.body.newPassword, 'New password');

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current, row.password_hash)) throw unauthorized('Your current password is not right.');

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  // Sign every other device out; keep this one.
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.sessionToken);
  logActivity({ actorId: req.user.id, actorName: req.user.fullName, action: 'account.password_changed', entity: 'user', entityId: req.user.id });
  res.json({ ok: true });
}));
