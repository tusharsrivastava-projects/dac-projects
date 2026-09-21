#!/usr/bin/env node
/**
 * Walks the Google OAuth consent flow and prints a refresh token.
 *
 * Getting one by hand means juggling consent URLs, an authorisation code and
 * a token exchange before it expires. This does all three: it starts a
 * throwaway listener, hands you a link, and catches the redirect itself.
 *
 *   node scripts/google-auth.js
 *   node scripts/google-auth.js --scope drive     # full Drive access
 *   node scripts/google-auth.js --port 5555
 */
import http from 'node:http';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = Number(arg('port', 5555));
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = {
  'drive.file': 'https://www.googleapis.com/auth/drive.file',
  drive: 'https://www.googleapis.com/auth/drive',
};
const scopeKey = arg('scope', 'drive.file');
const scope = SCOPES[scopeKey];

if (!scope) {
  console.error(`Unknown scope "${scopeKey}". Use one of: ${Object.keys(SCOPES).join(', ')}`);
  process.exit(1);
}

const rule = (s = '') => console.log(`\n${s}\n${'─'.repeat(72)}`);

rule('DAC HRM — Google Drive authorisation');
console.log(`Scope:    ${scope}`);
console.log(`Redirect: ${REDIRECT}`);
console.log(`
If you have not made an OAuth client yet:

  1. console.cloud.google.com → pick or create a project
  2. APIs & Services → Library → enable "Google Drive API"
  3. APIs & Services → OAuth consent screen → External, add yourself
     under "Test users" (no verification needed while it is in testing)
  4. Credentials → Create credentials → OAuth client ID
       Application type: Web application
       Authorised redirect URI: ${REDIRECT}
  5. Copy the client ID and client secret below.
`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const clientId = (process.env.GOOGLE_CLIENT_ID || await rl.question('Client ID:     ')).trim();
const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || await rl.question('Client secret: ')).trim();
rl.close();

if (!clientId || !clientSecret) {
  console.error('\nBoth a client ID and a client secret are needed.');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const consentUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope,
  access_type: 'offline',   // without this there is no refresh token
  prompt: 'consent',        // force one even if you have approved before
  state,
})}`;

rule('Open this in your browser, then approve access');
console.log(consentUrl);
console.log('\nWaiting for the redirect…');

const page = (title, body, tone = '#5b23a0') => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;background:#f5f2fb;margin:0;display:grid;place-items:center;height:100vh">
  <div style="background:#fff;border-radius:16px;padding:40px 44px;max-width:460px;box-shadow:0 10px 40px rgba(40,16,72,.12)">
    <h1 style="margin:0 0 10px;font-size:20px;color:${tone}">${title}</h1>
    <p style="margin:0;color:#443b58;line-height:1.6">${body}</p>
  </div>
</body></html>`;

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }

    const err = url.searchParams.get('error');
    const got = url.searchParams.get('code');

    if (err) {
      res.writeHead(400, { 'content-type': 'text/html' })
         .end(page('Authorisation refused', `Google said: <code>${err}</code>. You can close this tab and try again.`, '#c81627'));
      server.close(); reject(new Error(err)); return;
    }
    if (url.searchParams.get('state') !== state) {
      res.writeHead(400, { 'content-type': 'text/html' })
         .end(page('State mismatch', 'That redirect did not come from this session. Start again.', '#c81627'));
      server.close(); reject(new Error('state mismatch')); return;
    }

    res.writeHead(200, { 'content-type': 'text/html' })
       .end(page('Authorised', 'Your refresh token is printed in the terminal. You can close this tab.'));
    server.close(); resolve(got);
  });

  server.on('error', (e) => reject(
    e.code === 'EADDRINUSE'
      ? new Error(`Port ${PORT} is already in use. Try: node scripts/google-auth.js --port 5556`)
      : e,
  ));
  server.listen(PORT);
  setTimeout(() => { server.close(); reject(new Error('Timed out after five minutes.')); }, 300_000).unref();
});

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: REDIRECT, grant_type: 'authorization_code',
  }),
});
const data = await res.json();

if (!res.ok || !data.refresh_token) {
  rule('That did not work');
  console.error(data.error_description || data.error || JSON.stringify(data, null, 2));
  if (res.ok && !data.refresh_token) {
    console.error('\nGoogle returned an access token but no refresh token. That happens when you have\nalready approved this client — revoke it at myaccount.google.com/permissions and retry.');
  }
  process.exit(1);
}

rule('Done — put these in your environment');
console.log(`GOOGLE_CLIENT_ID=${clientId}`);
console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}`);
console.log(`GOOGLE_DRIVE_SCOPE=${scope}`);
console.log('STORAGE_DRIVER=drive');
console.log(`
Treat the refresh token like a password — it grants ${scopeKey === 'drive' ? 'full' : 'app-created-file'} access to
your Drive until you revoke it at myaccount.google.com/permissions.

On Render, add these under Environment (mark the secret and token as secret
values), then redeploy. The server checks Drive at boot and tells you the
folder it will file recordings into.
`);
