/**
 * API walk-through of the whole platform against a freshly seeded demo:
 * sign-up with OTP, AI search, checkout with the official QR, UTR submission,
 * admin verification, cards and usage, the lister journey from application to
 * signed agreement, admin finance — and the privacy rules at every step.
 */
const BASE = process.env.BASE || 'http://localhost:4611';
let failures = 0;
let passes = 0;

function client(name) {
  let jar = '';
  return async (method, url, body, opts = {}) => {
    const headers = { cookie: jar };
    let payload = body;
    if (body && !(body instanceof FormData)) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
    for (const c of r.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const [k] = pair.split('=');
      jar = [...jar.split('; ').filter(Boolean).filter((p) => !p.startsWith(`${k}=`)), pair].join('; ');
    }
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    if (!opts.allowFail && !r.ok) { failures++; console.log(`  ✗ [${name}] ${method} ${url} → ${r.status} ${text.slice(0, 300)}`); }
    return { status: r.status, json, text, headers: r.headers };
  };
}

const ok = (label, cond, extra = '') => {
  if (cond) { passes++; console.log(`  ✓ ${label}`); } else { failures++; console.log(`  ✗ ${label} ${extra}`); }
};
const section = (t) => console.log(`\n${t}`);

const PROVIDER_SECRETS = ['Fit Nation Ventures', 'Rohan Mehta', 'lister@subtize.ai', 'HDFC', 'okhdfcbank', 'provider', 'listerId', 'lister_id', 'SUBV-', 'bank', 'GSTIN'];
const leaks = (text) => PROVIDER_SECRETS.filter((s) => text.includes(s));

const admin = client('admin');
const guest = client('guest');
const user = client('user');
const lister = client('lister');
const applicant = client('applicant');

section('1. public catalogue and privacy');
let r = await guest('GET', '/api/meta');
ok('meta lists 15 categories', r.json?.categories?.length === 15, r.json?.categories?.length);
ok('and 100+ live services', r.json.stats.services >= 100, r.json.stats.services);

r = await guest('GET', '/api/services?limit=100');
ok('explorers can browse without an account', r.json?.services?.length > 50);
ok('every card carries the subscriber count sentence', r.json.services.every((s) => /\d+ subscribers? currently subscribed/.test(s.subscriberLabel)));
ok('no provider identity, banking or verification data leaks into the catalogue', leaks(r.text).length === 0, leaks(r.text).join(', '));

const gym = r.json.services.find((s) => s.name === 'Iron Paradise Gym, Rajpur Road');
r = await guest('GET', `/api/services/${gym.slug}`);
ok('service detail loads by slug', r.json?.service?.id === gym.id);
ok('detail shows available days before subscribing', r.json.service.availableDayNames.length > 0);
ok('detail shows the usage policy', 'allowed' in r.json.service.usagePolicy && r.json.service.usagePolicy.rules);
ok('detail does not leak provider info either', leaks(r.text).length === 0, leaks(r.text).join(', '));

r = await guest('GET', '/api/services?category=gym&maxPrice=1000&lat=30.344&lng=78.061&distance=5');
ok('filters: category + price + distance', r.json.services.length > 0 && r.json.services.every((s) => s.monthlyPrice <= 100000 && s.distanceKm <= 5 && s.category.slug === 'gym'));
r = await guest('GET', '/api/services?days=sat,sun');
ok('filters: availability days', r.json.services.every((s) => s.availableDays.includes('sat') && s.availableDays.includes('sun')));
r = await guest('GET', '/api/services?duration=6&offers=1');
ok('filters: duration and offers', r.json.services.every((s) => s.plans.includes(6) && s.hasOffer));
r = await guest('GET', '/api/services?type=online');
ok('filters: service type', r.json.services.length > 0 && r.json.services.every((s) => s.serviceType === 'online'));

