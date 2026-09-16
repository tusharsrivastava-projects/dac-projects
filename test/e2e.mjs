const BASE = process.env.BASE || 'http://localhost:4111';
const jars = {};
let failures = 0;

function client(name) {
  jars[name] = '';
  return async (method, url, body, opts = {}) => {
    const headers = { cookie: jars[name] };
    let payload = body;
    if (body && !(body instanceof FormData)) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
    const set = r.headers.getSetCookie?.() || [];
    for (const c of set) {
      const [pair] = c.split(';');
      const [k] = pair.split('=');
      const rest = jars[name].split('; ').filter(Boolean).filter((p) => !p.startsWith(`${k}=`));
      jars[name] = [...rest, pair].join('; ');
    }
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    if (!opts.allowFail && !r.ok) { failures++; console.log(`  ✗ ${method} ${url} → ${r.status} ${text.slice(0,240)}`); }
    return { status: r.status, json, text };
  };
}

const ok = (label, cond, extra='') => { if (cond) console.log(`  ✓ ${label}`); else { failures++; console.log(`  ✗ ${label} ${extra}`); } };

const admin = client('admin');
const cand = client('cand');

console.log('\n1. auth');
let r = await admin('POST', '/api/auth/login', { email: 'admin@dgu.ac.in', password: 'dac-admin-2026' });
ok('admin login', r.json?.user?.role === 'admin', JSON.stringify(r.json));

const email = `test.${Date.now()}@dgu.ac.in`;
r = await cand('POST', '/api/auth/register', { fullName: 'Priya Nair', email, phone: '+91 99999 11111', password: 'testpass1' });
ok('candidate register', r.status === 201 && r.json?.user?.role === 'candidate', JSON.stringify(r.json));

r = await cand('POST', '/api/auth/register', { fullName: 'Someone Else', email, password: 'testpass1' }, { allowFail: true });
ok('duplicate email rejected', r.status === 409);
r = await cand('POST', '/api/auth/register', { fullName: 'Y', email: 'y@d.com', password: 'short' }, { allowFail: true });
ok('weak password rejected', r.status === 400);

console.log('\n2. roles + apply');
r = await cand('GET', '/api/jobs');
const job = r.json.jobs[0];
ok('roles listed', r.json.jobs.length >= 3, `got ${r.json?.jobs?.length}`);

r = await cand('POST', '/api/applications', {
  jobId: job.id, headline: 'Final-year CS, built two ML side projects',
  skills: 'Python, PyTorch, SQL', coverNote: 'I want to work on applied ML with real users, and the AI Cell ships things students actually use.',
  portfolioUrl: 'https://github.com/example',
});
const appId = r.json?.application?.id;
ok('application created', r.status === 201 && r.json.application.stage === 'applied', JSON.stringify(r.json).slice(0,200));

r = await cand('POST', '/api/applications', { jobId: job.id, headline: 'again', coverNote: 'a'.repeat(30) }, { allowFail: true });
ok('double apply blocked', r.status === 409);

console.log('\n3. interview locked until admin opens it');
r = await cand('GET', `/api/interview/${appId}`);
ok('interview not open yet', r.json.open === false);
ok('questions visible', r.json.questions.length >= 3, `got ${r.json?.questions?.length}`);

const fakeAudio = new Blob([Buffer.alloc(2048, 7)], { type: 'audio/webm' });
let fd = new FormData(); fd.append('audio', fakeAudio, 'a.webm'); fd.append('durationSeconds', '12');
r = await cand('POST', `/api/interview/${appId}/answers/${r.json.questions[0].id}`, fd, { allowFail: true });
ok('upload blocked while locked', r.status === 409, `${r.status} ${r.text.slice(0,120)}`);

console.log('\n4. admin review + unlock');
r = await admin('GET', '/api/applications?stage=applied');
ok('admin sees applications', r.json.applications.some(a => a.id === appId));
r = await admin('PATCH', `/api/applications/${appId}/stage`, { stage: 'screening' });
r = await admin('PATCH', `/api/applications/${appId}/stage`, { stage: 'interview' });
ok('interview unlocked', r.json?.application?.stage === 'interview');
r = await admin('PATCH', `/api/applications/${appId}/stage`, { stage: 'offer_sent' }, { allowFail: true });
ok('illegal stage jump blocked', r.status === 409);

console.log('\n5. admin feeds a question, candidate answers all');
r = await admin('POST', '/api/questions', {
  jobId: job.id, prompt: 'Describe the last thing you shipped that someone else actually used.',
  thinkSeconds: 20, answerSeconds: 90,
});
ok('question added', r.status === 201);

r = await cand('GET', `/api/interview/${appId}`);
ok('interview now open', r.json.open === true);
const questions = r.json.questions;
ok('new question reached candidate', questions.some(q => q.prompt.startsWith('Describe the last thing')));

for (const q of questions) {
  const fd2 = new FormData();
  fd2.append('audio', new Blob([Buffer.alloc(4096, 3)], { type: 'audio/webm' }), 'ans.webm');
  fd2.append('durationSeconds', '25');
  const up = await cand('POST', `/api/interview/${appId}/answers/${q.id}`, fd2);
  if (up.status !== 201) { failures++; console.log(`  ✗ upload q${q.id} → ${up.status} ${up.text.slice(0,160)}`); }
}
console.log(`  ✓ uploaded ${questions.length} recordings`);

fd = new FormData();
fd.append('audio', new Blob([Buffer.alloc(512)], { type: 'application/pdf' }), 'x.pdf');
r = await cand('POST', `/api/interview/${appId}/answers/${questions[0].id}`, fd, { allowFail: true });
ok('non-audio upload rejected', r.status === 400, `${r.status}`);

