import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * "Sign in with Google" for candidates — the authorization-code flow, done
 * against Google's endpoints directly rather than pulling in a passport stack.
 *
 * This is separate from lib/google.js, which mints tokens for writing to
 * Drive. Different grant, different scopes, different lifetime: these tokens
 * are used once to read the person's name and email, then thrown away. We
 * keep no Google token for a candidate.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export class GoogleSignInError extends Error {}

export const googleSignInConfigured = () =>
  Boolean(config.google.clientId && config.google.clientSecret);

/** Where Google sends the person back. Must match the console entry exactly. */
export function redirectUri(req) {
  if (config.google.redirectUri) return config.google.redirectUri;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const base = config.baseUrl || `${proto}://${req.get('host')}`;
  return `${base.replace(/\/+$/, '')}/api/auth/google/callback`;
}

/**
 * State is a signed, timestamped token rather than server-side scratch space,
 * so this keeps working across restarts and more than one instance. It carries
 * where to send the person afterwards.
 */
export function signState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', config.google.stateSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(state, maxAgeMs = 10 * 60 * 1000) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) throw new GoogleSignInError('That sign-in link is malformed. Start again.');

  const expected = crypto.createHmac('sha256', config.google.stateSecret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new GoogleSignInError('That sign-in attempt could not be verified. Start again.');
  }

  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { throw new GoogleSignInError('That sign-in link is malformed. Start again.'); }

  if (Date.now() - Number(payload.t || 0) > maxAgeMs) {
    throw new GoogleSignInError('That sign-in attempt took too long. Start again.');
  }
  return payload;
}

export function consentUrl({ redirect, state }) {
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  })}`;
}

/** Swaps the one-time code for a token, then reads who signed in. */
export async function exchangeCode(code, redirect) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new GoogleSignInError(data?.error_description || 'Google would not complete the sign-in. Try again.');
  }

  const who = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${data.access_token}` } });
  const profile = await who.json().catch(() => null);
  if (!who.ok || !profile?.sub) {
    throw new GoogleSignInError('Google signed you in but would not share your profile. Try again.');
  }

  // An unverified address could belong to anyone; matching it to an existing
  // account would hand that account over.
  if (profile.email && profile.email_verified === false) {
    throw new GoogleSignInError('That Google account has an unverified email address, so we cannot use it to sign in.');
  }
  if (!profile.email) {
    throw new GoogleSignInError('That Google account does not expose an email address, which we need.');
  }

  return {
    googleId: profile.sub,
    email: String(profile.email).toLowerCase(),
    name: profile.name || String(profile.email).split('@')[0],
    avatar: profile.picture || null,
  };
}