section('2. AI smart search');
const ask = (text, extra = {}) => guest('POST', '/api/assistant', { text, lat: 30.344, lng: 78.061, ...extra });
r = await ask('Find a gym subscription near me under ₹1,000');
ok('the example query becomes structured filters', r.json.filters.category === 'gym' && r.json.filters.maxPrice === 1000 && r.json.filters.nearMe);
ok('and returns matching results with a reply', r.json.results.total > 0 && /gyms? within 5 km/.test(r.json.reply), r.json.reply);
r = await ask('Is Iron Paradise Gym Rajpur Road open on Sunday?');
ok('availability questions get a direct answer', r.json.intent === 'availability' && /not available on Sunday/.test(r.json.reply), r.json.reply);
r = await ask('subscribe me to the cheapest laundry near me');
ok('voice subscribe resolves to a real service', r.json.intent === 'subscribe' && r.json.service?.category.slug === 'laundry');
r = await ask('apply coupon FIT20 for three months', { context: { page: 'checkout' } });
ok('checkout fields fill from speech', r.json.intent === 'fill' && r.json.fields.couponCode === 'FIT20' && r.json.fields.months === 3);
r = await ask('my transaction id is 4 1 9 2 0 0 1 2 3 4 5 6', { context: { page: 'checkout' } });
ok('spoken digits join into a UTR', r.json.fields.upiTxnId === '419200123456', JSON.stringify(r.json.fields));

section('3. sign-up with OTP');
const email = `e2e.${Date.now()}@example.in`;
r = await user('POST', '/api/auth/register', { fullName: 'Tanvi Rawat', email, phone: '+91 98970 55555', password: 'tanvi2026' });
ok('register asks for verification', r.status === 201 && r.json.pendingVerification);
ok('dev mode shows the code on screen', /^\d{6}$/.test(r.json.devOtp || ''));
const code = r.json.devOtp;
r = await user('POST', '/api/auth/login', { email, password: 'tanvi2026' });
ok('an unverified account cannot sign straight in', r.json?.pendingVerification === true && !r.json.user);
const code2 = r.json.devOtp;
r = await user('POST', '/api/auth/verify-otp', { email, code: code === code2 ? '000000' : code }, { allowFail: true });
ok('a superseded code is refused', r.status === 400);
r = await user('POST', '/api/auth/verify-otp', { email, code: code2 });
ok('the latest code verifies and signs in', r.json?.user?.emailVerified && r.json.redirect === '/app');
r = await user('POST', '/api/auth/verify-otp', { email, code: code2 }, { allowFail: true });
ok('a code works once', r.status === 400);

section('4. checkout with the official QR');
r = await user('POST', '/api/me/checkout/quote', { serviceId: gym.id, months: 1, couponCode: 'FIT20' });
ok('coupon applies to the right service', r.json?.quote?.discount > 0 && r.json.quote.finalAmount === r.json.quote.amount - r.json.quote.discount);
r = await user('POST', '/api/me/checkout/quote', { serviceId: gym.id, months: 1, couponCode: 'YOGA150' }, { allowFail: true });
ok('a coupon for another service is refused', r.status === 400 && /different service/.test(r.json.error));
r = await user('POST', '/api/me/checkout', { serviceId: gym.id, months: 3, couponCode: 'FIT20' });
const pay = r.json?.payment;
ok('checkout creates a payment awaiting the transfer', pay?.status === 'awaiting_payment');
ok('the QR is a UPI intent to the official Subtize account for the exact amount',
  pay.qr.upiUri.startsWith('upi://pay?') && pay.qr.upiUri.includes('subtize') && pay.qr.upiUri.includes(`am=${(pay.finalAmount / 100).toFixed(2)}`), pay.qr.upiUri);
ok('the QR image is rendered', pay.qr.image.startsWith('data:image/png;base64,'));
ok('checkout never names the provider', leaks(r.text).length === 0, leaks(r.text).join(', '));

