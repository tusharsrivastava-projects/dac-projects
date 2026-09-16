/**
 * Browser-level walk of the whole hiring flow, driven with a synthetic
 * microphone so the recording path is exercised for real.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npm run test:ui
 *
 * Set SHOT_DIR to collect screenshots of every step, BASE to point at a
 * server other than localhost:4111, CHROME_PATH to use a specific binary.
 */
import { chromium } from 'playwright';
const SP = process.env.SHOT_DIR || '';
const BASE = process.env.BASE || 'http://localhost:4111';
const CHROME = process.env.CHROME_PATH || undefined;
let fails = 0, shot = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗'} ${l}${c ? '' : ` ${x}`}`); if (!c) fails++; };

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});

const newCtx = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => { fails++; console.log(`  ✗ [${name}] pageerror: ${e.message}`); });
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_CERT_AUTHORITY_INVALID|fonts.googleapis/.test(m.text()))
      { fails++; console.log(`  ✗ [${name}] console: ${m.text()}`); }
  });
  return page;
};
const snap = async (page, name) =>
  SP ? page.screenshot({ path: `${SP}/ui-${String(++shot).padStart(2, '0')}-${name}.png` }) : null;

const email = `ui.${Date.now()}@dgu.ac.in`;

console.log('\n1. candidate registers');
const cand = await newCtx('cand');
await cand.goto(BASE, { waitUntil: 'networkidle' });
await cand.click('.auth-tab[data-tab=register]');
await cand.fill('#reg-name', 'Ishita Rao');
await cand.fill('#reg-email', email);
await cand.fill('#reg-phone', '+91 90000 12345');
await cand.fill('#reg-password', 'testpass1');
await snap(cand, 'register');
await cand.click('#register-form button[type=submit]');
await cand.waitForURL('**/app*', { timeout: 15000 });
await cand.waitForSelector('.hero', { timeout: 10000 });
await cand.waitForFunction(() => document.querySelector('#side-name')?.textContent === 'Ishita Rao', null, { timeout: 8000 }).catch(() => {});
const sideName = await cand.locator('#side-name').innerText();
ok('landed on candidate dashboard', sideName === 'Ishita Rao', 'sidebar shows: ' + sideName);
await snap(cand, 'cand-overview-empty');

console.log('\n2. candidate applies');
await cand.click('a[data-path="/roles"]');
await cand.waitForSelector('.job-card');
await cand.locator('.job-card').first().getByText('View & apply').click();
await cand.waitForSelector('.job-meta');
await snap(cand, 'cand-role-detail');
await cand.getByRole('button', { name: /Apply for this role/ }).click();
await cand.waitForSelector('#apply-form');
await cand.fill('#ap-headline', 'Final-year CS, two shipped ML side projects');
await cand.fill('#ap-skills', 'Python, PyTorch, SQL, a little React');
await cand.fill('#ap-experience', 'Built a retrieval bot for the campus handbook. Interned at a local analytics shop for a summer.');
await cand.fill('#ap-cover', 'I want to work on ML that real students use, not just benchmarks. The AI Cell ships things people actually open.');
await snap(cand, 'cand-apply-form');
await cand.click('button[form=apply-form]');
await cand.waitForSelector('.timeline', { timeout: 10000 });
ok('application created and detail shown', (await cand.locator('#page-title').innerText()).length > 0);
await snap(cand, 'cand-application');

console.log('\n3. admin reviews and opens the interview');
const admin = await newCtx('admin');
await admin.goto(BASE, { waitUntil: 'networkidle' });
await admin.fill('#login-email', 'admin@dgu.ac.in');
await admin.fill('#login-password', 'dac-admin-2026');
await admin.click('#login-form button[type=submit]');
await admin.waitForURL('**/admin*', { timeout: 15000 });
await admin.waitForSelector('.pipeline-bar', { timeout: 10000 });
ok('admin console loaded', (await admin.locator('#side-role').innerText()).toLowerCase() === 'admin console');
await snap(admin, 'admin-overview');

await admin.click('a[data-path="/applications"]');
await admin.waitForSelector('table.data tbody tr');
await snap(admin, 'admin-applications');
await admin.locator('table.data tbody tr', { hasText: 'Ishita Rao' }).first().click();
await admin.waitForSelector('.split');
await snap(admin, 'admin-application-detail');

