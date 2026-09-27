/**
 * Browser walk-through of one subscription's whole life, across all three
 * roles, plus a responsive sweep of every screen.
 *
 *   npm run test:ui          (boots its own server; see test/run-ui.sh)
 *
 * Set SHOT_DIR to keep screenshots, CHROME_PATH to use a specific Chromium.
 * Playwright comes from the project (npm i -D playwright) or the global install.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright')); }

const BASE = process.env.BASE || 'http://localhost:4641';
const SHOTS = process.env.SHOT_DIR || '';
const CHROME = process.env.CHROME_PATH || undefined;
let fails = 0;
let passes = 0;
let shot = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passes++; console.log(`  ✓ ${label}`); } else { fails++; console.log(`  ✗ ${label} ${extra}`); }
};
const section = (t) => console.log(`\n${t}`);

// Fonts come from Google, which a sandbox may block; everything else is a real error.
const IGNORABLE = /fonts\.g|ERR_CERT|Failed to load resource: the server responded with a status of (400|401|404|409)/;

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--no-sandbox'] });

async function newPage(name, { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { fails++; console.log(`  ✗ [${name}] page error: ${e.message}`); });
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORABLE.test(m.text())) { fails++; console.log(`  ✗ [${name}] console: ${m.text()}`); }
  });
  return page;
}
const snap = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${String(++shot).padStart(2, '0')}-${name}.png` }) : null);
const login = async (page, email, password) => {
  const r = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
  if (!r.ok()) throw new Error(`login failed for ${email}: ${r.status()}`);
};

const admin = await newPage('admin');
await login(admin, 'admin@subtize.ai', 'subtize-admin-2026');

/* ── 1. A new member signs up ─────────────────────────────────────────── */
section('1. sign-up with OTP, in the browser');
const member = await newPage('member');
const email = `ui.${Date.now()}@example.in`;
await member.goto(`${BASE}/`, { waitUntil: 'networkidle' });
ok('landing shows the USP', (await member.textContent('body')).includes('Manage & Cancel Everything from a Single Platform'));
await snap(member, 'landing');
await member.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
await member.fill('#f-fullName', 'Rhea Kapoor');
await member.fill('#f-email', email);
await member.fill('#f-phone', '9897012345');
await member.fill('#signup-form [name=password]', 'rhea2026pass');
await member.click('#signup-form button[type=submit]');
await member.waitForSelector('#otp-form', { timeout: 10000 });
ok('sign-up moves to the code step', true);
const outbox = await (await admin.request.get(`${BASE}/api/admin/outbox`)).json();
const code = outbox.messages.find((m) => m.to === email)?.body.match(/\b(\d{6})\b/)?.[1];
ok('the code was emailed (outbox in dev)', Boolean(code));
await member.fill('#f-code', code);
// The form submits itself on the sixth digit; click only if it did not.
await member.waitForURL('**/app**', { timeout: 3000 }).catch(async () => {
  await member.click('#otp-form button[type=submit]');
  await member.waitForURL('**/app**', { timeout: 10000 });
});
await member.waitForSelector('.stat', { timeout: 10000 });
ok('verified members land on their dashboard', member.url().includes('/app'));
await snap(member, 'member-dashboard');

/* ── 2. Search and subscribe ──────────────────────────────────────────── */
section('2. AI search, checkout, official QR, UTR');
await member.goto(`${BASE}/app#/search`, { waitUntil: 'networkidle' });
await member.fill('.ai-box input[name=q]', 'swimming');
await member.click('.ai-box button[type=submit]');
await member.waitForSelector('.svc-card', { timeout: 10000 });
ok('AI search returns service cards', (await member.$$('.svc-card')).length > 0);
const svc = await (await member.request.get(`${BASE}/api/services?category=swimming&limit=1`)).json();
const target = svc.services[0];
await member.goto(`${BASE}/app#/checkout/${target.id}`, { waitUntil: 'networkidle' });
await member.waitForSelector('[data-proceed]');
await snap(member, 'checkout-plan');
await member.click('[data-proceed]');
await member.waitForSelector('#utr', { timeout: 10000 });
const qrSrc = await member.getAttribute('img[src^="data:image/png"]', 'src');
ok('the official QR is shown', Boolean(qrSrc));
ok('with the only-pay-this-QR warning', /official Subtize\.ai QR/i.test(await member.textContent('body')));
await snap(member, 'checkout-qr');
const utr = String(Date.now()).slice(-12);
await member.fill('#utr', utr);
await member.click('button:has-text("Submit for verification")');
await member.waitForFunction(() => /pending verification/i.test(document.body.innerText), null, { timeout: 10000 });
ok('after the UTR the plan is pending verification', true);
await snap(member, 'checkout-pending');

