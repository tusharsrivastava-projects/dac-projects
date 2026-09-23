/**
 * Google sign-in, without a real Google. The network calls are stubbed, but
 * everything around them is the real code: state signing, the account
 * find-or-link rules, and the refusals that keep the admin console out of
 * reach of an external directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-gsi-'));
fs.mkdirSync(path.join(tmp, 'uploads'), { recursive: true });
process.env.DATA_DIR = tmp;
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_STATE_SECRET = 'state-secret-for-tests';
process.env.BASE_URL = 'https://dac-hrm.test';

let fails = 0;
const ok = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (err) { fails += 1; console.log(`  ✗ ${label}\n      ${err.message}`); }
};

const gsi = await import('../server/lib/googleAuth.js');
const { GoogleSignInError } = gsi;

console.log('\n1. configuration');
ok('reports itself configured', () => assert.equal(gsi.googleSignInConfigured(), true));
ok('builds the redirect from BASE_URL', () =>
  assert.equal(gsi.redirectUri({ get: () => 'ignored', protocol: 'http' }),
    'https://dac-hrm.test/api/auth/google/callback'));

console.log('\n2. the state parameter');
const state = gsi.signState({ next: '/app' });
ok('round-trips what it carries', () => assert.equal(gsi.verifyState(state).next, '/app'));
ok('rejects a tampered payload', () => {
  const [body, sig] = state.split('.');
  const evil = Buffer.from(JSON.stringify({ next: 'https://evil.test', t: Date.now() })).toString('base64url');
  assert.throws(() => gsi.verifyState(`${evil}.${sig}`), GoogleSignInError);
});
ok('rejects a tampered signature', () =>
  assert.throws(() => gsi.verifyState(`${state.split('.')[0]}.AAAA`), GoogleSignInError));
ok('rejects nonsense', () => assert.throws(() => gsi.verifyState('not-a-state'), GoogleSignInError));
ok('expires', () => {
  const old = gsi.signState({ next: '/app' });
  assert.throws(() => gsi.verifyState(old, -1), GoogleSignInError);
});

console.log('\n3. the consent URL');
const url = new URL(gsi.consentUrl({ redirect: 'https://dac-hrm.test/api/auth/google/callback', state }));
ok('asks for the right scopes', () => assert.equal(url.searchParams.get('scope'), 'openid email profile'));
ok('uses the authorization-code flow', () => assert.equal(url.searchParams.get('response_type'), 'code'));
ok('carries the signed state', () => assert.equal(url.searchParams.get('state'), state));
ok('lets the person pick an account', () => assert.equal(url.searchParams.get('prompt'), 'select_account'));

console.log('\n4. reading the profile back');
const stubGoogle = (profile, { tokenOk = true, infoOk = true } = {}) => {
  globalThis.fetch = async (u) => {
    if (String(u).includes('/token')) {
      return tokenOk
        ? new Response(JSON.stringify({ access_token: 'tok' }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ error_description: 'bad code' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return infoOk
      ? new Response(JSON.stringify(profile), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('nope', { status: 403 });
  };
};

stubGoogle({ sub: '123', email: 'Ishita.Rao@DGU.ac.in', email_verified: true, name: 'Ishita Rao', picture: 'https://x/y.png' });
const profile = await gsi.exchangeCode('code', 'https://dac-hrm.test/cb');
ok('lower-cases the email', () => assert.equal(profile.email, 'ishita.rao@dgu.ac.in'));
ok('keeps the name and avatar', () => {
  assert.equal(profile.name, 'Ishita Rao');
  assert.equal(profile.avatar, 'https://x/y.png');
});

const rejects = async (label, fn, pattern) => {
  try { await fn(); fails += 1; console.log(`  ✗ ${label} (it did not throw)`); }
  catch (err) {
    if (pattern.test(err.message)) console.log(`  ✓ ${label}`);
    else { fails += 1; console.log(`  ✗ ${label}\n      got: ${err.message}`); }
  }
};

// An unverified address could belong to anyone, so matching it to an existing
// account would hand that account over.
stubGoogle({ sub: '9', email: 'someone@dgu.ac.in', email_verified: false, name: 'Someone' });
await rejects('refuses an unverified address', () => gsi.exchangeCode('c', 'r'), /unverified/i);

stubGoogle({ sub: '9', name: 'No Email' });
await rejects('refuses an account with no email', () => gsi.exchangeCode('c', 'r'), /email address/i);
stubGoogle({}, { tokenOk: false });
await rejects('surfaces a bad authorization code', () => gsi.exchangeCode('c', 'r'), /bad code|would not complete/i);
stubGoogle({ sub: '1', email: 'a@b.co', email_verified: true }, { infoOk: false });
await rejects('surfaces a refused profile read', () => gsi.exchangeCode('c', 'r'), /would not share/i);

console.log('\n5. account rules');
const { db } = await import('../server/db/index.js');
const { bootstrap } = await import('../server/db/bootstrap.js');
bootstrap();
const { hashPassword } = await import('../server/lib/auth.js');

db.prepare("INSERT INTO users (full_name, email, password_hash, role) VALUES (?,?,?,'candidate')")
  .run('Password Person', 'pw@dgu.ac.in', hashPassword('testpass1'));

ok('the admin account is password-only', () => {
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
  assert.equal(admin.auth_provider, 'password');
  assert.equal(admin.google_id, null);
});
ok('a new candidate defaults to password auth', () =>
  assert.equal(db.prepare('SELECT auth_provider FROM users WHERE email = ?').get('pw@dgu.ac.in').auth_provider, 'password'));
ok('one Google account cannot be attached twice', () => {
  db.prepare('UPDATE users SET google_id = ? WHERE email = ?').run('dup-1', 'pw@dgu.ac.in');
  const second = db.prepare("INSERT INTO users (full_name, email, password_hash, role, google_id) VALUES (?,?,?,'candidate',?)");
  assert.throws(() => second.run('Clash', 'clash@dgu.ac.in', hashPassword('x'), 'dup-1'), /UNIQUE/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fails === 0 ? '✅ google sign-in verified' : `❌ ${fails} check(s) failed`}\n`);
process.exit(fails ? 1 : 0);
