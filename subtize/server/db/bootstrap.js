import { config } from '../config.js';
import { db, setSetting } from './index.js';
import { CATEGORIES, DEMO_SERVICES, LOCATIONS } from './catalogData.js';
import { hashPassword } from '../lib/auth.js';
import { seal } from '../lib/crypto.js';
import { addDays, planEnd, today } from '../lib/dates.js';
import {
  agreementPublicId, applicationPublicId, cardCode, paymentPublicId, referralCode,
  servicePublicId, slugify, subscriptionPublicId, upiReference, userPublicId, verificationId,
} from '../lib/ids.js';
import { upiIntent } from '../lib/upi.js';
import { generateSettlements } from '../lib/revenue.js';

export const KNOWN_DEFAULT_PASSWORDS = new Set(['subtize-admin-2026']);

export const isEmpty = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;

/** Categories, neighbourhoods, platform settings and the first admin. Safe to re-run. */
export function baseline() {
  const cat = db.prepare('INSERT OR IGNORE INTO categories (slug, name, icon, sort) VALUES (?, ?, ?, ?)');
  CATEGORIES.forEach(([slug, name, icon], i) => cat.run(slug, name, icon, i + 1));
  const loc = db.prepare('INSERT OR IGNORE INTO locations (area, city, lat, lng) VALUES (?, ?, ?, ?)');
  for (const l of LOCATIONS) loc.run(...l);

  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'platform_upi_id'").get()) {
    setSetting('platform_upi_id', config.platform.upiId);
    setSetting('platform_payee', config.platform.payee);
    setSetting('commission_percent', config.platform.commissionPercent);
  }
  const a = config.seedAdmin;
  if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(a.email)) {
    db.prepare(
      `INSERT INTO users (public_id, full_name, email, password_hash, role, email_verified, referral_code)
       VALUES (?, ?, ?, ?, 'admin', 1, ?)`,
    ).run(userPublicId(), a.name, a.email, hashPassword(a.password), referralCode());
  }
}

/* ── Demo world ─────────────────────────────────────────────────────────── */

// Deterministic randomness so every fresh demo looks the same.
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Ishita', 'Vihaan', 'Ananya', 'Reyansh', 'Myra', 'Arjun', 'Saanvi', 'Aditya', 'Kiara', 'Rudra', 'Aadhya',
  'Dev', 'Anika', 'Krish', 'Riya', 'Yash', 'Tara', 'Nikhil', 'Pooja', 'Rahul', 'Sneha', 'Manish', 'Kavya', 'Siddharth', 'Nandini', 'Gaurav', 'Meghna'];
const LAST = ['Sharma', 'Rawat', 'Negi', 'Bisht', 'Joshi', 'Verma', 'Gupta', 'Chauhan', 'Thapa', 'Pant', 'Kumar', 'Singh', 'Bhatt', 'Arora', 'Malhotra'];

const LISTERS = [
  { name: 'Rohan Mehta', email: 'lister@subtize.ai', business: 'Fit Nation Ventures', cats: ['gym', 'sports'], city: 'Dehradun' },
  { name: 'Anjali Rawat', email: 'anjali.rawat@example.in', business: 'Rasoi & Rinse Services', cats: ['meals', 'laundry', 'dairy'], city: 'Dehradun' },
  { name: 'Vikram Negi', email: 'vikram.negi@example.in', business: 'Doon Learning Hub', cats: ['tuition', 'music', 'coworking'], city: 'Dehradun' },
  { name: 'Sana Qureshi', email: 'sana.qureshi@example.in', business: 'Glow & Groom Co.', cats: ['salon', 'dance', 'yoga'], city: 'Dehradun' },
  { name: 'Harish Bisht', email: 'harish.bisht@example.in', business: 'CleanRide Services', cats: ['car-care', 'home-cleaning', 'pet-care'], city: 'Dehradun' },
];

const stamp = (date, hh = 10) => `${date} ${String(hh).padStart(2, '0')}:${String((hh * 7) % 60).padStart(2, '0')}:00`;

