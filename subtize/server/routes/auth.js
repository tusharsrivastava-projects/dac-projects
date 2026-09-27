import express from 'express';
import { db, logActivity } from '../db/index.js';
import {
  clearSessionCookie, consumeOtp, createSession, dashboardFor, destroySession, destroyUserSessions,
  hashPassword, issueOtp, listSessions, setSessionCookie, verifyPassword,
} from '../lib/auth.js';
import { badRequest, conflict, forbidden, unauthorized, wrap } from '../lib/http.js';
import { referralCode, userPublicId } from '../lib/ids.js';
import { echoCodes, sendMail } from '../lib/mailer.js';
import * as v from '../lib/validate.js';
import { loginKey, rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/session.js';

export const authRouter = express.Router();

const loginLimit = rateLimit({
  max: 8, windowMs: 15 * 60 * 1000, key: loginKey, onlyFailures: true,
  message: 'Too many failed sign-in attempts. Wait a few minutes and try again.',
});
const registerLimit = rateLimit({ max: 10, windowMs: 60 * 60 * 1000, message: 'Too many accounts created from here. Try again later.' });
const otpSendLimit = rateLimit({ max: 6, windowMs: 15 * 60 * 1000, key: loginKey, message: 'Too many codes requested. Wait a few minutes.' });
const otpCheckLimit = rateLimit({ max: 12, windowMs: 15 * 60 * 1000, key: loginKey, onlyFailures: true, message: 'Too many wrong codes. Wait a few minutes.' });

export function sessionUser(u) {
  return {
    id: u.id,
    publicId: u.public_id,
    fullName: u.full_name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    emailVerified: Boolean(u.email_verified),
    avatarUrl: u.avatar_path ? `/uploads/${u.avatar_path}` : null,
    city: u.city,
    preferredArea: u.preferred_area,
    referralCode: u.referral_code,
  };
}

const PURPOSE_COPY = {
  verify: ['Verify your Subtize.ai account', 'Use this code to verify your email'],
  login: ['Your Subtize.ai sign-in code', 'Use this code to sign in'],
  reset: ['Reset your Subtize.ai password', 'Use this code to reset your password'],
};

/** Sends a code and says how it went. The code itself only comes back in local dev. */
async function deliverOtp(email, purpose) {
  const { code, minutes } = issueOtp(email, purpose);
  const [subject, lead] = PURPOSE_COPY[purpose];
  await sendMail({
    to: email,
    subject,
    text: `${lead}: ${code}\n\nIt expires in ${minutes} minutes. If you did not ask for this, ignore this email.\n\n— Subtize.ai`,
  });
  return { sentTo: email, expiresInMinutes: minutes, ...(echoCodes() ? { devOtp: code } : {}) };
}

function signIn(req, res, user) {
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  const { token, expiresAt } = createSession(user.id, req.get('user-agent'));
  setSessionCookie(res, token, expiresAt);
  return { user: sessionUser(user), redirect: dashboardFor(user.role) };
}

function blockedReason(user) {
  if (user.status === 'banned') return 'This account has been banned. Contact support if you think this is a mistake.';
  if (user.status === 'suspended') return `This account is suspended${user.status_reason ? `: ${user.status_reason}` : '.'} Contact support.`;
  if (user.status === 'inactive') return 'This account is deactivated. Contact support to reactivate it.';
  return null;
}

authRouter.post('/register', registerLimit, wrap(async (req, res) => {
  const fullName = v.str(req.body.fullName, 'Full name', { min: 2, max: 120 });
  const email = v.email(req.body.email);
  const phone = v.phone(req.body.phone, 'Phone', { required: false });
  const password = v.password(req.body.password);
  const ref = v.str(req.body.referralCode, 'Referral code', { required: false, max: 12 });

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing?.email_verified) throw conflict('An account already uses that email. Sign in instead.');

  const referrer = ref ? db.prepare('SELECT id FROM users WHERE referral_code = ? COLLATE NOCASE').get(ref) : null;

  // An unverified signup can be retried with new details; nobody else could have used it.
  if (existing) {
    db.prepare("UPDATE users SET full_name = ?, phone = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(fullName, phone, hashPassword(password), existing.id);
  } else {
    const id = db.prepare(
      `INSERT INTO users (public_id, full_name, email, phone, password_hash, role, referral_code, referred_by)
       VALUES (?, ?, ?, ?, ?, 'user', ?, ?)`,
    ).run(userPublicId(), fullName, email, phone, hashPassword(password), referralCode(), referrer?.id ?? null).lastInsertRowid;
    logActivity({ actor: { id, fullName }, action: 'account.registered', entity: 'user', entityId: id });
  }

  res.status(201).json({ pendingVerification: true, ...(await deliverOtp(email, 'verify')) });
}));

authRouter.post('/verify-otp', otpCheckLimit, wrap((req, res) => {
  const email = v.email(req.body.email);
  const purpose = ['verify', 'login'].includes(req.body.purpose) ? req.body.purpose : 'verify';
  const result = consumeOtp(email, purpose, req.body.code);
  if (!result.ok) throw badRequest(result.reason, { field: 'code' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) throw badRequest('No account uses that email.');
  const blocked = blockedReason(user);
  if (blocked) throw forbidden(blocked);
  if (!user.email_verified) {
    db.prepare("UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?").run(user.id);
    user.email_verified = 1;
  }
  res.json(signIn(req, res, user));
}));

authRouter.post('/resend-otp', otpSendLimit, wrap(async (req, res) => {
  const email = v.email(req.body.email);
  const purpose = ['verify', 'login', 'reset'].includes(req.body.purpose) ? req.body.purpose : 'verify';
  const user = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(email);
  // Answer the same way whether or not the account exists.
  if (!user || (purpose === 'verify' && user.email_verified)) return res.json({ sentTo: email });
  res.json(await deliverOtp(email, purpose));
}));

authRouter.post('/login', loginLimit, wrap(async (req, res) => {
  const email = v.email(req.body.email);
  const password = v.str(req.body.password, 'Password', { trim: false, max: 200 });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) throw unauthorized('That email and password do not match.');
  const blocked = blockedReason(user);
  if (blocked) throw forbidden(blocked);
  if (!user.email_verified) {
    return res.json({ pendingVerification: true, ...(await deliverOtp(email, 'verify')) });
  }
  logActivity({ actor: user, action: 'account.login', entity: 'user', entityId: user.id });
  res.json(signIn(req, res, user));
}));

/** Passwordless: a code to the inbox signs you in. */
authRouter.post('/login-otp', otpSendLimit, wrap(async (req, res) => {
  const email = v.email(req.body.email);
  const user = db.prepare('SELECT id, status FROM users WHERE email = ?').get(email);
  if (!user || user.status !== 'active') return res.json({ sentTo: email, expiresInMinutes: 10 });
  res.json(await deliverOtp(email, 'login'));
}));

authRouter.post('/forgot', otpSendLimit, wrap(async (req, res) => {
  const email = v.email(req.body.email);
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) return res.json({ sentTo: email, expiresInMinutes: 10 });
  res.json(await deliverOtp(email, 'reset'));
}));