fd = new FormData();
fd.append('audio', new Blob([Buffer.alloc(1024)], { type: 'audio/webm' }), 'x.webm');
fd.append('durationSeconds', '9999');
r = await cand('POST', `/api/interview/${appId}/answers/${questions[0].id}`, fd, { allowFail: true });
ok('over-length answer rejected', r.status === 400, `${r.status}`);

r = await cand('POST', `/api/interview/${appId}/submit`);
ok('interview submitted', r.json?.application?.stage === 'evaluation', JSON.stringify(r.json).slice(0,200));
r = await cand('POST', `/api/interview/${appId}/submit`, {}, { allowFail: true });
ok('double submit blocked', r.status === 409);

console.log('\n6. evaluation');
r = await admin('GET', `/api/applications/${appId}`);
const answers = r.json.answers;
ok('admin sees recordings', answers.length === questions.length);
r = await admin('GET', answers[0].audioUrl);
ok('admin can stream audio', r.status === 200);

// Range support lets the reviewer scrub rather than replay from the top.
{
  const full = await fetch(BASE + answers[0].audioUrl, { headers: { cookie: jars.admin } });
  const size = Number(full.headers.get('content-length'));
  ok('audio sends content-length', size > 0, String(size));
  ok('audio advertises ranges', full.headers.get('accept-ranges') === 'bytes');

  const part = await fetch(BASE + answers[0].audioUrl, { headers: { cookie: jars.admin, range: 'bytes=10-99' } });
  ok('range request returns 206', part.status === 206, String(part.status));
  ok('range content-range is right', part.headers.get('content-range') === `bytes 10-99/${size}`, part.headers.get('content-range'));
  ok('range body is the slice', (await part.arrayBuffer()).byteLength === 90);

  const open = await fetch(BASE + answers[0].audioUrl, { headers: { cookie: jars.admin, range: 'bytes=10-' } });
  ok('open-ended range clamps to EOF', open.headers.get('content-range') === `bytes 10-${size - 1}/${size}`, open.headers.get('content-range'));

  const bad = await fetch(BASE + answers[0].audioUrl, { headers: { cookie: jars.admin, range: `bytes=${size + 50}-` } });
  ok('out-of-bounds range gives 416', bad.status === 416, String(bad.status));
}
for (const [i, a] of answers.entries()) {
  await admin('POST', `/api/interview/answers/${a.id}/evaluate`, { score: 7 + (i % 3), feedback: 'Clear, concrete answer.' });
}
r = await admin('GET', `/api/applications/${appId}`);
ok('application score computed', typeof r.json.application.score === 'number', `score=${r.json.application.score}`);

console.log('\n7. approve + offer');
r = await admin('PATCH', `/api/applications/${appId}/stage`, { stage: 'approved' });
ok('approved', r.json?.application?.stage === 'approved');

r = await admin('POST', '/api/offers', {
  applicationId: appId, compensation: '₹15,000 / month', startDate: '2026-11-03',
  location: 'Dehradun, IN (hybrid)', reportingTo: 'Lead, Applied ML',
  expiresOn: '2026-10-15', extraTerms: 'Six-month term, reviewed at the end.\n\nLaptop provided by the Cell.',
});
const offerId = r.json?.offer?.id;
ok('offer drafted', r.status === 201 && r.json.offer.status === 'draft');

r = await admin('POST', `/api/offers/${offerId}/send`);
const link = r.json?.link;
ok('offer sent', r.json?.offer?.status === 'sent' && !!link, link || '');

const token = link.split('/offer/')[1];
console.log('\n8. public offer link');
const guest = client('guest');
r = await guest('GET', `/api/public/offers/${token}`);
ok('public link opens without login', r.status === 200 && r.json.letterHtml.includes('Priya Nair'));
r = await guest('GET', `/api/public/offers/not-a-real-token`, null, { allowFail: true });
ok('bad token 404s', r.status === 404);

r = await guest('POST', `/api/public/offers/${token}/respond`, { decision: 'accept' });
ok('offer accepted', r.json?.status === 'accepted');
r = await guest('POST', `/api/public/offers/${token}/respond`, { decision: 'decline' }, { allowFail: true });
ok('double response blocked', r.status === 409);

r = await cand('GET', '/api/applications/mine');
ok('candidate sees accepted stage', r.json.applications[0].stage === 'offer_accepted', r.json.applications[0]?.stage);

console.log('\n9. admin views + isolation');
r = await admin('GET', '/api/admin/overview');
ok('overview stats', r.json.totals.applications >= 1 && r.json.pipeline.length > 0);
r = await admin('GET', '/api/admin/outbox');
ok('outbox has letters', r.json.messages.some(m => m.kind === 'offer.sent'));

const other = client('other');
await other('POST', '/api/auth/register', { fullName: 'Nosy Person', email: `nosy.${Date.now()}@dgu.ac.in`, password: 'testpass1' });
r = await other('GET', `/api/applications/${appId}`, null, { allowFail: true });
ok('other candidate cannot read application', r.status === 403);
r = await other('GET', answers[0].audioUrl, null, { allowFail: true });
ok('other candidate cannot stream audio', r.status === 403);
r = await other('GET', '/api/applications', null, { allowFail: true });
ok('candidate cannot list all applications', r.status === 403);
r = await other('POST', '/api/questions', { prompt: 'x'.repeat(20) }, { allowFail: true });
ok('candidate cannot add questions', r.status === 403);

r = await cand('POST', '/api/auth/logout');
r = await cand('GET', '/api/auth/me');
ok('logout clears session', r.json.user === null);

console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}\n`);
process.exit(failures ? 1 : 0);
