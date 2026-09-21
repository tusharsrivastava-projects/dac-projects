/**
 * Exercises the Google Drive storage path without real credentials by
 * standing in for fetch and asserting on the requests we make.
 *
 * Covers what actually bites in production: token caching, the 401 retry,
 * the folder hierarchy, multipart upload shape, Range pass-through, and the
 * fallback that keeps a recording when Drive is unhappy.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-drive-'));
fs.mkdirSync(path.join(tmp, 'uploads'), { recursive: true });

process.env.DATA_DIR = tmp;
process.env.STORAGE_DRIVER = 'drive';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
process.env.GDRIVE_FOLDER_NAME = 'DAC Interview Submissions';

let fails = 0;
const ok = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (err) { fails += 1; console.log(`  ✗ ${label}\n      ${err.message}`); }
};

/* ── fetch stand-in ──────────────────────────────────────────────────────── */
let calls = [];
let folderCounter = 0;
let existingFolders = new Map();   // "parent/name" -> id
const scripted = { tokenStatus: 200, uploadStatus: 200, uploadBody: null, failNextWith401: false };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = init.method || 'GET';
  calls.push({ url: u, method, init });

  if (u.startsWith('https://oauth2.googleapis.com/token')) {
    if (scripted.tokenStatus !== 200) {
      return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, scripted.tokenStatus);
    }
    return json({ access_token: `tok-${calls.filter((c) => c.url.includes('/token')).length}`, expires_in: 3600 });
  }

  if (scripted.failNextWith401) {
    scripted.failNextWith401 = false;
    return json({ error: { message: 'Invalid Credentials' } }, 401);
  }

  // folder lookup
  if (u.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
    const q = decodeURIComponent(new URL(u).searchParams.get('q'));
    const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
    const parent = /'([^']+)' in parents/.exec(q)?.[1] ?? 'ROOT';
    const hit = existingFolders.get(`${parent}/${name}`);
    return json({ files: hit ? [{ id: hit, name }] : [] });
  }

  // folder create
  if (u.startsWith('https://www.googleapis.com/drive/v3/files?fields=id') && method === 'POST') {
    const body = JSON.parse(init.body);
    const id = `folder-${++folderCounter}`;
    existingFolders.set(`${body.parents?.[0] ?? 'ROOT'}/${body.name}`, id);
    return json({ id });
  }

  // upload
  if (u.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
    if (scripted.uploadStatus !== 200) {
      return json({ error: { message: 'quota', errors: [{ reason: scripted.uploadBody || 'storageQuotaExceeded' }] } }, scripted.uploadStatus);
    }
    return json({ id: 'file-1', name: 'Q1.webm', size: '4096', webViewLink: 'https://drive.google.com/file/d/file-1/view' });
  }

  // download
  if (u.includes('alt=media')) {
    const range = init.headers?.range;
    if (range) {
      return new Response('PARTIAL', { status: 206, headers: { 'content-type': 'audio/webm', 'content-length': '7', 'content-range': 'bytes 10-16/4096' } });
    }
    return new Response('FULLFILE', { status: 200, headers: { 'content-type': 'audio/webm', 'content-length': '8' } });
  }

  // delete
  if (method === 'DELETE') return new Response(null, { status: 204 });

  return json({ error: { message: `unexpected ${method} ${u}` } }, 500);
};

/* ── module under test ───────────────────────────────────────────────────── */
const storage = await import('../server/lib/storage.js');
const { resetTokenCache } = await import('../server/lib/google.js');

const application = {
  id: 42,
  candidate_name: 'Ishita Rao',
  candidate_email: 'ishita@dgu.ac.in',
  job_title: 'Machine Learning Intern',
  job_code: 'DAC-ML-66F8',
  drive_folder_id: null,
};
const question = { id: 7, prompt: 'Walk us through a project you finished.' };

const makeUpload = (name = 'ans_test.webm') => {
  fs.writeFileSync(path.join(tmp, 'uploads', name), Buffer.alloc(4096, 9));
  return { filename: name, mimetype: 'audio/webm;codecs=opus', size: 4096, path: path.join(tmp, 'uploads', name) };
};

console.log('\n1. authentication');
calls = [];
await storage.checkStorage();
const tokenCall = calls.find((c) => c.url.includes('/token'));
ok('sends a refresh_token grant', () => {
  const body = new URLSearchParams(tokenCall.init.body);
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'test-refresh-token');
  assert.equal(body.get('client_id'), 'test-client-id');
});
ok('authorises Drive calls with the bearer token', () => {
  const driveCall = calls.find((c) => c.url.includes('drive/v3'));
  assert.match(driveCall.init.headers.authorization, /^Bearer tok-/);
});

calls = [];
await storage.checkStorage();
ok('reuses the cached token instead of re-authenticating', () =>
  assert.equal(calls.filter((c) => c.url.includes('/token')).length, 0));

console.log('\n2. folder layout');
calls = [];
const stored = await storage.storeAnswer({ file: makeUpload(), application, question, questionNumber: 1 });
const created = calls.filter((c) => c.url.includes('files?fields=id') && c.method === 'POST').map((c) => JSON.parse(c.init.body).name);
ok('nests role and candidate under the root folder', () =>
  assert.deepEqual(created, ['Machine Learning Intern', 'Ishita Rao — app42']));