await admin.getByRole('button', { name: 'Move to Screening' }).click();
await admin.getByRole('button', { name: /^Move to Screening$/ }).last().click();
await admin.waitForSelector('.toast', { timeout: 10000 });
await admin.waitForTimeout(900);
await admin.getByRole('button', { name: 'Move to Interview open' }).click();
await admin.waitForSelector('.modal');
await admin.locator('.modal-foot button', { hasText: 'Move to Interview open' }).click();
await admin.waitForTimeout(1400);
ok('moved to interview open', (await admin.locator('.pill').first().innerText()).includes('Interview'));

console.log('\n4. admin adds a question');
await admin.click('a[data-path="/questions"]');
await admin.waitForSelector('.chip-row');
await snap(admin, 'admin-questions');
await admin.getByRole('button', { name: /Add question/ }).first().click();
await admin.waitForSelector('#q-form');
await admin.fill('#q-prompt', 'What is the last thing you built that someone other than you actually used?');
await admin.fill('#q-hint', 'Numbers help, but a real story helps more.');
await admin.fill('#q-think', '5');
await admin.fill('#q-answer', '20');
await snap(admin, 'admin-question-form');
await admin.click('button[form=q-form]');
await admin.waitForTimeout(1200);
ok('question added to bank', await admin.getByText('What is the last thing you built').count() > 0);

console.log('\n5. candidate records the interview');
await cand.goto(`${BASE}/app#/interview`, { waitUntil: 'networkidle' });
await cand.waitForTimeout(800);
await cand.locator('.app-row').first().click();
await cand.waitForSelector('.iv-card', { timeout: 10000 });
const total = await cand.locator('.q-dot').count();
ok('interview screen shows questions', total >= 4, `saw ${total}`);
await snap(cand, 'cand-interview-ready');