r = await user('POST', `/api/me/payments/${pay.id}/submit`, { upiTxnId: 'abc' }, { allowFail: true });
ok('nonsense transaction IDs are refused', r.status === 400);
const utr = String(Date.now()).slice(-12);
r = await user('POST', `/api/me/payments/${pay.id}/submit`, { upiTxnId: utr });
ok('the UTR is recorded and the payment is pending verification', r.json?.payment?.status === 'pending' && r.json.payment.upiTxnId === utr);
r = await user('GET', '/api/me/subscriptions?bucket=pending');
const sub = r.json.subscriptions.find((s) => s.payment?.id === pay.id);
ok('the subscription shows as pending verification', sub?.status === 'pending_verification');

section('5. admin verifies and activates');
r = await admin('POST', '/api/auth/login', { email: 'admin@subtize.ai', password: 'subtize-admin-2026' });
ok('admin signs in and is sent to the console', r.json?.redirect === '/admin');
r = await admin('GET', '/api/admin/payments?status=pending');
ok('the payment is in the verification queue with its UTR', r.json.payments.some((p) => p.id === pay.id && p.upiTxnId === utr));
r = await admin('POST', `/api/admin/payments/${pay.id}/verify`, { activate: true });
ok('verify + activate', r.json?.payment?.status === 'verified' && r.json.payment.activation === 'activated' && r.json.activated?.start);

r = await user('GET', `/api/me/subscriptions/${sub.id}`);
const active = r.json.subscription;
ok('the member now has an active subscription', active.status === 'active' && active.remainingDays > 80);
ok('with the price, discount and payment status recorded', active.payment.discount > 0 && active.payment.status === 'verified');

const second = client('second');
const email2 = `e2e2.${Date.now()}@example.in`;
r = await second('POST', '/api/auth/register', { fullName: 'Second Member', email: email2, password: 'second2026' });
await second('POST', '/api/auth/verify-otp', { email: email2, code: r.json.devOtp });
r = await second('POST', '/api/me/checkout', { serviceId: gym.id, months: 1 });
r = await second('POST', `/api/me/payments/${r.json.payment.id}/submit`, { upiTxnId: utr }, { allowFail: true });
ok('the same UTR cannot be reused by someone else', r.status === 409);

section('6. digital card and usage');
r = await user('GET', '/api/me/cards');
const card = r.json.cards.find((c) => c.subscriptionId === sub.id);
ok('a card exists for the activated plan', Boolean(card) && card.holder === 'Tanvi Rawat');
r = await user('GET', card.svgUrl);
ok('the card downloads as an SVG with branding, ID and QR', r.headers.get('content-type').includes('svg') && r.text.includes('Subtize') && r.text.includes(sub.id) && r.text.includes('<path d="M'));
const cardCode = card.verifyUrl.split('/verify/').pop();
r = await guest('GET', `/api/verify/${cardCode}`);
ok('scanning the card verifies it publicly', r.json?.valid === true && r.json.holder === 'Tanvi R.');
ok('without exposing the member\'s email', !r.text.includes(email));

r = await lister('POST', '/api/auth/login', { email: 'lister@subtize.ai', password: 'lister12345' });
ok('lister signs in to the lister dashboard', r.json?.redirect === '/lister');
r = await lister('POST', '/api/lister/checkin', { code: card.verifyUrl, units: 1, note: 'Morning session' });
ok('the lister checks the member in by card', r.json?.usage?.used === 1);
r = await user('GET', `/api/me/subscriptions/${sub.id}`);
ok('usage shows up for the member', r.json.subscription.usage.used === 1 && r.json.subscription.usage.log.length === 1);

section('7. cancel and exclude');
r = await user('POST', `/api/me/subscriptions/${sub.id}/exclude`, { cancel: false });
ok('excluding keeps the plan but moves it to the excluded tab', r.json.subscription.status === 'active' && r.json.subscription.bucket === 'excluded');
r = await user('GET', '/api/services?limit=200');
ok('an excluded service disappears from explore', !r.json.services.some((s) => s.id === gym.id));
await user('DELETE', `/api/me/exclusions/${gym.id}`);
r = await user('POST', `/api/me/subscriptions/${sub.id}/cancel`, { reason: 'Moving cities' });
ok('cancel ends the subscription', r.json.subscription.status === 'cancelled');

