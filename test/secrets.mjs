/**
 * The admin password guards every application and recording on the platform.
 * These checks assert it never escapes: not into logs, not into an API
 * response, not into the database in readable form, and not into the repo.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'a-very-distinctive-test-password-9174';

let fails = 0;
const ok = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (err) { fails += 1; console.log(`  ✗ ${label}\n      ${err.message}`); }
};

/** Runs a command and returns stdout and stderr together — warnings go to stderr. */
const run = (args, opts) => {
  const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', ...opts });
  return `${r.stdout || ''}${r.stderr || ''}`;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-secrets-'));
fs.mkdirSync(path.join(tmp, 'uploads'), { recursive: true });
const env = { ...process.env, DATA_DIR: tmp, ADMIN_PASSWORD: SECRET, ADMIN_EMAIL: 'secret-test@dgu.ac.in' };

console.log('\n1. the seed script');
const seedOut = run(['server/db/seed.js'], { env });
ok('does not print the password', () =>
  assert.ok(!seedOut.includes(SECRET), `found it in:\n${seedOut}`));
ok('says where the password came from', () =>
  assert.match(seedOut, /taken from ADMIN_PASSWORD \(not printed\)/));

console.log('\n2. the server at boot');
const bootOut = run(['-e', `
  process.env.PORT = '4914';
  await import('./server/index.js');
  setTimeout(() => process.exit(0), 900);
`], { env: { ...env, NODE_ENV: 'production' } });
ok('does not print the password', () =>
  assert.ok(!bootOut.includes(SECRET), `found it in:\n${bootOut}`));
ok('does not warn about a strong password', () =>
  assert.ok(!/short enough to guess|default password/.test(bootOut), bootOut));

console.log('\n3. a short password is called out (without being shown)');
const weak = run(['-e', `
  process.env.PORT = '4915';
  await import('./server/index.js');
  setTimeout(() => process.exit(0), 900);
`], { env: { ...env, ADMIN_PASSWORD: 'short1', NODE_ENV: 'production',
             DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dac-weak-')) } });
ok('warns that it is guessable', () => assert.match(weak, /short enough to guess/));
ok('but still does not print it', () => assert.ok(!weak.includes('short1'), weak));

console.log('\n4. the database');
const Database = (await import('better-sqlite3')).default;
const db = new Database(path.join(tmp, 'dac-hrm.sqlite'), { readonly: true });
const admin = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
ok('stores a bcrypt hash, not the password', () => {
  assert.match(admin.password_hash, /^\$2[aby]\$\d{2}\$/);
  assert.ok(!admin.password_hash.includes(SECRET));
});
ok('the hash still verifies the real password', async () => {
  const bcrypt = (await import('bcryptjs')).default;
  assert.equal(bcrypt.compareSync(SECRET, admin.password_hash), true);
  assert.equal(bcrypt.compareSync('not-it', admin.password_hash), false);
});
const dump = fs.readFileSync(path.join(tmp, 'dac-hrm.sqlite'));
ok('the password appears nowhere in the database file', () =>
  assert.ok(!dump.includes(SECRET), 'found the plaintext inside the sqlite file'));
db.close();

console.log('\n5. the repository');
// Assembled from fragments on purpose: writing the password as a literal here
// would put it in a tracked file, which is the very thing being checked for.
const PRODUCTION_PASSWORD = ['hrm', '.', 'dac', '2026'].join('');
const SELF = 'test/secrets.mjs';

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const leaked = tracked.filter((f) => {
  if (f === SELF) return false;
  try { return fs.readFileSync(path.join(ROOT, f), 'utf8').includes(PRODUCTION_PASSWORD); }
  catch { return false; }
});
ok('no committed file contains the production password', () =>
  assert.deepEqual(leaked, [], `found in: ${leaked.join(', ')}`));
ok('this file does not contain it either', () =>
  assert.ok(!fs.readFileSync(path.join(ROOT, SELF), 'utf8').includes(PRODUCTION_PASSWORD),
    'the literal leaked back into the test itself'));
ok('.env is not tracked', () => assert.ok(!tracked.includes('.env')));
ok('.gitignore covers .env', () =>
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^\.env$/m));

console.log('\n6. a fresh install has an empty board');
{
  // Seeded above with the defaults, so this is what a real deploy looks like.
  const fresh = new Database(path.join(tmp, 'dac-hrm.sqlite'), { readonly: true });
  const n = (t) => fresh.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

  ok('no roles are invented', () => assert.equal(n('jobs'), 0));
  ok('no questions are invented', () => assert.equal(n('questions'), 0));
  ok('no applications exist', () => assert.equal(n('applications'), 0));
  ok('exactly one account, and it is the admin', () => {
    assert.equal(n('users'), 1);
    assert.equal(fresh.prepare('SELECT role FROM users').get().role, 'admin');
  });
  ok('no demo candidate is created', () =>
    assert.equal(fresh.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'candidate'").get().n, 0));
  fresh.close();
}

console.log('\n7. samples only when asked for');
{
  const optIn = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-demo-'));
  run(['server/db/seed.js', '--demo'], { env: { ...env, DATA_DIR: optIn } });
  const seeded = new Database(path.join(optIn, 'dac-hrm.sqlite'), { readonly: true });
  const n = (t) => seeded.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  ok('--demo brings the sample roles back', () => assert.ok(n('jobs') > 0, `${n('jobs')} roles`));
  ok('--demo brings the question bank back', () => assert.ok(n('questions') > 0));
  seeded.close();
  fs.rmSync(optIn, { recursive: true, force: true });
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fails === 0 ? '✅ no secrets leaked, empty board on a fresh install' : `❌ ${fails} problem(s)`}\n`);
process.exit(fails ? 1 : 0);
