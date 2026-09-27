import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from '../config.js';
import { db, logActivity, notify } from '../db/index.js';
import { AGREEMENT_SELECT, agreementDocument, agreementView } from '../lib/agreement.js';
import { DAY_NAMES, subscriberCounts } from '../lib/catalog.js';
import { dayKey, localToIso, monthBounds, thisMonth, today } from '../lib/dates.js';
import { findLocation } from '../lib/geo.js';
import { badRequest, conflict, forbidden, notFound, wrap } from '../lib/http.js';
import { servicePublicId, slugify } from '../lib/ids.js';
import { SETTLEMENT_SELECT, monthlySummary, settlementView, trend } from '../lib/revenue.js';
import { expireDue, recordUsage, usageSummary } from '../lib/subscriptions.js';
import * as v from '../lib/validate.js';
import { requireLister } from '../middleware/session.js';
import { rel, serviceImages } from '../middleware/uploads.js';
import { applicationView } from './applications.js';

export const listerRouter = express.Router();
listerRouter.use(requireLister);
listerRouter.use((_req, _res, next) => { expireDue(); next(); });

/* ── Onboarding state ───────────────────────────────────────────────────── */

export function listerStanding(listerId) {
  const app = db.prepare("SELECT * FROM lister_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(listerId);
  const agreement = db.prepare(`${AGREEMENT_SELECT} WHERE a.lister_id = ? ORDER BY a.id DESC LIMIT 1`).get(listerId);
  const verified = app?.status === 'approved';
  const agreementActive = agreement?.status === 'active';
  return {
    verified,
    verificationId: app?.verification_id || agreement?.verification_id || null,
    applicationStatus: app?.status || null,
    agreementStatus: agreement?.status || null,
    agreementId: agreement?.public_id || null,
    canPublish: verified && agreementActive,
    nextStep: !verified ? 'verification' : !agreement ? 'agreement_pending' : agreement.status === 'pending_lister' ? 'sign_agreement'
      : agreement.status === 'pending_admin' ? 'await_countersign' : agreementActive ? null : 'agreement_inactive',
  };
}

/* ── Services ───────────────────────────────────────────────────────────── */

const ownService = (req, id) => {
  const row = db.prepare(
    `SELECT s.*, c.slug AS category_slug, c.name AS category_name FROM services s JOIN categories c ON c.id = s.category_id
      WHERE s.id = ? AND s.lister_id = ? AND s.deleted_at IS NULL`,
  ).get(id, req.user.id);
  if (!row) throw notFound('That service is not one of yours.');
  return row;
};

function listerService(row, counts = subscriberCounts()) {
  const images = db.prepare('SELECT id, path FROM service_images WHERE service_id = ? ORDER BY sort, id').all(row.id);
  const pending = db.prepare("SELECT id, field, proposed_value, note, created_at FROM change_requests WHERE service_id = ? AND status = 'pending'").all(row.id);
  const days = row.available_days.split(',').filter(Boolean);
  return {
    id: row.id, publicId: row.public_id, slug: row.slug, name: row.name,
    category: { slug: row.category_slug, name: row.category_name },
    shortDescription: row.short_description, description: row.description,
    area: row.area, city: row.city, serviceType: row.service_type,
    monthlyPrice: row.monthly_price, plans: row.plan_months.split(',').map(Number),
    availableDays: days, availableDayNames: days.map((d) => DAY_NAMES[d]), hours: row.hours,
    usagePolicy: { allowed: row.usage_allowed, unit: row.usage_unit, restrictions: row.usage_restrictions, rules: row.service_rules },
    maxSubscribers: row.max_subscribers, status: row.status,
    subscriberCount: counts.get(row.id) || 0,
    images: images.map((i) => ({ id: i.id, url: `/uploads/${i.path}` })),
    pendingChanges: pending.map((p) => ({ id: p.id, field: p.field, proposedValue: p.proposed_value, note: p.note, createdAt: p.created_at })),
    // What the lister may change themselves; everything financial goes through a request.
    editable: ['name', 'shortDescription', 'description', 'availableDays', 'hours', 'usagePolicy', 'serviceType'],
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

listerRouter.get('/overview', (req, res) => {
  const id = req.user.id;
  const month = thisMonth();
  const { start, end } = monthBounds(month);
  const q = (sql, ...args) => db.prepare(sql).get(...args).n;
  const svc = 'SELECT id FROM services WHERE lister_id = ?';
  const summary = monthlySummary(month, { listerId: id });
  const settlement = db.prepare('SELECT status, reference, paid_at FROM settlements WHERE lister_id = ? AND month = ?').get(id, month);
  const recent = db.prepare(
    `SELECT sub.public_id, sub.status, sub.created_at, sub.activated_at, sub.cancelled_at, s.name AS service, u.full_name
       FROM subscriptions sub JOIN services s ON s.id = sub.service_id JOIN users u ON u.id = sub.user_id
      WHERE s.lister_id = ? AND sub.status IN ('active', 'cancelled', 'expired')
      ORDER BY COALESCE(sub.cancelled_at, sub.activated_at, sub.created_at) DESC LIMIT 8`,
  ).all(id);

  res.json({
    standing: listerStanding(id),
    month,
    metrics: {
      totalSubscribers: q(`SELECT COUNT(DISTINCT user_id) AS n FROM subscriptions WHERE service_id IN (${svc}) AND status IN ('active', 'expired', 'cancelled') AND activated_at IS NOT NULL`, id),
      activeSubscriptions: q(`SELECT COUNT(*) AS n FROM subscriptions WHERE service_id IN (${svc}) AND status = 'active' AND end_date >= ?`, id, today()),
      currentMonthSubscribers: q(`SELECT COUNT(*) AS n FROM subscriptions WHERE service_id IN (${svc}) AND status IN ('active', 'expired', 'cancelled') AND start_date <= ? AND end_date >= ?`, id, end, start),
      newSubscriptions: q(`SELECT COUNT(*) AS n FROM subscriptions WHERE service_id IN (${svc}) AND activated_at IS NOT NULL AND substr(activated_at, 1, 7) = ?`, id, month),
      cancellations: q(`SELECT COUNT(*) AS n FROM subscriptions WHERE service_id IN (${svc}) AND status = 'cancelled' AND activated_at IS NOT NULL AND substr(cancelled_at, 1, 7) = ?`, id, month),
      services: q("SELECT COUNT(*) AS n FROM services WHERE lister_id = ? AND deleted_at IS NULL", id),
      activeServices: q("SELECT COUNT(*) AS n FROM services WHERE lister_id = ? AND status = 'active' AND deleted_at IS NULL", id),
      gross: summary.gross,
      commission: summary.gross - summary.listerPayable,
      commissionPercent: summary.services[0]?.percent ?? null,
      payable: summary.listerPayable,
      settlementStatus: settlement?.status || 'not_generated',
    },
    trend: trend(6, { listerId: id }),
    recent: recent.map((r) => ({ id: r.public_id, status: r.status, service: r.service, subscriber: r.full_name, at: r.cancelled_at || r.activated_at || r.created_at })),
  });
});

listerRouter.get('/services', (req, res) => {
  const counts = subscriberCounts();
  const rows = db.prepare(
    `SELECT s.*, c.slug AS category_slug, c.name AS category_name FROM services s JOIN categories c ON c.id = s.category_id
      WHERE s.lister_id = ? AND s.deleted_at IS NULL ORDER BY s.created_at DESC`,
  ).all(req.user.id);
  res.json({ services: rows.map((r) => listerService(r, counts)), standing: listerStanding(req.user.id) });
});

listerRouter.get('/services/:id', (req, res, next) => {
  try { res.json({ service: listerService(ownService(req, req.params.id)) }); } catch (e) { next(e); }
});

/** A lister proposes a new service; it stays unpublished until an admin sets price and QR and activates it. */
listerRouter.post('/services', wrap((req, res) => {
  const standing = listerStanding(req.user.id);
  if (!standing.canPublish) throw forbidden('Finish verification and sign the Lister Agreement before adding services.');
  const b = req.body;
  const name = v.str(b.name, 'Service name', { min: 3, max: 100 });
  const cat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(v.str(b.category, 'Category'));
  if (!cat) throw badRequest('Pick a category.', { field: 'category' });
  const area = v.str(b.area, 'Area', { max: 120 });
  const city = v.str(b.city, 'City', { max: 80 });
  const loc = findLocation(area);
  const proposed = v.rupees(b.proposedPrice, 'Proposed monthly price', { min: 1, max: 100000 });
  const slugBase = slugify(`${name} ${area}`);
  let slug = slugBase;
  for (let i = 2; db.prepare('SELECT 1 FROM services WHERE slug = ?').get(slug); i++) slug = `${slugBase}-${i}`;

  const id = db.prepare(
    `INSERT INTO services (public_id, slug, name, category_id, short_description, description, area, city, lat, lng, service_type,
                           monthly_price, plan_months, available_days, hours, usage_allowed, usage_unit, usage_restrictions, service_rules,
                           status, lister_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '1', ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?)`,
  ).run(servicePublicId(), slug, name, cat.id,
    v.str(b.shortDescription, 'Short description', { min: 10, max: 160 }),
    v.str(b.description, 'Description', { min: 30, max: 4000 }),
    loc?.area || area, loc?.city || city, loc?.lat ?? null, loc?.lng ?? null,
    ['in_person', 'doorstep', 'online'].includes(b.serviceType) ? b.serviceType : 'in_person',
    proposed, v.days(b.availableDays), v.str(b.hours, 'Hours', { required: false, max: 120 }),
    b.usageAllowed === '' || b.usageAllowed == null ? null : v.int(b.usageAllowed, 'Allowed usage', { min: 1, max: 1000 }),
    v.str(b.usageUnit, 'Usage unit', { required: false, max: 30 }) || 'visits',
    v.str(b.usageRestrictions, 'Restrictions', { required: false, max: 1000 }),
    v.str(b.serviceRules, 'Service rules', { required: false, max: 2000 }),
    req.user.id, req.user.id).lastInsertRowid;

  for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all()) {
    notify(a.id, { title: 'Service submitted for review', body: name, link: `/admin#/services/${id}` });
  }
  logActivity({ actor: req.user, action: 'service.proposed', entity: 'service', entityId: id, detail: name });
  res.status(201).json({ service: listerService(ownService(req, id)) });
}));

const FINANCIAL = ['monthlyPrice', 'monthly_price', 'price', 'planMonths', 'plans', 'paymentUpiId', 'paymentQr', 'payment_upi_id', 'commission', 'commissionPercent', 'settlement', 'maxSubscribers', 'status', 'listerId'];

listerRouter.put('/services/:id', wrap((req, res) => {
  const row = ownService(req, req.params.id);
  const b = req.body || {};
  const blocked = FINANCIAL.filter((k) => k in b);
  if (blocked.length) {
    throw forbidden(`Pricing, payment and settlement settings need Subtize.ai approval. Submit a change request for: ${blocked.join(', ')}.`);
  }
  const usage = b.usagePolicy || {};
  const next = {
    name: b.name !== undefined ? v.str(b.name, 'Service name', { min: 3, max: 100 }) : row.name,
    short_description: b.shortDescription !== undefined ? v.str(b.shortDescription, 'Short description', { min: 10, max: 160 }) : row.short_description,
    description: b.description !== undefined ? v.str(b.description, 'Description', { min: 30, max: 4000 }) : row.description,
    available_days: b.availableDays !== undefined ? v.days(b.availableDays) : row.available_days,
    hours: b.hours !== undefined ? v.str(b.hours, 'Hours', { required: false, max: 120 }) : row.hours,
    service_type: ['in_person', 'doorstep', 'online'].includes(b.serviceType) ? b.serviceType : row.service_type,
    usage_allowed: 'allowed' in usage ? (usage.allowed === '' || usage.allowed == null ? null : v.int(usage.allowed, 'Allowed usage', { min: 1, max: 1000 })) : row.usage_allowed,
    usage_unit: 'unit' in usage ? v.str(usage.unit, 'Usage unit', { max: 30 }) : row.usage_unit,
    usage_restrictions: 'restrictions' in usage ? v.str(usage.restrictions, 'Restrictions', { required: false, max: 1000 }) : row.usage_restrictions,
    service_rules: 'rules' in usage ? v.str(usage.rules, 'Service rules', { required: false, max: 2000 }) : row.service_rules,
  };
  db.prepare(
    `UPDATE services SET name = ?, short_description = ?, description = ?, available_days = ?, hours = ?, service_type = ?,
            usage_allowed = ?, usage_unit = ?, usage_restrictions = ?, service_rules = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(next.name, next.short_description, next.description, next.available_days, next.hours, next.service_type,
    next.usage_allowed, next.usage_unit, next.usage_restrictions, next.service_rules, row.id);
  logActivity({ actor: req.user, action: 'service.edited_by_lister', entity: 'service', entityId: row.id });
  res.json({ service: listerService(ownService(req, row.id)) });
}));

listerRouter.post('/services/:id/images', serviceImages.array('images', 6), wrap((req, res) => {
  const row = ownService(req, req.params.id);
  if (!req.files?.length) throw badRequest('Choose at least one image.');
  const ins = db.prepare('INSERT INTO service_images (service_id, path, sort) VALUES (?, ?, ?)');
  const base = db.prepare('SELECT COALESCE(MAX(sort), 0) AS n FROM service_images WHERE service_id = ?').get(row.id).n;
  req.files.forEach((f, i) => ins.run(row.id, rel(f), base + i + 1));
  res.status(201).json({ service: listerService(ownService(req, row.id)) });
}));

listerRouter.delete('/services/:id/images/:imageId', wrap((req, res) => {
  const row = ownService(req, req.params.id);
  const img = db.prepare('SELECT * FROM service_images WHERE id = ? AND service_id = ?').get(req.params.imageId, row.id);
  if (!img) throw notFound('Image not found.');
  db.prepare('DELETE FROM service_images WHERE id = ?').run(img.id);
  fs.rm(path.join(config.uploadDir, img.path), { force: true }, () => {});
  res.json({ service: listerService(ownService(req, row.id)) });
}));

listerRouter.post('/services/:id/change-requests', wrap((req, res) => {
  const row = ownService(req, req.params.id);
  const field = v.oneOf(req.body.field, 'Field', ['monthly_price', 'plan_months', 'payment_qr', 'settlement', 'other']);
  let proposed = v.str(req.body.proposedValue, 'Proposed value', { max: 500 });
  if (field === 'monthly_price') proposed = String(v.rupees(proposed, 'Proposed price', { min: 1, max: 100000 }));
  if (field === 'plan_months') proposed = v.planMonths(proposed);
  const current = field === 'monthly_price' ? String(row.monthly_price) : field === 'plan_months' ? row.plan_months : null;
  if (db.prepare("SELECT 1 FROM change_requests WHERE service_id = ? AND field = ? AND status = 'pending'").get(row.id, field)) {
    throw conflict('There is already a pending request for that field.');
  }
  db.prepare('INSERT INTO change_requests (service_id, lister_id, field, current_value, proposed_value, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, req.user.id, field, current, proposed, v.str(req.body.note, 'Note', { required: false, max: 500 }));
  for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all()) {
    notify(a.id, { title: 'Change request from a lister', body: `${row.name}: ${field.replace('_', ' ')}`, link: '/admin#/services/changes' });
  }
  res.status(201).json({ service: listerService(ownService(req, row.id)) });
}));

listerRouter.get('/change-requests', (req, res) => {
  const rows = db.prepare(
    `SELECT cr.*, s.name AS service FROM change_requests cr JOIN services s ON s.id = cr.service_id WHERE cr.lister_id = ? ORDER BY cr.id DESC`,
  ).all(req.user.id);
  res.json({
    requests: rows.map((r) => ({
      id: r.id, serviceId: r.service_id, service: r.service, field: r.field, currentValue: r.current_value, proposedValue: r.proposed_value,
      note: r.note, status: r.status, decisionNote: r.decision_note, decidedAt: r.decided_at, createdAt: r.created_at,
    })),
  });
});

/* ── Subscribers, cancellations, check-in ───────────────────────────────── */

/** Subscriber records carry the member's name and plan, never their contact details. */
function subscriberRow(r) {
  const usage = r.status === 'active' || r.status === 'expired' ? usageSummary(r) : null;
  return {
    id: r.public_id, service: r.service_name, serviceId: r.service_id, subscriber: r.full_name, months: r.months,
    status: r.status, startDate: r.start_date, endDate: r.end_date, activatedAt: r.activated_at,
    cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason, amount: r.final_amount,
    usage: usage && { allowed: usage.allowed, used: usage.used, remaining: usage.remaining, unit: usage.unit },
  };
}

const SUBS_FOR_LISTER = `
  SELECT sub.*, s.name AS service_name, u.full_name,
         (SELECT final_amount FROM payments WHERE subscription_id = sub.id AND status = 'verified' ORDER BY id DESC LIMIT 1) AS final_amount
    FROM subscriptions sub JOIN services s ON s.id = sub.service_id JOIN users u ON u.id = sub.user_id
   WHERE s.lister_id = ? AND sub.activated_at IS NOT NULL`;

listerRouter.get('/subscribers', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : thisMonth();
  const { start, end } = monthBounds(month);
  const args = [req.user.id, end, start];
  let sql = `${SUBS_FOR_LISTER} AND sub.start_date <= ? AND sub.end_date >= ?`;
  if (req.query.serviceId) { sql += ' AND sub.service_id = ?'; args.push(req.query.serviceId); }
  if (req.query.status) { sql += ' AND sub.status = ?'; args.push(req.query.status); }
  const rows = db.prepare(`${sql} ORDER BY sub.start_date DESC`).all(...args);
  res.json({ month, subscribers: rows.map(subscriberRow) });
});

listerRouter.get('/cancellations', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : null;
  const args = [req.user.id];
  let sql = `${SUBS_FOR_LISTER} AND sub.status = 'cancelled'`;
  if (month) { sql += ' AND substr(sub.cancelled_at, 1, 7) = ?'; args.push(month); }
  const rows = db.prepare(`${sql} ORDER BY sub.cancelled_at DESC`).all(...args);
  res.json({ month, cancellations: rows.map(subscriberRow) });
});

/** Finds a card by its QR code value, the verify URL, or the subscription ID printed on it. */
function findCardForLister(req, input) {
  const raw = String(input || '').trim();
  const code = raw.includes('/verify/') ? raw.split('/verify/').pop().split(/[?#]/)[0] : raw;
  const row = db.prepare(
    `SELECT sub.*, s.name AS service_name, s.lister_id, s.available_days, u.full_name
       FROM subscriptions sub JOIN services s ON s.id = sub.service_id JOIN users u ON u.id = sub.user_id
      WHERE sub.card_code = ? OR sub.public_id = ? COLLATE NOCASE`,
  ).get(code, code.toUpperCase());
  if (!row) throw notFound('No subscription matches that card.');
  if (row.lister_id !== req.user.id) throw forbidden('That subscription is for a service you do not run.');
  return row;
}

listerRouter.post('/checkin/lookup', wrap((req, res) => {
  const row = findCardForLister(req, req.body.code);
  const usage = usageSummary(row);
  res.json({
    subscription: { ...subscriberRow(row), usage: { allowed: usage.allowed, used: usage.used, remaining: usage.remaining, unit: usage.unit } },
    validToday: row.status === 'active' && row.start_date <= today() && row.end_date >= today(),
    availableToday: row.available_days.split(',').includes(dayKey(today())),
  });
}));

listerRouter.post('/checkin', wrap((req, res) => {
  const row = findCardForLister(req, req.body.code);
  const units = v.int(req.body.units, 'Units', { min: 1, max: 20, fallback: 1 });
  const usage = recordUsage(row, { units, note: v.str(req.body.note, 'Note', { required: false, max: 200 }), source: 'lister', by: req.user.id });
  logActivity({ actor: req.user, action: 'usage.recorded', entity: 'subscription', entityId: row.public_id, detail: `${units}` });
  res.json({ subscription: subscriberRow(row), usage: { allowed: usage.allowed, used: usage.used, remaining: usage.remaining, unit: usage.unit } });
}));

/** Recent visits recorded against this lister's services, by anyone. */
listerRouter.get('/checkins', (req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const rows = db.prepare(
    `SELECT l.units, l.note, l.source, l.logged_at, sub.public_id, sub.usage_unit, s.name AS service, u.full_name
       FROM usage_logs l JOIN subscriptions sub ON sub.id = l.subscription_id JOIN services s ON s.id = sub.service_id
       JOIN users u ON u.id = sub.user_id
      WHERE s.lister_id = ? ORDER BY l.logged_at DESC, l.id DESC LIMIT ?`,
  ).all(req.user.id, limit);
  res.json({
    checkins: rows.map((r) => ({
      at: localToIso(r.logged_at), subscriber: r.full_name, service: r.service, id: r.public_id,
      units: r.units, unit: r.usage_unit, note: r.note, source: r.source,
    })),
  });
});

/* ── Money ──────────────────────────────────────────────────────────────── */

listerRouter.get('/revenue', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : thisMonth();
  const s = monthlySummary(month, { listerId: req.user.id });
  res.json({
    month,
    gross: s.gross,
    commission: s.gross - s.listerPayable,
    payable: s.listerPayable,
    payments: s.payments,
    services: s.services.map((r) => ({ service: r.service, serviceId: r.serviceId, payments: r.payments, gross: r.gross, commission: r.commission, payable: r.payable, percent: r.percent })),
    trend: trend(12, { listerId: req.user.id }),
  });
});

listerRouter.get('/settlements', (req, res) => {
  const rows = db.prepare(`${SETTLEMENT_SELECT} WHERE st.lister_id = ? ORDER BY st.month DESC`).all(req.user.id);
  res.json({ settlements: rows.map(settlementView) });
});

/* ── Agreement ──────────────────────────────────────────────────────────── */

const myAgreement = (req) => db.prepare(`${AGREEMENT_SELECT} WHERE a.lister_id = ? ORDER BY a.id DESC LIMIT 1`).get(req.user.id);

listerRouter.get('/agreement', (req, res) => {
  const row = myAgreement(req);
  const app = db.prepare('SELECT * FROM lister_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  res.json({
    agreement: row ? agreementView(row) : null,
    application: app ? applicationView(app) : null,
    standing: listerStanding(req.user.id),
  });
});

listerRouter.post('/agreement/sign', wrap((req, res) => {
  const row = myAgreement(req);
  if (!row) throw notFound('There is no agreement to sign yet.');
  if (row.status !== 'pending_lister') throw conflict('This agreement has already been signed.');
  const name = v.str(req.body.signedName, 'Full name', { min: 2, max: 120 });
  const signature = String(req.body.signature || '');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > 400_000) {
    throw badRequest('Draw your signature in the box before signing.', { field: 'signature' });
  }
  if (!v.bool(req.body.accept)) throw badRequest('Tick the box to accept the agreement, including the 20% platform commission.', { field: 'accept' });
  db.prepare(
    `UPDATE agreements SET status = 'pending_admin', lister_signed_name = ?, lister_signature = ?, lister_signed_at = datetime('now'),
            lister_signed_ip = ? WHERE id = ?`,
  ).run(name, signature, req.ip, row.id);
  for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all()) {
    notify(a.id, { title: 'Agreement signed by lister', body: `${row.public_id} needs countersigning`, link: `/admin#/agreements/${row.id}` });
  }
  logActivity({ actor: req.user, action: 'agreement.lister_signed', entity: 'agreement', entityId: row.public_id });
  res.json({ agreement: agreementView(myAgreement(req)), standing: listerStanding(req.user.id) });
}));

listerRouter.get('/agreement/download', (req, res, next) => {
  const row = myAgreement(req);
  if (!row) return next(notFound('No agreement yet.'));
  const view = { ...agreementView(row), listerSignedIp: row.lister_signed_ip };
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Subtize-Lister-Agreement-${row.public_id}.html"`);
  res.send(agreementDocument(view));
});