section('8. become a lister');
const email3 = `applicant.${Date.now()}@example.in`;
r = await applicant('POST', '/api/auth/register', { fullName: 'Deepak Bhatt', email: email3, password: 'deepak2026' });
await applicant('POST', '/api/auth/verify-otp', { email: email3, code: r.json.devOtp });
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' });
const form = () => {
  const f = new FormData();
  const fields = {
    applicantName: 'Deepak Bhatt', businessName: 'Bhatt Badminton Arena', email: email3, phone: '9897011111',
    businessAddress: '14 Canal Road, Jakhan, Dehradun', city: 'Dehradun', category: 'sports',
    serviceDescription: 'Four synthetic badminton courts with coaching batches morning and evening for all ages.',
    govIdType: 'GSTIN', govIdNumber: '05ABCDE1234F1Z5', addressProofType: 'Electricity bill', addressProofId: 'UPCL998877',
    bankAccountName: 'Deepak Bhatt', bankAccountNumber: '123456789012', bankIfsc: 'SBIN0001234', bankName: 'SBI', settlementUpi: 'deepak@oksbi',
    agreementAck: 'true',
  };
  for (const [k, val] of Object.entries(fields)) f.append(k, val);
  f.append('addressProof', png, 'bill.png');
  f.append('idProof', png, 'gst.png');
  return f;
};
r = await applicant('POST', '/api/applications', form());
const appId = r.json?.application?.id;
ok('application submitted with documents', r.status === 201 && r.json.application.documents.length === 2);
ok('bank details come back masked to the applicant', r.json.application.bankAccountNumber.endsWith('9012') && !r.json.application.bankAccountNumber.includes('12345678'));
r = await applicant('POST', '/api/applications', form(), { allowFail: true });
ok('one open application per person', r.status === 409);

r = await admin('GET', `/api/admin/applications/${appId}`);
ok('admin sees the application masked by default', r.json.application.bankAccountNumber.includes('•'));
r = await admin('GET', `/api/admin/applications/${appId}?reveal=1`);
ok('and in full when they choose to reveal it', r.json.application.bankAccountNumber === '123456789012');
r = await admin('POST', `/api/admin/applications/${appId}/approve`, {}, { allowFail: true });
ok('approval is blocked until documents and address are verified', r.status === 400);
await admin('POST', `/api/admin/applications/${appId}/review`);
r = await admin('POST', `/api/admin/applications/${appId}/request-correction`, { note: 'Please upload a clearer GST certificate.' });
ok('admin can ask for a correction', r.json.application.status === 'verification_required');
const fix = new FormData();
fix.append('idProof', png, 'gst-clear.png');
r = await applicant('PUT', '/api/applications/mine', fix);
ok('the applicant resubmits', r.json.application.status === 'under_review' && r.json.application.documents.length === 3);
await admin('POST', `/api/admin/applications/${appId}/verify`, { documentsVerified: true, addressVerified: true });
r = await admin('POST', `/api/admin/applications/${appId}/approve`, { note: 'All good' });
ok('approval issues a verification ID', r.json.application.status === 'approved' && /^SUBV-/.test(r.json.application.verificationId));

r = await applicant('GET', '/api/auth/me');
ok('approval signs the old session out so the new role applies', r.json.user === null);
r = await applicant('POST', '/api/auth/login', { email: email3, password: 'deepak2026' });
ok('the new lister lands on the lister dashboard', r.json.redirect === '/lister');
r = await applicant('POST', '/api/lister/services', { name: 'Bhatt Badminton', category: 'sports', area: 'Jakhan', city: 'Dehradun', shortDescription: 'Coached badminton on synthetic courts.', description: 'Four synthetic courts with coaching batches morning and evening for all ages and levels.', proposedPrice: 1200, availableDays: ['mon', 'wed', 'fri'] }, { allowFail: true });
ok('no publishing before the agreement is signed', r.status === 403);

