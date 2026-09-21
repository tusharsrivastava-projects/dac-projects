import crypto from 'node:crypto';

/**
 * Google access tokens without a dependency on googleapis (~40MB) or
 * google-auth-library. Two ways in:
 *
 *   OAuth refresh token — what you want for a folder in someone's My Drive.
 *     Uploads are owned by that account and count against its quota.
 *
 *   Service account — only works for a Shared Drive. Service accounts have
 *     no storage quota of their own, so uploading into a personal My Drive
 *     folder fails with storageQuotaExceeded no matter how it is shared.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SKEW_MS = 60_000; // refresh a minute early rather than race the expiry

let cached = null; // { token, expiresAt }

export class GoogleAuthError extends Error {}

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Reads the service-account key from either raw JSON or base64 (for env vars). */
export function parseServiceAccount(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  if (!text.startsWith('{')) {
    try { text = Buffer.from(text, 'base64').toString('utf8'); } catch { /* fall through */ }
  }
  let key;
  try { key = JSON.parse(text); } catch {
    throw new GoogleAuthError('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (or base64-encoded JSON).');
  }
  if (!key.client_email || !key.private_key) {
    throw new GoogleAuthError('Service account key is missing client_email or private_key.');
  }
  return key;
}

function signedAssertion(key, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: key.client_email,
    scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
    ...(key.subject ? { sub: key.subject } : {}),
  }));
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claim}`)
    .sign(key.private_key.replace(/\\n/g, '\n'), 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${claim}.${signature}`;
}

async function requestToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* keep raw text for the message */ }

  if (!res.ok) {
    const detail = data?.error_description || data?.error || text.slice(0, 200);
    throw new GoogleAuthError(`Google refused the token request (${res.status}): ${detail}`);
  }
  if (!data?.access_token) throw new GoogleAuthError('Google returned no access token.');
  return { token: data.access_token, expiresIn: Number(data.expires_in) || 3600 };
}

/**
 * Returns a cached access token, fetching a new one when it is close to expiry.
 * `creds` comes from config.drive.
 */
export async function getAccessToken(creds, { force = false } = {}) {
  if (!force && cached && cached.expiresAt - SKEW_MS > Date.now()) return cached.token;

  let result;
  if (creds.refreshToken) {
    if (!creds.clientId || !creds.clientSecret) {
      throw new GoogleAuthError('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are needed alongside GOOGLE_REFRESH_TOKEN.');
    }
    result = await requestToken({
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
    });
  } else if (creds.serviceAccount) {
    result = await requestToken({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedAssertion(creds.serviceAccount, creds.scope),
    });
  } else {
    throw new GoogleAuthError('No Google credentials configured. Set GOOGLE_REFRESH_TOKEN or GOOGLE_SERVICE_ACCOUNT_JSON.');
  }

  cached = { token: result.token, expiresAt: Date.now() + result.expiresIn * 1000 };
  return cached.token;
}

/** Drops the cached token. Used after a 401 so the next call re-authenticates. */
export const resetTokenCache = () => { cached = null; };