for (let i = 0; i < total; i++) {
  await cand.locator('.q-dot').nth(i).click();
  await cand.waitForTimeout(250);
  const already = await cand.getByText('Answer recorded').count();
  if (already) continue;
  await cand.getByRole('button', { name: /I'm ready — start/ }).click();
  await cand.waitForSelector('#think-clock', { timeout: 10000 });
  if (i === 0) await snap(cand, 'cand-interview-thinking');
  await cand.getByRole('button', { name: /Start recording now/ }).click();
  await cand.waitForSelector('#rec-clock', { timeout: 10000 });
  if (i === 0) { await cand.waitForTimeout(2200); await snap(cand, 'cand-interview-recording'); }
  else await cand.waitForTimeout(1600);
  await cand.getByRole('button', { name: /Stop & keep this take/ }).click();
  await cand.waitForSelector('.playback', { timeout: 20000 });
}
ok('all answers recorded', await cand.locator('.q-dot.is-done').count() === total,
   `${await cand.locator('.q-dot.is-done').count()}/${total}`);
await snap(cand, 'cand-interview-recorded');

await cand.getByRole('button', { name: /Review & submit/ }).click();
await cand.waitForSelector('.modal');
await snap(cand, 'cand-interview-submit');
await cand.locator('.modal-foot button', { hasText: 'Submit for evaluation' }).click();
await cand.waitForTimeout(2000);
ok('interview submitted', (await cand.locator('.pill').first().innerText()).includes('Under review'),
   await cand.locator('.pill').first().innerText().catch(() => '?'));

console.log('\n6. admin scores and approves');
await admin.goto(`${BASE}/admin#/applications`, { waitUntil: 'networkidle' });
await admin.waitForSelector('table.data tbody tr');
await admin.locator('table.data tbody tr', { hasText: 'Ishita Rao' }).first().click();
await admin.waitForSelector('.answer-block audio', { timeout: 10000 });
const blocks = await admin.locator('.answer-block').count();
ok('admin sees the recordings', blocks === total, `${blocks} of ${total}`);
await snap(admin, 'admin-review-audio');

for (let i = 0; i < blocks; i++) {
  const b = admin.locator('.answer-block').nth(i);
  await b.locator('.score-input').fill(String(7 + (i % 3)));
  await b.locator('textarea').fill('Concrete and to the point.');
  await b.getByRole('button', { name: /score/i }).click();
  await admin.waitForTimeout(600);
}
ok('answers scored', true);

await admin.getByRole('button', { name: 'Move to Approved' }).click();
await admin.waitForSelector('.modal');
await admin.locator('.modal-foot button', { hasText: 'Move to Approved' }).click();
await admin.waitForTimeout(1600);

console.log('\n7. admin issues the offer');
await admin.getByRole('button', { name: /Draft offer letter/ }).click();
await admin.waitForSelector('#offer-form');
await admin.fill('#of-comp', '₹15,000 / month');
await admin.fill('#of-report', 'Lead, Applied ML');
await admin.fill('#of-terms', 'Six-month term, reviewed at the end.\n\nLaptop and compute provided by the Cell.');
await snap(admin, 'admin-offer-form');
await admin.click('button[form=offer-form]');
await admin.waitForTimeout(1600);
await admin.getByRole('button', { name: /Send to candidate/ }).click();
await admin.waitForSelector('.modal');
await admin.locator('.modal-foot button', { hasText: 'Send offer letter' }).click();
await admin.waitForTimeout(1800);
await snap(admin, 'admin-offer-sent');

await admin.goto(`${BASE}/admin#/offers`, { waitUntil: 'networkidle' });
await admin.waitForSelector('table.data tbody tr');
ok('offer listed in admin', await admin.getByText('Ishita Rao').count() > 0);
await snap(admin, 'admin-offers');

await admin.goto(`${BASE}/admin#/outbox`, { waitUntil: 'networkidle' });
await admin.waitForSelector('table.data tbody tr');
ok('offer letter queued in outbox', await admin.getByText('offer.sent').count() > 0);
await admin.locator('button', { hasText: 'Preview' }).first().click();
await admin.waitForSelector('.modal iframe');
await admin.waitForTimeout(900);
await snap(admin, 'admin-outbox-preview');
await admin.keyboard.press('Escape');

console.log('\n8. candidate opens and accepts the offer');
await cand.goto(`${BASE}/app#/offer`, { waitUntil: 'networkidle' });
await cand.waitForTimeout(900);
await cand.locator('.app-row').first().click();
await cand.waitForSelector('.dl', { timeout: 10000 });
await snap(cand, 'cand-offer-summary');

const link = await cand.locator('.mono').last().innerText();
const guest = await newCtx('guest');
await guest.goto(link.trim(), { waitUntil: 'networkidle' });
await guest.waitForSelector('.offer-sheet .offer-banner', { timeout: 10000 });
ok('public offer letter renders', (await guest.locator('.offer-banner h2').innerText()).includes('Congratulations'));
ok('letter names the candidate', (await guest.locator('.offer-sheet').innerText()).includes('Ishita Rao'));
await snap(guest, 'public-offer');

await guest.getByRole('button', { name: /Accept this offer/ }).click();
await guest.waitForSelector('.modal');
await guest.locator('.modal-foot button', { hasText: 'Yes, I accept' }).click();
await guest.waitForTimeout(2200);
ok('offer accepted', (await guest.locator('.offer-banner h2').innerText()).includes('accepted'),
   await guest.locator('.offer-banner h2').innerText().catch(() => '?'));
await snap(guest, 'public-offer-accepted');

console.log('\n9. mobile + logout');
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await mob.newPage();
await mp.goto(BASE, { waitUntil: 'networkidle' });
await snap(mp, 'mobile-landing');
await mp.fill('#login-email', 'admin@dgu.ac.in');
await mp.fill('#login-password', 'dac-admin-2026');
await mp.click('#login-form button[type=submit]');
await mp.waitForURL('**/admin*', { timeout: 15000 });
await mp.waitForSelector('.pipeline-bar', { timeout: 10000 });
await snap(mp, 'mobile-admin');
await mp.click('#menu-toggle');
await mp.waitForTimeout(500);
ok('mobile drawer opens', await mp.locator('body.nav-open').count() === 1);
await snap(mp, 'mobile-drawer');

await cand.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
await cand.waitForSelector('#btn-logout');
await cand.click('#btn-logout');
await cand.waitForURL(`${BASE}/`, { timeout: 10000 });
ok('logout returns to sign-in', await cand.locator('#login-form').count() === 1);

console.log(`\n${fails === 0 ? '✅ UI flow clean' : `❌ ${fails} problem(s)`}\n`);
await browser.close();
process.exit(fails ? 1 : 0);
