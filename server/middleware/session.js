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

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Admin access only.'));
  next();
}

export function requireCandidate(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'candidate') {
    return next(forbidden('This area is for candidate accounts.'));
  }
  next();
}