r = await applicant('GET', '/api/lister/agreement');
const agr = r.json.agreement;
ok('the agreement is waiting for the lister', agr.status === 'pending_lister' && agr.verificationId && /^AGR-/.test(agr.agreementId));
ok('it states the 20% commission in English', agr.sections.en.some((s) => s.body.includes('Subtize.ai will retain 20% of the total subscription revenue')));
ok('and in Hindi', agr.sections.hi.some((s) => s.body.includes('20%') && s.body.includes('80%')));
r = await applicant('POST', '/api/lister/agreement/sign', { signedName: 'Deepak Bhatt', signature: 'data:image/png;base64,iVBORw0KGgo=', accept: true });
ok('lister e-signs', r.json.agreement.status === 'pending_admin');
r = await admin('POST', `/api/admin/agreements/${agr.id}/countersign`, { signedName: 'Subtize Administrator' });
ok('Subtize.ai countersigns and the agreement is active', r.json.agreement.status === 'active');
r = await applicant('GET', '/api/lister/agreement/download');
ok('the signed agreement downloads', r.headers.get('content-disposition')?.includes('attachment') && r.text.includes('Deepak Bhatt') && r.text.includes('हिंदी'));

r = await applicant('POST', '/api/lister/services', { name: 'Bhatt Badminton', category: 'sports', area: 'Jakhan', city: 'Dehradun', shortDescription: 'Coached badminton on synthetic courts.', description: 'Four synthetic courts with coaching batches morning and evening for all ages and levels.', proposedPrice: 1200, availableDays: ['mon', 'wed', 'fri'], usageAllowed: 12, usageUnit: 'sessions' });
const newSvc = r.json?.service;
ok('now the lister can submit a service for review', newSvc?.status === 'pending_review');
r = await applicant('PUT', `/api/lister/services/${newSvc.id}`, { monthlyPrice: 1 }, { allowFail: true });
ok('listers cannot change the price directly', r.status === 403);
r = await applicant('PUT', `/api/lister/services/${newSvc.id}`, { hours: '6 – 9 am, 5 – 9 pm', availableDays: ['mon', 'wed', 'fri', 'sat'] });
ok('but can edit availability and information', r.json.service.availableDays.includes('sat'));
r = await applicant('POST', `/api/lister/services/${newSvc.id}/change-requests`, { field: 'monthly_price', proposedValue: '1100', note: 'Launch price' });
ok('price changes go in as a request', r.json.service.pendingChanges.length === 1);
r = await admin('POST', `/api/admin/services/${newSvc.id}/status`, { status: 'active' });
ok('admin publishes it', r.json.service.status === 'active');
r = await admin('GET', '/api/admin/change-requests?status=pending');
const cr = r.json.requests.find((x) => x.serviceId === newSvc.id);
await admin('POST', `/api/admin/change-requests/${cr.id}/approve`, { note: 'Fine for launch' });
r = await guest('GET', `/api/services/${newSvc.id}`);
ok('the approved price is live, and still no provider name in public', r.json.service.monthlyPrice === 110000 && !r.text.includes('Deepak'));

r = await lister('GET', '/api/lister/services');
ok('listers only ever see their own services', r.json.services.length > 0 && !r.json.services.some((s) => s.id === newSvc.id));
r = await lister('GET', `/api/lister/services/${newSvc.id}`, null, { allowFail: true });
ok('and cannot open someone else\'s', r.status === 404);
r = await lister('GET', '/api/admin/users', null, { allowFail: true });
ok('listers are kept out of the admin API', r.status === 403);
r = await user('GET', '/api/lister/overview', null, { allowFail: true });
ok('explorers are kept out of the lister API', r.status === 403);

section('9. lister money');
r = await lister('GET', '/api/lister/overview');
const m = r.json.metrics;
ok('lister metrics are all present', ['totalSubscribers', 'currentMonthSubscribers', 'newSubscriptions', 'cancellations', 'activeSubscriptions', 'gross', 'commission', 'payable', 'settlementStatus'].every((k) => k in m));
ok('commission is 20% and payable is the rest', m.commission === Math.round(m.gross * 0.2) && m.payable === m.gross - m.commission, JSON.stringify(m));
r = await lister('GET', '/api/lister/settlements');
ok('settlement history is visible', r.json.settlements.length >= 3 && r.json.settlements.some((s) => s.status === 'paid'));
r = await lister('GET', '/api/lister/subscribers');
ok('subscriber records carry no contact details', r.json.subscribers.length > 0 && !r.text.includes('@example.in'));

