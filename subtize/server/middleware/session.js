import { config } from '../config.js';
import { readSession } from '../lib/auth.js';
import { forbidden, unauthorized } from '../lib/http.js';

/** Populates req.user from the session cookie. Never rejects. */
export function attachUser(req, _res, next) {
  req.sessionToken = req.cookies?.[config.sessionCookie] || null;
  req.user = readSession(req.sessionToken);
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Explorers and listers both subscribe to things; admins run the platform instead. */
export function requireMember(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role === 'admin') return next(forbidden('Admin accounts cannot hold subscriptions. Use an explorer account.'));
  next();
}

export function requireLister(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'lister') return next(forbidden('This area is for approved listers.'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Admin access only.'));
  next();
}