ok('records the candidate folder on the application', () =>
  assert.equal(application.drive_folder_id, 'folder-3'));

calls = [];
application.drive_folder_id = 'folder-3';
await storage.storeAnswer({ file: makeUpload('ans_2.webm'), application, question, questionNumber: 2 });
ok('does not re-resolve a folder it already knows', () =>
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.includes('files?fields=id')).length, 0));

console.log('\n3. upload');
ok('reports the file as living in Drive', () => {
  assert.equal(stored.storage, 'drive');
  assert.equal(stored.drive_file_id, 'file-1');
  assert.equal(stored.drive_link, 'https://drive.google.com/file/d/file-1/view');
});
ok('strips the codec suffix off the mime type', () => assert.equal(stored.mime_type, 'audio/webm'));
ok('removes the local copy once Drive has it', () =>
  assert.equal(fs.existsSync(path.join(tmp, 'uploads', 'ans_test.webm')), false));

calls = [];
await storage.storeAnswer({ file: makeUpload('ans_3.webm'), application, question, questionNumber: 3 });
const uploadCall = calls.find((c) => c.url.includes('/upload/drive/v3'));
ok('uploads as multipart/related', () =>
  assert.match(uploadCall.init.headers['content-type'], /^multipart\/related; boundary=/));
ok('names the file after the question and parents it correctly', () => {
  const text = uploadCall.init.body.toString('utf8', 0, 900);
  const meta = JSON.parse(/\{"name".*?\}(?=\r\n)/s.exec(text)[0]);
  assert.equal(meta.name, 'Q3 — Walk us through a project you finished.webm');
  assert.deepEqual(meta.parents, ['folder-3']);
  assert.match(meta.description, /Ishita Rao <ishita@dgu\.ac\.in>/);
});

ok('does not leave a double dot when the question ends in punctuation', () => {
  const text = uploadCall.init.body.toString('utf8', 0, 900);
  const meta = JSON.parse(/\{"name".*?\}(?=\r\n)/s.exec(text)[0]);
  assert.ok(!meta.name.includes('..'), `double dot in "${meta.name}"`);
  assert.ok(!/\s\.webm$/.test(meta.name), `trailing space in "${meta.name}"`);
});

console.log('\n4. playback');
const answer = { storage: 'drive', drive_file_id: 'file-1', mime_type: 'audio/webm', audio_file: 'ans_test.webm' };
const whole = await storage.readAnswer(answer);
ok('streams the whole file when no range is asked for', () => {
  assert.equal(whole.kind, 'stream');
  assert.equal(whole.status, 200);
  assert.equal(whole.contentLength, '8');
});
calls = [];
const part = await storage.readAnswer(answer, { range: 'bytes=10-16' });
ok('passes the Range header through to Drive', () =>
  assert.equal(calls.at(-1).init.headers.range, 'bytes=10-16'));
ok('mirrors Drive 206 and Content-Range back', () => {
  assert.equal(part.status, 206);
  assert.equal(part.contentRange, 'bytes 10-16/4096');
});

console.log('\n5. failure handling');
calls = [];
scripted.failNextWith401 = true;
resetTokenCache();
await storage.readAnswer(answer);
ok('re-authenticates once after a 401 and retries', () => {
  assert.equal(calls.filter((c) => c.url.includes('/token')).length, 2);
  assert.equal(calls.filter((c) => c.url.includes('alt=media')).length, 2);
});

scripted.uploadStatus = 403;
const fallback = await storage.storeAnswer({ file: makeUpload('ans_fallback.webm'), application, question, questionNumber: 4 });
ok('keeps the recording on disk when Drive rejects it', () => {
  assert.equal(fallback.storage, 'local');
  assert.equal(fallback.drive_file_id, null);
  assert.equal(fs.existsSync(path.join(tmp, 'uploads', 'ans_fallback.webm')), true);
});
scripted.uploadStatus = 200;

const { DriveError } = await import('../server/lib/drive.js');
const driveApi = await import('../server/lib/drive.js');
scripted.uploadStatus = 403;
let quotaMessage = '';
try {
  await driveApi.uploadFile(storage.driveCredentials(), { name: 'x.webm', mimeType: 'audio/webm', buffer: Buffer.alloc(8), parentId: 'folder-3' });
} catch (err) { quotaMessage = err.message; }
ok('explains the service-account quota trap rather than echoing Google', () => {
  assert.match(quotaMessage, /service account has no quota/i);
  assert.match(quotaMessage, /GOOGLE_REFRESH_TOKEN|Shared Drive/);
});
scripted.uploadStatus = 200;

calls = [];
scripted.tokenStatus = 400;
resetTokenCache();
const bad = await storage.checkStorage();
ok('surfaces an expired refresh token clearly', () => {
  assert.equal(bad.ok, false);
  assert.match(bad.error, /expired or revoked/i);
});
scripted.tokenStatus = 200;
resetTokenCache();

console.log('\n6. deletion');
calls = [];
await storage.removeAnswer({ storage: 'drive', drive_file_id: 'file-1', audio_file: 'gone.webm' });
ok('deletes the Drive file', () => {
  const del = calls.find((c) => c.method === 'DELETE');
  assert.ok(del, 'no DELETE was issued');
  assert.match(del.url, /files\/file-1/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fails === 0 ? '✅ drive path verified' : `❌ ${fails} check(s) failed`}\n`);
process.exit(fails ? 1 : 0);