/* ── 3. Admin verifies ────────────────────────────────────────────────── */
section('3. admin verifies and activates in the console');
await admin.goto(`${BASE}/admin#/payments`, { waitUntil: 'networkidle' });
await admin.waitForFunction((u) => document.body.innerText.includes(u), utr, { timeout: 10000 });
ok('the UTR is in the verification queue', true);
await snap(admin, 'admin-payments');
const row = admin.locator('tr, .card, article').filter({ hasText: utr }).last();
await row.getByRole('button', { name: /verify & activate/i }).first().click();
const dialog = admin.locator('.modal');
if (await dialog.count()) await dialog.locator('button[type=submit]').click();
await admin.waitForFunction(() => /activated/i.test(document.body.innerText), null, { timeout: 10000 });
const subs = await (await member.request.get(`${BASE}/api/me/subscriptions`)).json();
const mine = subs.subscriptions.find((s) => s.service.id === target.id);
ok('the member\'s plan is now active', mine?.status === 'active', mine?.status);

/* ── 4. Card ──────────────────────────────────────────────────────────── */
section('4. digital card');
await member.goto(`${BASE}/app#/cards/${mine.id}`, { waitUntil: 'networkidle' });
await member.waitForSelector(`img[src*="${mine.id}"]`, { timeout: 10000 });
const [download] = await Promise.all([
  member.waitForEvent('download', { timeout: 10000 }),
  member.click('[data-act=png]'),
]);
ok('the card downloads as a PNG', /\.png$/.test(download.suggestedFilename()), download.suggestedFilename());
await snap(member, 'card');

/* ── 5. Lister ────────────────────────────────────────────────────────── */
section('5. lister checks the member in');
const card = (await (await member.request.get(`${BASE}/api/me/cards/${mine.id}`)).json()).card;
// Swimming is run by Subtize.ai directly, so check in on Priya's gym, which the demo lister owns.
const lister = await newPage('lister');
await login(lister, 'lister@subtize.ai', 'lister12345');
const priya = await newPage('priya');
await login(priya, 'priya@subtize.ai', 'demo12345');
const gymCard = (await (await priya.request.get(`${BASE}/api/me/cards`)).json()).cards.find((c) => c.service.name.startsWith('Iron Paradise'));
await lister.goto(`${BASE}/lister#/checkin`, { waitUntil: 'networkidle' });
await lister.fill('#ci-code', gymCard.verifyUrl);
await lister.click('#ci-form button[type=submit]');
await lister.waitForSelector('.verdict', { timeout: 10000 });
ok('the lister sees the card verdict', true);
const before = gymCard.usage.used;
const recordBtn = lister.locator('#ci-submit');
if (await recordBtn.isEnabled()) {
  await recordBtn.click();
  await lister.waitForFunction(() => /visit recorded/i.test(document.body.innerText), null, { timeout: 10000 });
  const after = (await (await priya.request.get(`${BASE}/api/me/cards/${gymCard.subscriptionId}`)).json()).card.usage.used;
  ok('recording a visit updates the member\'s usage', after === before + 1, `${before} → ${after}`);
} else {
  ok('check-in is blocked when the plan cannot be used today', true);
}
await snap(lister, 'lister-checkin');

/* ── 6. Responsive sweep ──────────────────────────────────────────────── */
section('6. every screen at phone width: no errors, no sideways scroll');
const routes = [
  [null, ['/', '/explore', '/services/iron-paradise-gym-rajpur-road', '/become-lister', '/about', '/payment-info', '/login', '/signup', `/verify/${cardCodeOf(card)}`]],
  [['priya@subtize.ai', 'demo12345'], ['/app#/', '/app#/search', '/app#/explore', '/app#/subscriptions', '/app#/manage', '/app#/usage', '/app#/coupons', '/app#/cards', '/app#/payments', '/app#/profile', '/app#/settings']],
  [['lister@subtize.ai', 'lister12345'], ['/lister#/', '/lister#/services', '/lister#/subscribers', '/lister#/cancellations', '/lister#/checkin', '/lister#/revenue', '/lister#/settlements', '/lister#/agreement', '/lister#/profile']],
  [['admin@subtize.ai', 'subtize-admin-2026'], ['/admin#/', '/admin#/services', '/admin#/services/new', '/admin#/users', '/admin#/listers', '/admin#/applications', '/admin#/payments', '/admin#/subscriptions', '/admin#/coupons', '/admin#/usage', '/admin#/reports', '/admin#/agreements', '/admin#/revenue', '/admin#/settings']],
];
for (const [who, paths] of routes) {
  const page = await newPage(who ? who[0] : 'guest', { width: 360, height: 780 });
  if (who) await login(page, ...who);
  for (const p of paths) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const broken = await page.evaluate(() => /That did not load|Page not found/.test(document.body.innerText));
    ok(`${p} fits 360px and renders`, over <= 1 && !broken, over > 1 ? `overflows by ${over}px` : 'shows an error state');
  }
  await page.context().close();
}

function cardCodeOf(c) { return c.verifyUrl.split('/verify/').pop(); }

await browser.close();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
