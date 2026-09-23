import crypto from 'node:crypto';
import express from 'express';
import { db, logActivity } from '../db/index.js';
import {
  clearSessionCookie, createSession, destroySession,
  hashPassword, setSessionCookie, verifyPassword,
} from '../lib/auth.js';
import { badRequest, conflict, unauthorized, wrap } from '../lib/http.js';
import * as v from '../lib/validate.js';
import {
  GoogleSignInError, consentUrl, exchangeCode, googleSignInConfigured,
  redirectUri, signState, verifyState,
} from '../lib/googleAuth.js';
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
const googleLimit = rateLimit({
  max: 20, windowMs: 15 * 60 * 1000,
  message: 'Too many sign-in attempts from here. Wait a few minutes.',
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
  authProvider: u.auth_provider ?? u.authProvider ?? 'password',
  avatarUrl: u.avatar_url ?? u.avatarUrl ?? null,
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

/* ── Sign in with Google ───────────────────────────────────────────────────
   Candidates only. Admin accounts stay password-only on purpose: the admin
   console can approve people and issue offers, so who can reach it should not
   depend on an external directory we do not control.
   ───────────────────────────────────────────────────────────────────────── */

authRouter.get('/google/available', (_req, res) =>
  res.json({ available: googleSignInConfigured() }));

authRouter.get('/google', wrap((req, res) => {
  if (!googleSignInConfigured()) {
    throw badRequest('Google sign-in is not configured on this deployment.');
  }
  const redirect = redirectUri(req);
  const state = signState({ next: typeof req.query.next === 'string' ? req.query.next : '/app' });
  res.redirect(consentUrl({ redirect, state }));
}));

const failed = (res, message) =>
  res.redirect(`/?google_error=${encodeURIComponent(message)}`);

authRouter.get('/google/callback', googleLimit, wrap(async (req, res) => {
  if (!googleSignInConfigured()) return failed(res, 'Google sign-in is not configured.');
  if (req.query.error) {
    return failed(res, req.query.error === 'access_denied'
      ? 'You cancelled the Google sign-in.'
      : 'Google could not complete the sign-in.');
  }

  let next = '/app';
  try {
    ({ next } = verifyState(req.query.state));
    const profile = await exchangeCode(String(req.query.code || ''), redirectUri(req));

    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.googleId)
      || db.prepare('SELECT * FROM users WHERE email = ?').get(profile.email);

    if (user && user.role === 'admin') {
      // Linking would let anyone holding that Google account reach the console.
      return failed(res, 'That address belongs to an admin account. Sign in with your password instead.');
    }
    if (user && user.status !== 'active') {
      return failed(res, 'This account has been disabled. Contact the AI Cell office.');
    }

    if (!user) {
      // A password nobody holds: the column is NOT NULL, and password sign-in
      // for this account must never match anything.
      const unusable = hashPassword(crypto.randomBytes(32).toString('base64url'));
      const id = db.prepare(`
        INSERT INTO users (full_name, email, password_hash, role, auth_provider, google_id, avatar_url)
        VALUES (?, ?, ?, 'candidate', 'google', ?, ?)
      `).run(profile.name, profile.email, unusable, profile.googleId, profile.avatar).lastInsertRowid;
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      logActivity({ actorId: id, actorName: profile.name, action: 'account.registered.google', entity: 'user', entityId: id });
    } else if (!user.google_id) {
      // Same verified address, so this is the same person arriving a new way.
      db.prepare('UPDATE users SET google_id = ?, avatar_url = COALESCE(?, avatar_url) WHERE id = ?')
        .run(profile.googleId, profile.avatar, user.id);
      logActivity({ actorId: user.id, actorName: user.full_name, action: 'account.linked.google', entity: 'user', entityId: user.id });
    }

    const { token, expiresAt } = createSession(user.id, req.get('user-agent'));
    setSessionCookie(res, token, expiresAt);
    logActivity({ actorId: user.id, actorName: user.full_name, action: 'account.login.google', entity: 'user', entityId: user.id });
    res.redirect(next.startsWith('/') ? next : '/app');
  } catch (err) {
    if (err instanceof GoogleSignInError) return failed(res, err.message);
    console.error('[google] sign-in failed', err);
    return failed(res, 'Something went wrong signing you in with Google.');
  }
}));
