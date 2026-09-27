import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from '../config.js';
import { db, logActivity, notify, tx } from '../db/index.js';
import { searchServices, serviceRow, DAY_NAMES } from '../lib/catalog.js';
import { cardSvg } from '../lib/cards.js';
import { thisMonth, today } from '../lib/dates.js';
import { findLocation } from '../lib/geo.js';
import { badRequest, conflict, forbidden, notFound, wrap } from '../lib/http.js';
import { paymentPublicId, subscriptionPublicId, upiReference } from '../lib/ids.js';
import { platformSettings, publicBaseUrl } from '../lib/platform.js';
import {
  SUB_SELECT, bucketOf, expireDue, memberSubscription, quote, usageSummary,
} from '../lib/subscriptions.js';
import { qrDataUrl, upiIntent } from '../lib/upi.js';
import * as v from '../lib/validate.js';
import { avatars, rel } from '../middleware/uploads.js';
import { requireMember } from '../middleware/session.js';
import { originFor } from './public.js';
import { sessionUser } from './auth.js';

export const memberRouter = express.Router();
memberRouter.use(requireMember);
memberRouter.use((_req, _res, next) => { expireDue(); next(); });

const mySub = (req, publicId) => {
  const row = db.prepare(`${SUB_SELECT} WHERE sub.public_id = ? AND sub.user_id = ?`).get(publicId, req.user.id);
  if (!row) throw notFound('That subscription is not on your account.');
  return row;
};

/* ── Overview ───────────────────────────────────────────────────────────── */

memberRouter.get('/overview', (req, res) => {
  const rows = db.prepare(`${SUB_SELECT} WHERE sub.user_id = ? ORDER BY sub.created_at DESC`).all(req.user.id);
  const subs = rows.map((r) => memberSubscription(r));
  const counts = { active: 0, expiring: 0, pending: 0, expired: 0, cancelled: 0, excluded: 0 };
  for (const s of subs) counts[s.bucket] = (counts[s.bucket] || 0) + 1;

  const spend = db.prepare(
    `SELECT COALESCE(SUM(final_amount), 0) AS total, COALESCE(SUM(discount), 0) AS saved
       FROM payments WHERE user_id = ? AND status = 'verified'`,
  ).get(req.user.id);
  const monthSpend = db.prepare(
    "SELECT COALESCE(SUM(final_amount), 0) AS n FROM payments WHERE user_id = ? AND status = 'verified' AND substr(verified_at, 1, 7) = ?",
  ).get(req.user.id, thisMonth()).n;

  const live = subs.filter((s) => s.bucket === 'active' || s.bucket === 'expiring');
  const taken = new Set(subs.filter((s) => ['active', 'expiring', 'pending'].includes(s.bucket)).map((s) => s.service.id));
  const recommended = searchServices({ sort: 'popular' }, { user: req.user, origin: originFor(req), limit: 12 })
    .services.filter((s) => !taken.has(s.id)).slice(0, 6);

  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 8').all(req.user.id);
  res.json({
    counts,
    spend: { total: spend.total, saved: spend.saved, thisMonth: monthSpend },
    active: live,
    pending: subs.filter((s) => s.bucket === 'pending'),
    expiringSoon: subs.filter((s) => s.bucket === 'expiring'),
    recommended,
    notifications: notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, read: Boolean(n.read_at), createdAt: n.created_at })),
    unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n,
  });
});

/* ── Subscriptions ──────────────────────────────────────────────────────── */

memberRouter.get('/subscriptions', (req, res) => {
  const rows = db.prepare(`${SUB_SELECT} WHERE sub.user_id = ? ORDER BY sub.created_at DESC`).all(req.user.id);
  let subs = rows.map((r) => memberSubscription(r));
  const counts = {};
  for (const s of subs) counts[s.bucket] = (counts[s.bucket] || 0) + 1;
  if (req.query.bucket && req.query.bucket !== 'all') subs = subs.filter((s) => s.bucket === req.query.bucket);
  res.json({ subscriptions: subs, counts });
});