section('10. admin console');
r = await admin('GET', '/api/admin/dashboard');
const d = r.json.metrics;
ok('dashboard has every requested metric', ['totalUsers', 'activeUsers', 'totalServices', 'activeServices', 'totalSubscribers', 'monthlySubscriptions', 'pendingPayments', 'verifiedPayments', 'cancelledSubscriptions', 'totalRevenue', 'listerPayouts', 'commission'].every((k) => k in d));
r = await admin('GET', `/api/admin/users?q=${encodeURIComponent(sub.id)}`);
ok('users are searchable by subscription ID', r.json.users.some((u) => u.email === email));
const uid = r.json.users.find((u) => u.email === email).id;
r = await admin('POST', `/api/admin/users/${uid}/status`, { status: 'suspended', reason: 'Payment dispute' });
ok('admin can suspend', r.json.user.status === 'suspended');
r = await user('GET', '/api/me/overview', null, { allowFail: true });
ok('a suspended user is signed out immediately', r.status === 401);
r = await user('POST', '/api/auth/login', { email, password: 'tanvi2026' }, { allowFail: true });
ok('and cannot sign back in', r.status === 403 && /suspended/.test(r.json.error));
await admin('POST', `/api/admin/users/${uid}/status`, { status: 'active' });

r = await admin('POST', '/api/admin/coupons', { code: 'e2e-50', discountType: 'fixed', discountValue: 50, serviceId: gym.id, startsOn: '2020-01-01', expiresOn: '2099-12-31', usageLimit: 1, minValue: 100 });
ok('admin creates a service coupon', r.json?.coupon?.code === 'E2E50' && r.json.coupon.live);

r = await admin('GET', '/api/admin/revenue');
ok('revenue splits gross into commission and lister settlement', r.json.gross === r.json.commission + r.json.listerPayable);
r = await admin('GET', '/api/admin/reports/monthly.csv');
ok('monthly report downloads as CSV', r.headers.get('content-type').includes('text/csv') && r.text.includes('Subtize.ai commission'));
r = await admin('POST', '/api/admin/settlements/generate', {});
ok('settlements generate for the month', r.json.generated >= 1);

section('11. reminders and email');
const priya = client('priya');
await priya('POST', '/api/auth/login', { email: 'priya@subtize.ai', password: 'demo12345' });
r = await priya('GET', '/api/me/notifications');
ok('a plan ending within three days triggers one reminder', r.json.notifications.filter((n) => /Doon Dairy.*ends on/.test(n.title)).length === 1);
r = await admin('GET', '/api/admin/outbox');
ok('member notices are also emailed (outbox in dev)', r.json.messages.some((m) => m.to === 'priya@subtize.ai' && /ends on/.test(m.subject)));
ok('admins are not emailed for queue items', !r.json.messages.some((m) => m.to === 'admin@subtize.ai'));

section('12. security edges');
r = await guest('GET', '/api/me/overview', null, { allowFail: true });
ok('member API needs a session', r.status === 401);
r = await admin('POST', '/api/me/checkout', { serviceId: gym.id }, { allowFail: true });
ok('admins cannot take subscriptions', r.status === 403);
r = await guest('GET', `/api/admin/applications/${appId}/documents/1`, null, { allowFail: true });
ok('lister documents are not reachable without admin', r.status === 401);
r = await guest('GET', '/uploads/private/anything.png', null, { allowFail: true });
ok('private uploads are not served statically', r.status === 404);
r = await guest('GET', '/api/services');
ok('pages ship a strict CSP', (await fetch(`${BASE}/`)).headers.get('content-security-policy')?.includes("script-src 'self'"));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