authRouter.post('/reset', otpCheckLimit, wrap((req, res) => {
  const email = v.email(req.body.email);
  const password = v.password(req.body.password, 'New password');
  const result = consumeOtp(email, 'reset', req.body.code);
  if (!result.ok) throw badRequest(result.reason, { field: 'code' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) throw badRequest('No account uses that email.');
  db.prepare("UPDATE users SET password_hash = ?, email_verified = 1, updated_at = datetime('now') WHERE id = ?")
    .run(hashPassword(password), user.id);
  destroyUserSessions(user.id); // a reset should sign out every other device
  logActivity({ actor: user, action: 'account.password_reset', entity: 'user', entityId: user.id });
  const blocked = blockedReason(user);
  if (blocked) return res.json({ reset: true, signedIn: false });
  res.json({ reset: true, ...signIn(req, res, { ...user, email_verified: 1 }) });
}));

authRouter.post('/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.post('/logout-all', requireAuth, (req, res) => {
  destroyUserSessions(req.user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: sessionUser(u), redirect: dashboardFor(u.role) });
});

authRouter.get('/sessions', requireAuth, (req, res) => res.json({ sessions: listSessions(req.user.id) }));

authRouter.post('/change-password', requireAuth, loginLimit, wrap((req, res) => {
  const current = v.str(req.body.currentPassword, 'Current password', { trim: false });
  const next = v.password(req.body.newPassword, 'New password');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current, u.password_hash)) throw badRequest('Your current password is not right.', { field: 'currentPassword' });
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hashPassword(next), u.id);
  logActivity({ actor: req.user, action: 'account.password_changed', entity: 'user', entityId: u.id });
  res.json({ ok: true });
}));