memberRouter.get('/subscriptions/:id', (req, res) => {
  const row = mySub(req, req.params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE subscription_id = ? ORDER BY id DESC').all(row.id);
  res.json({
    subscription: memberSubscription(row, { withUsage: true }),
    payments: payments.map(memberPayment),
  });
});

memberRouter.post('/subscriptions/:id/cancel', wrap((req, res) => {
  const row = mySub(req, req.params.id);
  const reason = v.str(req.body.reason, 'Reason', { required: false, max: 500 });
  if (['cancelled', 'expired', 'rejected'].includes(row.status)) throw conflict('This subscription has already ended.');
  tx(() => {
    db.prepare(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now'), cancelled_by = ?, cancel_reason = ?,
              updated_at = datetime('now') WHERE id = ?`,
    ).run(req.user.id, reason || 'Cancelled by member', row.id);
    // A checkout that never got paid has nothing to verify any more.
    db.prepare("UPDATE payments SET status = 'rejected', rejection_reason = 'Cancelled by member before verification' WHERE subscription_id = ? AND status IN ('awaiting_payment', 'pending')")
      .run(row.id);
  })();
  logActivity({ actor: req.user, action: 'subscription.cancelled', entity: 'subscription', entityId: row.public_id, detail: reason });
  res.json({ subscription: memberSubscription(mySub(req, req.params.id)) });
}));

/**
 * "Exclude from Subtize.ai": stop seeing a service anywhere in the app. Its
 * subscriptions move to the Excluded tab. An active plan stays valid until its
 * end date unless the member also asks to cancel it.
 */
memberRouter.post('/subscriptions/:id/exclude', wrap((req, res) => {
  const row = mySub(req, req.params.id);
  const alsoCancel = v.bool(req.body.cancel);
  tx(() => {
    db.prepare('INSERT OR IGNORE INTO user_exclusions (user_id, service_id) VALUES (?, ?)').run(req.user.id, row.service_id);
    db.prepare("UPDATE subscriptions SET excluded = 1, updated_at = datetime('now') WHERE user_id = ? AND service_id = ?").run(req.user.id, row.service_id);
    if (alsoCancel && !['cancelled', 'expired', 'rejected'].includes(row.status)) {
      db.prepare(
        `UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now'), cancelled_by = ?, cancel_reason = 'Excluded from Subtize.ai',
                updated_at = datetime('now') WHERE id = ?`,
      ).run(req.user.id, row.id);
      db.prepare("UPDATE payments SET status = 'rejected', rejection_reason = 'Cancelled by member before verification' WHERE subscription_id = ? AND status IN ('awaiting_payment', 'pending')").run(row.id);
    }
  })();
  logActivity({ actor: req.user, action: 'service.excluded', entity: 'service', entityId: row.service_id, detail: alsoCancel ? 'and cancelled' : null });
  res.json({ subscription: memberSubscription(mySub(req, req.params.id)) });
}));

memberRouter.get('/exclusions', (req, res) => {
  const rows = db.prepare(
    `SELECT e.service_id, e.created_at, s.name, s.slug, s.area, c.name AS category
       FROM user_exclusions e JOIN services s ON s.id = e.service_id JOIN categories c ON c.id = s.category_id
      WHERE e.user_id = ? ORDER BY e.created_at DESC`,
  ).all(req.user.id);
  res.json({ exclusions: rows.map((r) => ({ serviceId: r.service_id, name: r.name, slug: r.slug, area: r.area, category: r.category, excludedAt: r.created_at })) });
});

memberRouter.post('/exclusions', wrap((req, res) => {
  const svc = serviceRow(v.int(req.body.serviceId, 'Service'));
  if (!svc) throw notFound('That service does not exist.');
  db.prepare('INSERT OR IGNORE INTO user_exclusions (user_id, service_id) VALUES (?, ?)').run(req.user.id, svc.id);
  db.prepare('UPDATE subscriptions SET excluded = 1 WHERE user_id = ? AND service_id = ?').run(req.user.id, svc.id);
  res.status(201).json({ ok: true });
}));

memberRouter.delete('/exclusions/:serviceId', (req, res) => {
  db.prepare('DELETE FROM user_exclusions WHERE user_id = ? AND service_id = ?').run(req.user.id, req.params.serviceId);
  db.prepare('UPDATE subscriptions SET excluded = 0 WHERE user_id = ? AND service_id = ?').run(req.user.id, req.params.serviceId);
  res.json({ ok: true });
});

/* ── Checkout ───────────────────────────────────────────────────────────── */

function checkoutService(id) {
  const svc = serviceRow(v.int(id, 'Service'));
  if (!svc || svc.status !== 'active') throw notFound('That service is not taking subscriptions right now.');
  return svc;
}

memberRouter.post('/checkout/quote', wrap((req, res) => {
  const svc = checkoutService(req.body.serviceId);
  const months = v.int(req.body.months, 'Plan length', { min: 1, max: 12, fallback: 1 });
  const couponCode = v.str(req.body.couponCode, 'Coupon code', { required: false, max: 30 });
  res.json({ quote: quote(svc, { months, couponCode, userId: req.user.id }) });
}));

function memberPayment(p) {
  return {
    id: p.public_id,
    status: p.status,
    amount: p.amount,
    discount: p.discount,
    finalAmount: p.final_amount,
    couponCode: p.coupon_code,
    upiRef: p.upi_ref,
    upiTxnId: p.upi_txn_id,
    payee: p.payee_vpa,
    createdAt: p.created_at,
    submittedAt: p.submitted_at,
    verifiedAt: p.verified_at,
    rejectionReason: p.rejection_reason,
  };
}

async function paymentWithQr(p) {
  const svc = db.prepare('SELECT id, name, slug, payment_qr_path, payment_payee FROM services WHERE id = ?').get(p.service_id);
  const sub = db.prepare('SELECT public_id, months, status FROM subscriptions WHERE id = ?').get(p.subscription_id);
  return {
    ...memberPayment(p),
    subscriptionId: sub.public_id,
    months: sub.months,
    service: { id: svc.id, name: svc.name, slug: svc.slug },
    qr: {
      upiUri: p.qr_payload,
      image: await qrDataUrl(p.qr_payload),
      vpa: p.payee_vpa,
      payee: svc.payment_payee || platformSettings().payee,
      attachedUrl: svc.payment_qr_path ? `/api/me/payments/${p.public_id}/official-qr` : null,
      official: true,
    },
  };
}

memberRouter.post('/checkout', wrap(async (req, res) => {
  const svc = checkoutService(req.body.serviceId);
  const months = v.int(req.body.months, 'Plan length', { min: 1, max: 12, fallback: 1 });
  const couponCode = v.str(req.body.couponCode, 'Coupon code', { required: false, max: 30 });
  const q = quote(svc, { months, couponCode, userId: req.user.id });

  const user = db.prepare('SELECT status, email_verified FROM users WHERE id = ?').get(req.user.id);
  if (!user.email_verified) throw forbidden('Verify your email before subscribing.');

  const existing = db.prepare(
    `SELECT status, end_date FROM subscriptions WHERE user_id = ? AND service_id = ?
       AND status IN ('pending_verification', 'verified', 'active') ORDER BY id DESC LIMIT 1`,
  ).get(req.user.id, svc.id);
  if (existing?.status === 'pending_verification' || existing?.status === 'verified') {
    throw conflict('You already have a payment for this service waiting on verification.');
  }
  if (existing?.status === 'active') {
    const window = platformSettings().expiringSoonDays;
    const left = (Date.parse(existing.end_date) - Date.parse(today())) / 864e5;
    if (left > window) throw conflict(`You are already subscribed until ${existing.end_date}. Renewal opens ${window} days before it ends.`);
  }
  if (svc.max_subscribers != null) {
    const taken = db.prepare(
      `SELECT COUNT(*) AS n FROM subscriptions WHERE service_id = ? AND ((status = 'active' AND end_date >= ?) OR status IN ('pending_verification', 'verified'))`,
    ).get(svc.id, today()).n;
    if (taken >= svc.max_subscribers && existing?.status !== 'active') throw conflict('This service is full right now. Check back soon.');
  }

  const p = platformSettings();
  // Official collection account only. A provider's personal UPI is never a payee.
  const vpa = svc.payment_upi_id || p.upiId;
  const payee = svc.payment_payee || p.payee;
  const ref = upiReference();
  const uri = upiIntent({ vpa, payee, amountPaise: q.finalAmount, reference: ref, note: `Subtize ${ref} ${svc.name}` });
  const coupon = q.coupon ? db.prepare('SELECT id FROM coupons WHERE code = ? COLLATE NOCASE').get(q.coupon.code) : null;

  const paymentId = tx(() => {
    // Drop any earlier unpaid checkout for the same service; the new QR replaces it.
    const stale = db.prepare("SELECT id FROM subscriptions WHERE user_id = ? AND service_id = ? AND status = 'pending_payment'").all(req.user.id, svc.id);
    for (const s of stale) db.prepare('DELETE FROM subscriptions WHERE id = ?').run(s.id);

    const subId = db.prepare(
      "INSERT INTO subscriptions (public_id, user_id, service_id, months, status) VALUES (?, ?, ?, ?, 'pending_payment')",
    ).run(subscriptionPublicId(), req.user.id, svc.id, months).lastInsertRowid;
    return db.prepare(
      `INSERT INTO payments (public_id, subscription_id, user_id, service_id, amount, coupon_id, coupon_code, discount, final_amount,
                             upi_ref, payee_vpa, qr_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(paymentPublicId(), subId, req.user.id, svc.id, q.amount, coupon?.id ?? null, q.coupon?.code ?? null,
      q.discount, q.finalAmount, ref, vpa, uri).lastInsertRowid;
  })();

  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  logActivity({ actor: req.user, action: 'checkout.started', entity: 'payment', entityId: payment.public_id, detail: `${svc.name} · ${months}m` });
  res.status(201).json({ payment: await paymentWithQr(payment), quote: q });
}));

const myPayment = (req, id) => {
  const p = db.prepare('SELECT * FROM payments WHERE public_id = ? AND user_id = ?').get(id, req.user.id);
  if (!p) throw notFound('That payment is not on your account.');
  return p;
};

memberRouter.get('/payments', (req, res) => {
  const rows = db.prepare(
    `SELECT p.*, s.name AS service_name, s.slug AS service_slug, sub.public_id AS subscription_id, sub.months, sub.status AS subscription_status
       FROM payments p JOIN services s ON s.id = p.service_id JOIN subscriptions sub ON sub.id = p.subscription_id
      WHERE p.user_id = ? ORDER BY p.id DESC`,
  ).all(req.user.id);
  res.json({
    payments: rows.map((p) => ({
      ...memberPayment(p), service: { name: p.service_name, slug: p.service_slug },
      subscriptionId: p.subscription_id, months: p.months, subscriptionStatus: p.subscription_status,
    })),
  });
});

memberRouter.get('/payments/:id', wrap(async (req, res) => {
  res.json({ payment: await paymentWithQr(myPayment(req, req.params.id)) });
}));

memberRouter.get('/payments/:id/official-qr', (req, res, next) => {
  try {
    const p = myPayment(req, req.params.id);
    const svc = db.prepare('SELECT payment_qr_path FROM services WHERE id = ?').get(p.service_id);
    if (!svc?.payment_qr_path) throw notFound('No attached QR for this service.');
    res.sendFile(path.join(config.uploadDir, svc.payment_qr_path));
  } catch (e) { next(e); }
});

memberRouter.post('/payments/:id/submit', wrap((req, res) => {
  const p = myPayment(req, req.params.id);
  if (p.status !== 'awaiting_payment') throw conflict(p.status === 'pending' ? 'This payment is already waiting on verification.' : 'This payment is closed.');
  const txnId = v.upiTxnId(req.body.upiTxnId);
  if (db.prepare('SELECT 1 FROM payments WHERE upi_txn_id = ?').get(txnId)) {
    throw conflict('That transaction ID has already been used on another payment. Check your UPI receipt.');
  }
  tx(() => {
    db.prepare("UPDATE payments SET upi_txn_id = ?, status = 'pending', submitted_at = datetime('now') WHERE id = ?").run(txnId, p.id);
    db.prepare("UPDATE subscriptions SET status = 'pending_verification', updated_at = datetime('now') WHERE id = ?").run(p.subscription_id);
  })();
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all();
  for (const a of admins) notify(a.id, { title: 'Payment to verify', body: `${p.public_id} · UTR ${txnId}`, link: '/admin#/payments' });
  logActivity({ actor: req.user, action: 'payment.submitted', entity: 'payment', entityId: p.public_id, detail: txnId });
  res.json({ payment: memberPayment(db.prepare('SELECT * FROM payments WHERE id = ?').get(p.id)) });
}));

memberRouter.post('/payments/:id/abandon', wrap((req, res) => {
  const p = myPayment(req, req.params.id);
  if (p.status !== 'awaiting_payment') throw conflict('Only an unpaid checkout can be discarded.');
  db.prepare("DELETE FROM subscriptions WHERE id = ? AND status = 'pending_payment'").run(p.subscription_id);
  res.json({ ok: true });
}));

/* ── Usage & cards ──────────────────────────────────────────────────────── */

memberRouter.get('/usage', (req, res) => {
  const rows = db.prepare(`${SUB_SELECT} WHERE sub.user_id = ? AND sub.status IN ('active', 'expired') ORDER BY sub.status, sub.end_date DESC`).all(req.user.id);
  res.json({ subscriptions: rows.map((r) => memberSubscription(r, { withUsage: true })) });
});

const cardRow = (req) => {
  const row = mySub(req, req.params.id);
  if (!row.card_code || !['active', 'expired'].includes(row.status)) throw notFound('This subscription does not have a card yet. Cards appear once payment is verified.');
  return row;
};

function cardData(req, row) {
  const usage = usageSummary(row);
  const days = row.available_days.split(',').map((d) => DAY_NAMES[d].slice(0, 3)).join(', ');
  return {
    subscriptionId: row.public_id,
    status: row.status,
    holder: row.user_name,
    service: { name: row.service_name, category: row.category_name, area: row.area, city: row.city, days },
    activatedOn: row.start_date,
    validTill: row.end_date,
    usage: { allowed: usage.allowed, used: usage.used, remaining: usage.remaining, unit: usage.unit },
    verifyUrl: `${publicBaseUrl(req)}/verify/${row.card_code}`,
    svgUrl: `/api/me/cards/${row.public_id}/card.svg`,
    bucket: bucketOf(row),
  };
}

memberRouter.get('/cards', (req, res) => {
  const rows = db.prepare(`${SUB_SELECT} WHERE sub.user_id = ? AND sub.card_code IS NOT NULL AND sub.status IN ('active', 'expired') ORDER BY sub.status, sub.end_date DESC`)
    .all(req.user.id);
  res.json({ cards: rows.map((r) => cardData(req, r)) });
});

memberRouter.get('/cards/:id', (req, res, next) => {
  try { res.json({ card: cardData(req, cardRow(req)) }); } catch (e) { next(e); }
});

memberRouter.get('/cards/:id/card.svg', (req, res, next) => {
  try {
    const row = cardRow(req);
    const d = cardData(req, row);
    const svg = cardSvg({
      sub: row,
      service: { name: row.service_name, category: row.category_name, area: row.area, city: row.city, days: d.service.days },
      holder: row.user_name,
      usage: d.usage,
      verifyUrl: d.verifyUrl,
    });
    res.type('image/svg+xml');
    res.setHeader('Cache-Control', 'no-store');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="subtize-card-${row.public_id}.svg"`);
    res.send(svg);
  } catch (e) { next(e); }
});

/* ── Profile, settings, notifications ───────────────────────────────────── */

function profileOf(id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return {
    ...sessionUser(u),
    address: u.address,
    prefLat: u.pref_lat,
    prefLng: u.pref_lng,
    upiId: u.upi_id,
    paymentNote: u.payment_note,
    createdAt: u.created_at,
    settings: { notifyEmail: Boolean(u.notify_email), notifyExpiry: Boolean(u.notify_expiry), voiceEnabled: Boolean(u.voice_enabled) },
  };
}

memberRouter.get('/profile', (req, res) => res.json({ profile: profileOf(req.user.id) }));

memberRouter.put('/profile', wrap((req, res) => {
  // Partial update: only the fields sent are changed, so a form that edits
  // name and phone never blanks the saved location or UPI details.
  const b = req.body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const next = {
    full_name: has('fullName') ? v.str(b.fullName, 'Full name', { min: 2, max: 120 }) : cur.full_name,
    phone: has('phone') ? v.phone(b.phone, 'Phone', { required: false }) : cur.phone,
    address: has('address') ? v.str(b.address, 'Address', { required: false, max: 300 }) : cur.address,
    city: has('city') ? v.str(b.city, 'City', { required: false, max: 80 }) : cur.city,
    preferred_area: has('preferredArea') ? v.str(b.preferredArea, 'Preferred location', { required: false, max: 120 }) : cur.preferred_area,
    upi_id: has('upiId') ? v.vpa(b.upiId, 'UPI ID', { required: false }) : cur.upi_id,
    payment_note: has('paymentNote') ? v.str(b.paymentNote, 'Payment note', { required: false, max: 200 }) : cur.payment_note,
    pref_lat: cur.pref_lat,
    pref_lng: cur.pref_lng,
  };
  const coord = (k, label, lim) => (b[k] != null && b[k] !== '' ? v.num(b[k], label, { min: -lim, max: lim }) : null);
  if (has('prefLat') || has('prefLng')) {
    next.pref_lat = coord('prefLat', 'Latitude', 90);
    next.pref_lng = coord('prefLng', 'Longitude', 180);
  }
  if (has('preferredArea') && !(has('prefLat') && next.pref_lat != null)) {
    // A newly picked area without coordinates takes the area's centre; clearing it clears them.
    const loc = next.preferred_area ? findLocation(next.preferred_area) : null;
    if (next.preferred_area !== cur.preferred_area || next.pref_lat == null) {
      next.pref_lat = loc?.lat ?? null;
      next.pref_lng = loc?.lng ?? null;
    }
  }
  db.prepare(
    `UPDATE users SET full_name = ?, phone = ?, address = ?, city = ?, preferred_area = ?, pref_lat = ?, pref_lng = ?,
            upi_id = ?, payment_note = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(next.full_name, next.phone, next.address, next.city, next.preferred_area, next.pref_lat, next.pref_lng,
    next.upi_id, next.payment_note, req.user.id);
  res.json({ profile: profileOf(req.user.id) });
}));

memberRouter.post('/profile/avatar', avatars.single('avatar'), wrap((req, res) => {
  if (!req.file) throw badRequest('Choose an image to upload.');
  const old = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.user.id).avatar_path;
  db.prepare("UPDATE users SET avatar_path = ?, updated_at = datetime('now') WHERE id = ?").run(rel(req.file), req.user.id);
  if (old) fs.rm(path.join(config.uploadDir, old), { force: true }, () => {});
  res.json({ profile: profileOf(req.user.id) });
}));

memberRouter.put('/settings', wrap((req, res) => {
  const s = req.body || {};
  db.prepare('UPDATE users SET notify_email = ?, notify_expiry = ?, voice_enabled = ? WHERE id = ?')
    .run(v.bool(s.notifyEmail) ? 1 : 0, v.bool(s.notifyExpiry) ? 1 : 0, v.bool(s.voiceEnabled) ? 1 : 0, req.user.id);
  res.json({ profile: profileOf(req.user.id) });
}));

memberRouter.get('/notifications', (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
  res.json({ notifications: rows.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, read: Boolean(n.read_at), createdAt: n.created_at })), unread });
});

memberRouter.post('/notifications/read', (req, res) => {
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
  res.json({ ok: true });
});

memberRouter.get('/referral', (req, res) => {
  const u = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(req.user.id);
  const joined = db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?').get(req.user.id).n;
  res.json({ code: u.referral_code, url: `${publicBaseUrl(req)}/?ref=${u.referral_code}`, joined });
});