export function demo() {
  const rand = rng(20260927);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const T = today();
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  const listerHash = hashPassword('lister12345');
  const memberHash = hashPassword('demo12345');
  const catId = Object.fromEntries(db.prepare('SELECT slug, id FROM categories').all().map((c) => [c.slug, c.id]));
  const loc = Object.fromEntries(db.prepare('SELECT area, city, lat, lng FROM locations').all().map((l) => [l.area, l]));

  const insUser = db.prepare(
    `INSERT INTO users (public_id, full_name, email, phone, password_hash, role, email_verified, city, preferred_area, pref_lat, pref_lng, referral_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  );
  const addUser = (name, email, hash, role, area = null, created = stamp(addDays(T, -200))) => {
    const l = area ? loc[area] : null;
    return insUser.run(userPublicId(), name, email, `+91 9${String(Math.floor(rand() * 1e9)).padStart(9, '0')}`, hash, role,
      l?.city || 'Dehradun', area, l?.lat ?? null, l?.lng ?? null, referralCode(), created).lastInsertRowid;
  };

  let appN = 0;
  let agrN = 0;
  const insApp = db.prepare(
    `INSERT INTO lister_applications (public_id, user_id, applicant_name, business_name, email, phone, business_address, city, category_id,
       service_description, gov_id_type, gov_id_number_enc, address_proof_type, address_proof_id_enc, bank_account_name, bank_account_no_enc,
       bank_ifsc, bank_name, settlement_upi_enc, agreement_ack, status, documents_verified, address_verified, correction_note, verification_id,
       reviewed_by, reviewed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GSTIN', ?, 'Electricity bill', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const application = (userId, l, status, { correction = null, vid = null, created = stamp(addDays(T, -180)) } = {}) => {
    appN += 1;
    const decided = ['approved', 'suspended'].includes(status);
    insApp.run(applicationPublicId(appN), userId, l.name, l.business, l.email, '+91 98970 12345', `${12 + appN}, ${pick(Object.keys(loc))} Main Road`, l.city,
      catId[l.cats[0]], `${l.business} runs ${l.cats.join(', ')} services in and around ${l.city}, with trained staff and fixed monthly plans for regular customers.`,
      seal(`05AABC${1000 + appN}F1Z${appN}`), seal(`UPCL${700000 + appN * 37}`), l.name, seal(`${50100000000 + appN * 7919}`),
      'HDFC0001234', 'HDFC Bank', seal(`${l.email.split('@')[0].replace(/\./g, '')}@okhdfcbank`),
      status, decided ? 1 : 0, decided ? 1 : 0, correction, vid, decided ? admin.id : null, decided ? created : null, created);
    return db.prepare('SELECT id FROM lister_applications WHERE user_id = ?').get(userId).id;
  };
  const agreement = (listerId, appId, vid, status, signedAt) => {
    agrN += 1;
    // A drawn-looking signature for the demo (the real pad stores a PNG).
    const signature = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="110" viewBox="0 0 360 110"><path d="M18 78c18-40 34-58 44-52 12 8-22 56-8 58 16 2 30-44 44-42 12 2-8 38 6 38 16 0 26-30 40-30 12 0 2 28 14 28 18 0 30-40 48-40 14 0 0 36 14 36 20 0 36-22 56-26M40 92c80-6 170-10 280-8" fill="none" stroke="#0b1f14" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>').toString('base64')}`;
    const listerName = db.prepare('SELECT full_name FROM users WHERE id = ?').get(listerId).full_name;
    db.prepare(
      `INSERT INTO agreements (public_id, lister_id, application_id, verification_id, commission_percent, status,
         lister_signed_name, lister_signature, lister_signed_at, admin_signed_name, admin_signed_by, admin_signed_at, created_at)
       VALUES (?, ?, ?, ?, 20, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(agreementPublicId(agrN), listerId, appId, vid, status,
      status === 'pending_lister' ? null : listerName, status === 'pending_lister' ? null : signature, status === 'pending_lister' ? null : signedAt,
      status === 'active' ? admin.full_name : null, status === 'active' ? admin.id : null, status === 'active' ? signedAt : null, signedAt);
  };

  // Approved listers under agreement.
  const listerIds = LISTERS.map((l, i) => {
    const id = addUser(l.name, l.email, listerHash, 'lister', null, stamp(addDays(T, -190 + i)));
    const vid = verificationId();
    const appId = application(id, l, 'approved', { vid, created: stamp(addDays(T, -188 + i)) });
    agreement(id, appId, vid, 'active', stamp(addDays(T, -185 + i)));
    return { ...l, id };
  });

  // Onboarding in progress, so every admin queue has something in it.
  const pendingUser = addUser('Neha Joshi', 'neha.joshi@example.in', memberHash, 'user', 'Jakhan', stamp(addDays(T, -6)));
  application(pendingUser, { name: 'Neha Joshi', email: 'neha.joshi@example.in', business: 'Peak Pilates Studio', cats: ['yoga'], city: 'Dehradun' }, 'applied', { created: stamp(addDays(T, -2)) });
  const fixUser = addUser('Arjun Thapa', 'arjun.thapa@example.in', memberHash, 'user', 'Prem Nagar', stamp(addDays(T, -20)));
  application(fixUser, { name: 'Arjun Thapa', email: 'arjun.thapa@example.in', business: 'Thapa Tiffin Centre', cats: ['meals'], city: 'Dehradun' }, 'verification_required',
    { correction: 'The address proof is cut off at the bottom. Please upload the full electricity bill showing the business address.', created: stamp(addDays(T, -9)) });
  const reviewUser = addUser('Kunal Arora', 'kunal.arora@example.in', memberHash, 'user', 'Race Course', stamp(addDays(T, -15)));
  application(reviewUser, { name: 'Kunal Arora', email: 'kunal.arora@example.in', business: 'Arora Chess Academy', cats: ['tuition'], city: 'Dehradun' }, 'under_review', { created: stamp(addDays(T, -4)) });

  const meera = addUser('Meera Kapoor', 'meera@subtize.ai', listerHash, 'lister', 'Dalanwala', stamp(addDays(T, -12)));
  const meeraVid = verificationId();
  agreement(meera, application(meera, { name: 'Meera Kapoor', email: 'meera@subtize.ai', business: 'Kapoor Music House', cats: ['music'], city: 'Dehradun' }, 'approved',
    { vid: meeraVid, created: stamp(addDays(T, -10)) }), meeraVid, 'pending_lister', stamp(addDays(T, -1)));
  const karan = addUser('Karan Singh', 'karan.singh@example.in', listerHash, 'lister', 'Kaulagarh', stamp(addDays(T, -25)));
  const karanVid = verificationId();
  agreement(karan, application(karan, { name: 'Karan Singh', email: 'karan.singh@example.in', business: 'Doon Pet Palace', cats: ['pet-care'], city: 'Dehradun' }, 'approved',
    { vid: karanVid, created: stamp(addDays(T, -22)) }), karanVid, 'pending_admin', stamp(addDays(T, -3)));

  // Services: each template becomes one branch per area.
  const ownerFor = (cat, i) => {
    if (cat === 'swimming' || i % 6 === 5) return null; // some run by Subtize.ai directly
    return listerIds.find((l) => l.cats.includes(cat))?.id ?? null;
  };
  const insSvc = db.prepare(
    `INSERT INTO services (public_id, slug, name, category_id, short_description, description, area, city, lat, lng, service_type, monthly_price,
       plan_months, available_days, hours, usage_allowed, usage_unit, usage_restrictions, service_rules, max_subscribers, status, lister_id,
       provider_name, provider_contact, provider_notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
  );
  const services = [];
  let i = 0;
  for (const [name, cat, short, desc, price, days, hours, allowed, unit, restrictions, rules, type, plans, areas] of DEMO_SERVICES) {
    for (const area of areas) {
      const l = loc[area];
      const branchPrice = Math.round((price * (0.9 + rand() * 0.2)) / 10) * 10 - 1;
      const owner = ownerFor(cat, i);
      const lister = listerIds.find((x) => x.id === owner);
      const full = areas.length > 1 || type !== 'online' ? `${name}, ${area}` : name;
      const slug = slugify(`${name} ${area}`);
      const id = insSvc.run(servicePublicId(), slug, type === 'online' ? name : full, catId[cat], short, desc, area, l.city,
        l.lat + (rand() - 0.5) * 0.006, l.lng + (rand() - 0.5) * 0.006, type, branchPrice * 100, plans, days, hours, allowed, unit,
        restrictions, rules, rand() < 0.3 ? 40 + Math.floor(rand() * 60) : null, owner,
        lister ? lister.business : 'Subtize.ai Direct', lister ? `${lister.email} · +91 98970 12345` : 'ops@subtize.ai',
        lister ? `Branch manager on site ${hours}.` : 'Operated by Subtize.ai partnerships team.', admin.id, stamp(addDays(T, -170 + (i % 30)))).lastInsertRowid;
      services.push({ id, cat, price: branchPrice * 100, allowed, unit, name: full, area, days: days.split(',') });
      i += 1;
    }
  }
  // One proposal waiting for review, from the gym lister.
  db.prepare(
    `INSERT INTO services (public_id, slug, name, category_id, short_description, description, area, city, lat, lng, service_type, monthly_price,
       plan_months, available_days, hours, usage_allowed, usage_unit, status, lister_id, created_by)
     VALUES (?, 'iron-paradise-gym-kaulagarh', 'Iron Paradise Gym, Kaulagarh', ?, 'New branch opening with a ladies-only batch.',
       'Our fourth branch, with a dedicated ladies-only floor from 10 am to 1 pm, plus the full strength and cardio setup of our other gyms.',
       'Kaulagarh', 'Dehradun', ?, ?, 'in_person', 94900, '1', 'mon,tue,wed,thu,fri,sat', '6 am – 10 pm', NULL, 'visits', 'pending_review', ?, ?)`,
  ).run(servicePublicId(), catId.gym, loc.Kaulagarh.lat, loc.Kaulagarh.lng, listerIds[0].id, listerIds[0].id);

  // Coupons
  const insCoupon = db.prepare(
    `INSERT INTO coupons (code, description, service_id, discount_type, discount_value, max_discount, min_value, starts_on, expires_on, usage_limit, per_user_limit, is_public, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  const firstOf = (cat) => services.find((s) => s.cat === cat);
  insCoupon.run('WELCOME10', '10% off your first month on any service', null, 'percent', 10, 20000, 0, addDays(T, -60), addDays(T, 90), 500, 1, admin.id);
  insCoupon.run('FIT20', '20% off Iron Paradise Gym', firstOf('gym').id, 'percent', 20, 50000, 0, addDays(T, -30), addDays(T, 60), 100, 1, admin.id);
  insCoupon.run('YOGA150', '₹150 off Sunrise Hatha Yoga', firstOf('yoga').id, 'fixed', 15000, null, 50000, addDays(T, -10), addDays(T, 45), 50, 1, admin.id);
  insCoupon.run('MONSOON15', '15% off orders above ₹800', null, 'percent', 15, 30000, 80000, addDays(T, -5), addDays(T, 25), 200, 1, admin.id);
  insCoupon.run('PARTNER25', 'Private code for corporate partners', null, 'percent', 25, 75000, 0, addDays(T, -5), addDays(T, 120), 30, 0, admin.id);

  // Subscriptions + payments
  const insSub = db.prepare(
    `INSERT INTO subscriptions (public_id, user_id, service_id, months, status, start_date, end_date, activated_at, activated_by, usage_allowed, usage_unit,
       card_code, cancelled_at, cancelled_by, cancel_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insPay = db.prepare(
    `INSERT INTO payments (public_id, subscription_id, user_id, service_id, amount, coupon_id, coupon_code, discount, final_amount, upi_ref, payee_vpa, qr_payload,
       upi_txn_id, submitted_at, status, verified_by, verified_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insUsage = db.prepare('INSERT INTO usage_logs (subscription_id, units, source, logged_by, logged_at) VALUES (?, ?, ?, ?, ?)');
  const welcome = db.prepare("SELECT id FROM coupons WHERE code = 'WELCOME10'").get().id;
  let utr = 419200000000 + Math.floor(rand() * 1e6);

  const subscribe = (userId, svc, { start, months = 1, status = 'active', cancelledOn = null, pending = false, coupon = false, used = null }) => {
    const end = planEnd(start, months);
    const amount = svc.price * months;
    const discount = coupon ? Math.min(20000, Math.floor(amount * 0.1)) : 0;
    const final = amount - discount;
    const ref = upiReference();
    const vpa = config.platform.upiId;
    const isPending = pending || status === 'pending_verification';
    const created = stamp(addDays(start, -1), 9 + Math.floor(rand() * 10));
    const subId = insSub.run(subscriptionPublicId(), userId, svc.id, months, status, isPending ? null : start, isPending ? null : end,
      isPending ? null : stamp(start, 11), isPending ? null : admin.id, svc.allowed, svc.unit, isPending ? null : cardCode(),
      cancelledOn ? stamp(cancelledOn, 18) : null, cancelledOn ? userId : null, cancelledOn ? pick(['Moving to a different area', 'Timings did not suit me', 'Trying something else for a while', 'Too busy this month']) : null,
      created).lastInsertRowid;
    utr += 1 + Math.floor(rand() * 900);
    insPay.run(paymentPublicId(), subId, userId, svc.id, amount, coupon ? welcome : null, coupon ? 'WELCOME10' : null, discount, final, ref, vpa,
      upiIntent({ vpa, payee: config.platform.payee, amountPaise: final, reference: ref }), String(utr), created,
      isPending ? 'pending' : 'verified', isPending ? null : admin.id, isPending ? null : stamp(start, 11), created);
    if (!isPending && ['active', 'expired', 'cancelled'].includes(status)) {
      const last = [T, end, cancelledOn || end].sort()[0];
      const span = Math.max(0, (Date.parse(last) - Date.parse(start)) / 864e5);
      const n = used ?? Math.min(svc.allowed ?? 99, Math.floor(span * (0.35 + rand() * 0.4)));
      for (let k = 0; k < n; k++) {
        const day = addDays(start, Math.min(Math.floor(span), Math.floor((k * span) / Math.max(1, n))));
        insUsage.run(subId, 1, 'lister', null, stamp(day, 7 + (k % 12)));
      }
    }
    return subId;
  };

  // The demo explorer, with one of everything.
  const priya = addUser('Priya Sharma', 'priya@subtize.ai', memberHash, 'user', 'Rajpur Road', stamp(addDays(T, -120)));
  const svcBy = (prefix) => services.find((s) => s.name.startsWith(prefix));
  subscribe(priya, svcBy('Iron Paradise Gym, Rajpur Road'), { start: addDays(T, -12), used: 7, coupon: true });
  subscribe(priya, svcBy('Doon Dairy Fresh Milk, Rajpur Road'), { start: addDays(T, -27), used: 25 });
  subscribe(priya, svcBy('Focus Desk Coworking, Rajpur Road'), { start: addDays(T, -40), months: 3 });
  subscribe(priya, svcBy('Sunrise Hatha Yoga, Tapovan'), { start: addDays(T, -50), status: 'expired' });
  subscribe(priya, svcBy('Glow Beauty Studio, Dalanwala'), { start: addDays(T, -22), status: 'cancelled', cancelledOn: addDays(T, -10) });
  subscribe(priya, svcBy('SparkleHome Cleaning, Rajpur Road'), { start: T, status: 'pending_verification' });
  db.prepare('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)')
    .run(priya, 'Doon Dairy Fresh Milk expires soon', 'Renew now so deliveries do not stop.', '/app#/subscriptions');

  // A crowd of members over the last six months, so counts and revenue look lived-in.
  const areas = Object.keys(loc).filter((a) => loc[a].city === 'Dehradun');
  for (let u = 0; u < 180; u++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${u}@example.in`;
    const uid = addUser(name, email, memberHash, 'user', pick(areas), stamp(addDays(T, -190 + Math.floor(rand() * 180))));
    const n = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const svc = pick(services);
      const back = Math.floor(rand() * 170);
      const start = addDays(T, -back);
      const months = rand() < 0.2 ? 3 : 1;
      const end = planEnd(start, months);
      const roll = rand();
      if (u < 4 && k === 0) { subscribe(uid, svc, { start: T, status: 'pending_verification' }); continue; }
      if (end < T) subscribe(uid, svc, { start, months, status: roll < 0.15 ? 'cancelled' : 'expired', cancelledOn: roll < 0.15 ? addDays(start, 8) : null, coupon: rand() < 0.2 });
      else subscribe(uid, svc, { start, months, status: roll < 0.08 ? 'cancelled' : 'active', cancelledOn: roll < 0.08 ? addDays(start, Math.min(5, back)) : null, coupon: rand() < 0.2 });
    }
  }

  // Settle every finished month; the last one is still being processed.
  const monthList = [];
  let cursor = `${T.slice(0, 7)}-01`;
  for (let m = 0; m < 6; m++) { cursor = `${addDays(cursor, -1).slice(0, 7)}-01`; monthList.push(cursor.slice(0, 7)); }
  for (const m of monthList) generateSettlements(m, admin.id);
  db.prepare("UPDATE settlements SET status = 'paid', reference = 'NEFT' || substr(month, 1, 4) || substr(month, 6, 2) || lister_id, paid_at = date(month || '-01', '+1 month', '+6 days') || ' 12:00:00' WHERE month < ?")
    .run(monthList[0]);
  db.prepare("UPDATE settlements SET status = 'processing' WHERE month = ?").run(monthList[0]);

  // A pending price change from a lister.
  const gymSvc = services.find((s) => s.cat === 'gym');
  db.prepare("INSERT INTO change_requests (service_id, lister_id, field, current_value, proposed_value, note) VALUES (?, ?, 'monthly_price', ?, ?, ?)")
    .run(gymSvc.id, listerIds[0].id, String(gymSvc.price), String(gymSvc.price + 10000), 'New equipment installed; matching the other branches.');

  return { services: services.length };
}

export function bootstrap({ demo: withDemo = false } = {}) {
  baseline();
  return withDemo ? demo() : { services: 0 };
}
