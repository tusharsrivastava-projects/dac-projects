import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from '../config.js';
import { db, logActivity, notify, tx } from '../db/index.js';
import { DAY_NAMES, subscriberCounts } from '../lib/catalog.js';
import { today } from '../lib/dates.js';
import { findLocation } from '../lib/geo.js';
import { badRequest, conflict, notFound, wrap } from '../lib/http.js';
import { servicePublicId, slugify } from '../lib/ids.js';
import { platformSettings } from '../lib/platform.js';
import { SUB_SELECT, activate, memberSubscription, recordUsage, usageSummary } from '../lib/subscriptions.js';
import { qrDataUrl, upiIntent } from '../lib/upi.js';
import * as v from '../lib/validate.js';
import { requireAdmin } from '../middleware/session.js';
import { officialQr, rel, serviceImages } from '../middleware/uploads.js';
import { cancelByAdmin } from './admin.js';
import { listerStanding } from './lister.js';

export const adminCatalogRouter = express.Router();
adminCatalogRouter.use(requireAdmin);

/* ── Services ───────────────────────────────────────────────────────────── */

const SERVICE_SELECT = `
  SELECT s.*, c.slug AS category_slug, c.name AS category_name, u.full_name AS lister_name, u.email AS lister_email,
         (SELECT business_name FROM lister_applications la WHERE la.user_id = s.lister_id ORDER BY la.id DESC LIMIT 1) AS business_name
    FROM services s JOIN categories c ON c.id = s.category_id LEFT JOIN users u ON u.id = s.lister_id`;

function adminService(row, counts = subscriberCounts()) {
  const images = db.prepare('SELECT id, path FROM service_images WHERE service_id = ? ORDER BY sort, id').all(row.id);
  const days = row.available_days.split(',').filter(Boolean);
  const coupons = db.prepare('SELECT code, is_active FROM coupons WHERE service_id = ? OR service_id IS NULL').all(row.id);
  return {
    id: row.id, publicId: row.public_id, slug: row.slug, name: row.name,
    category: { slug: row.category_slug, name: row.category_name },
    shortDescription: row.short_description, description: row.description,
    area: row.area, city: row.city, lat: row.lat, lng: row.lng, serviceType: row.service_type,
    monthlyPrice: row.monthly_price, plans: row.plan_months.split(',').map(Number),
    availableDays: days, availableDayNames: days.map((d) => DAY_NAMES[d]), hours: row.hours,
    usagePolicy: { allowed: row.usage_allowed, unit: row.usage_unit, restrictions: row.usage_restrictions, rules: row.service_rules },
    maxSubscribers: row.max_subscribers, couponsEnabled: Boolean(row.coupons_enabled),
    payment: {
      upiId: row.payment_upi_id, payee: row.payment_payee,
      effectiveUpiId: row.payment_upi_id || platformSettings().upiId,
      effectivePayee: row.payment_payee || platformSettings().payee,
      qrAttached: Boolean(row.payment_qr_path),
      qrUrl: row.payment_qr_path ? `/api/admin/services/${row.id}/qr-image` : null,
    },
    status: row.status,
    lister: row.lister_id ? { id: row.lister_id, name: row.lister_name, email: row.lister_email, businessName: row.business_name, standing: listerStanding(row.lister_id) } : null,
    provider: { name: row.provider_name, contact: row.provider_contact, notes: row.provider_notes },
    subscriberCount: counts.get(row.id) || 0,
    images: images.map((i) => ({ id: i.id, url: `/uploads/${i.path}` })),
    coupons: coupons.map((c) => ({ code: c.code, active: Boolean(c.is_active) })),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const serviceOr404 = (id) => {
  const row = db.prepare(`${SERVICE_SELECT} WHERE s.id = ? AND s.deleted_at IS NULL`).get(id);
  if (!row) throw notFound('No such service.');
  return row;
};

adminCatalogRouter.get('/services', (req, res) => {
  const where = ['s.deleted_at IS NULL'];
  const args = [];
  if (req.query.status) { where.push('s.status = ?'); args.push(req.query.status); }
  if (req.query.category) { where.push('c.slug = ?'); args.push(req.query.category); }
  if (req.query.listerId) { where.push('s.lister_id = ?'); args.push(req.query.listerId); }
  if (req.query.q) {
    where.push('(s.name LIKE ? OR s.area LIKE ? OR s.public_id LIKE ? OR u.full_name LIKE ? OR s.provider_name LIKE ?)');
    const like = `%${req.query.q}%`;
    args.push(like, like, like, like, like);
  }
  const counts = subscriberCounts();
  const rows = db.prepare(`${SERVICE_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC`).all(...args);
  const statusCounts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM services WHERE deleted_at IS NULL GROUP BY status').all().map((r) => [r.status, r.n]));
  res.json({ services: rows.map((r) => adminService(r, counts)), counts: statusCounts });
});

adminCatalogRouter.get('/services/:id', wrap((req, res) => {
  const row = serviceOr404(req.params.id);
  const subs = db.prepare(`${SUB_SELECT} WHERE sub.service_id = ? AND sub.status <> 'pending_payment' ORDER BY sub.created_at DESC LIMIT 200`).all(row.id);
  const all = subs.map((r) => memberSubscription(r));
  const changes = db.prepare("SELECT * FROM change_requests WHERE service_id = ? ORDER BY id DESC").all(row.id);
  res.json({
    service: adminService(row),
    subscriptions: all.filter((s) => s.status !== 'cancelled').map((s) => ({ ...s, user: subs.find((r) => r.public_id === s.id)?.user_name })),
    cancellations: all.filter((s) => s.status === 'cancelled').map((s) => ({ ...s, user: subs.find((r) => r.public_id === s.id)?.user_name })),
    changeRequests: changes.map(changeView),
  });
}));

/** Reads the admin add/edit form. `partial` lets an edit send only what changed. */
function readService(b, current = null) {
  const pick = (key, fn) => (b[key] !== undefined ? fn(b[key]) : current ? undefined : fn(undefined));
  const out = {};
  const set = (col, val) => { if (val !== undefined) out[col] = val; };

  set('name', pick('name', (x) => v.str(x, 'Service name', { min: 3, max: 100 })));
  if (b.category !== undefined || !current) {
    const cat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(v.str(b.category, 'Category'));
    if (!cat) throw badRequest('Pick a category.', { field: 'category' });
    out.category_id = cat.id;
  }
  set('short_description', pick('shortDescription', (x) => v.str(x, 'Short description', { min: 10, max: 160 })));
  set('description', pick('description', (x) => v.str(x, 'Description', { min: 30, max: 4000 })));
  if (b.area !== undefined || !current) {
    out.area = v.str(b.area, 'Location / area', { max: 120 });
    out.city = v.str(b.city, 'City', { max: 80 });
    const loc = findLocation(out.area);
    out.lat = b.lat !== undefined && b.lat !== '' ? v.num(b.lat, 'Latitude', { min: -90, max: 90 }) : loc?.lat ?? null;
    out.lng = b.lng !== undefined && b.lng !== '' ? v.num(b.lng, 'Longitude', { min: -180, max: 180 }) : loc?.lng ?? null;
  }
  set('service_type', pick('serviceType', (x) => (['in_person', 'doorstep', 'online'].includes(x) ? x : 'in_person')));
  set('monthly_price', pick('monthlyPrice', (x) => v.rupees(x, 'Monthly price', { min: 1, max: 100000 })));
  set('plan_months', pick('plans', (x) => v.planMonths(x)));
  set('available_days', pick('availableDays', (x) => v.days(x)));
  set('hours', pick('hours', (x) => v.str(x, 'Hours', { required: false, max: 120 })));
  const usage = b.usagePolicy || (current ? null : {});
  if (usage) {
    if ('allowed' in usage || !current) out.usage_allowed = usage.allowed === '' || usage.allowed == null ? null : v.int(usage.allowed, 'Allowed usage', { min: 1, max: 1000 });
    if ('unit' in usage || !current) out.usage_unit = v.str(usage.unit, 'Usage unit', { required: false, max: 30 }) || 'visits';
    if ('restrictions' in usage || !current) out.usage_restrictions = v.str(usage.restrictions, 'Restrictions', { required: false, max: 1000 });
    if ('rules' in usage || !current) out.service_rules = v.str(usage.rules, 'Service rules', { required: false, max: 2000 });
  }
  set('max_subscribers', pick('maxSubscribers', (x) => (x === '' || x == null ? null : v.int(x, 'Maximum subscribers', { min: 1, max: 100000 }))));
  set('coupons_enabled', pick('couponsEnabled', (x) => (x === undefined ? 1 : v.bool(x) ? 1 : 0)));
  set('payment_upi_id', pick('paymentUpiId', (x) => v.vpa(x, 'Official payment UPI ID', { required: false })));
  set('payment_payee', pick('paymentPayee', (x) => v.str(x, 'Payee name', { required: false, max: 80 })));
  if (b.listerId !== undefined || !current) {
    const lid = b.listerId === '' || b.listerId == null ? null : v.int(b.listerId, 'Lister account', { min: 1 });
    if (lid) {
      const l = db.prepare('SELECT role FROM users WHERE id = ?').get(lid);
      if (!l || l.role !== 'lister') throw badRequest('The lister account must belong to an approved lister.', { field: 'listerId' });
    }
    out.lister_id = lid;
  }
  set('provider_name', pick('providerName', (x) => v.str(x, 'Provider name', { required: false, max: 160 })));
  set('provider_contact', pick('providerContact', (x) => v.str(x, 'Provider contact', { required: false, max: 160 })));
  set('provider_notes', pick('providerNotes', (x) => v.str(x, 'Internal notes', { required: false, max: 2000 })));
  if (b.status !== undefined || !current) out.status = v.oneOf(b.status || 'draft', 'Status', ['draft', 'pending_review', 'active', 'inactive']);
  return out;
}

/** The publishing rule: a lister's service can only go live once they are verified and under agreement. */
function assertPublishable(svc) {
  if (svc.status !== 'active' || !svc.lister_id) return;
  const standing = listerStanding(svc.lister_id);
  if (!standing.canPublish) {
    throw badRequest(standing.verified
      ? 'This lister has not completed the Lister Agreement yet, so the service cannot be activated.'
      : 'This lister is not verified yet, so the service cannot be activated.');
  }
}

adminCatalogRouter.post('/services', wrap((req, res) => {
  const f = readService(req.body);
  assertPublishable(f);
  const base = slugify(`${f.name} ${f.area}`);
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM services WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`;
  const cols = ['public_id', 'slug', 'created_by', ...Object.keys(f)];
  const id = db.prepare(`INSERT INTO services (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(servicePublicId(), slug, req.user.id, ...Object.values(f)).lastInsertRowid;
  logActivity({ actor: req.user, action: 'service.created', entity: 'service', entityId: id, detail: f.name });
  res.status(201).json({ service: adminService(serviceOr404(id)) });
}));

adminCatalogRouter.put('/services/:id', wrap((req, res) => {
  const row = serviceOr404(req.params.id);
  const f = readService(req.body, row);
  assertPublishable({ ...row, ...f });
  if (Object.keys(f).length) {
    db.prepare(`UPDATE services SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(f), row.id);
  }
  logActivity({ actor: req.user, action: 'service.updated', entity: 'service', entityId: row.id, detail: Object.keys(f).join(', ') });
  res.json({ service: adminService(serviceOr404(row.id)) });
}));

adminCatalogRouter.post('/services/:id/status', wrap((req, res) => {
  const row = serviceOr404(req.params.id);
  const status = v.oneOf(req.body.status, 'Status', ['draft', 'pending_review', 'active', 'inactive']);
  assertPublishable({ ...row, status });
  db.prepare("UPDATE services SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, row.id);
  if (row.lister_id && status !== row.status) {
    notify(row.lister_id, { title: status === 'active' ? `${row.name} is live` : `${row.name} is now ${status.replace('_', ' ')}`, link: `/lister#/services/${row.id}` });
  }
  logActivity({ actor: req.user, action: `service.${status}`, entity: 'service', entityId: row.id });
  res.json({ service: adminService(serviceOr404(row.id)) });
}));

adminCatalogRouter.delete('/services/:id', wrap((req, res) => {
  const row = serviceOr404(req.params.id);
  const live = db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE service_id = ? AND status IN ('active', 'pending_verification', 'verified')").get(row.id).n;
  if (live && !v.bool(req.body?.force)) {
    throw conflict(`${live} subscription(s) are still active or awaiting verification. Deactivate the service instead, or confirm deletion.`);
  }
  db.prepare("UPDATE services SET deleted_at = datetime('now'), status = 'inactive' WHERE id = ?").run(row.id);
  logActivity({ actor: req.user, action: 'service.deleted', entity: 'service', entityId: row.id, detail: row.name });
  res.json({ ok: true });
}));

adminCatalogRouter.post('/services/:id/images', serviceImages.array('images', 6), wrap((req, res) => {
  const row = serviceOr404(req.params.id);
  if (!req.files?.length) throw badRequest('Choose at least one image.');
  const ins = db.prepare('INSERT INTO service_images (service_id, path, sort) VALUES (?, ?, ?)');
  const base = db.prepare('SELECT COALESCE(MAX(sort), 0) AS n FROM service_images WHERE service_id = ?').get(row.id).n;
  req.files.forEach((f, i) => ins.run(row.id, rel(f), base + i + 1));
  res.status(201).json({ service: adminService(serviceOr404(row.id)) });
}));

adminCatalogRouter.delete('/services/:id/images/:imageId', wrap((req, res) => {
  const row = serviceOr404(req.params.id);
  const img = db.prepare('SELECT * FROM service_images WHERE id = ? AND service_id = ?').get(req.params.imageId, row.id);
  if (!img) throw notFound('Image not found.');
  db.prepare('DELETE FROM service_images WHERE id = ?').run(img.id);
  fs.rm(path.join(config.uploadDir, img.path), { force: true }, () => {});
  res.json({ service: adminService(serviceOr404(row.id)) });
}));

/** Attach an official QR image (e.g. the static QR printed by the bank for the collection account). */
adminCatalogRouter.post('/services/:id/qr', officialQr.single('qr'), wrap((req, res) => {
  const row = serviceOr404(req.params.id);
  if (!req.file) throw badRequest('Choose the official QR image.');
  if (row.payment_qr_path) fs.rm(path.join(config.uploadDir, row.payment_qr_path), { force: true }, () => {});
  db.prepare("UPDATE services SET payment_qr_path = ?, updated_at = datetime('now') WHERE id = ?").run(rel(req.file), row.id);
  logActivity({ actor: req.user, action: 'service.qr_attached', entity: 'service', entityId: row.id });
  res.json({ service: adminService(serviceOr404(row.id)) });
}));

adminCatalogRouter.delete('/services/:id/qr', wrap((req, res) => {
  const row = serviceOr404(req.params.id);
  if (row.payment_qr_path) fs.rm(path.join(config.uploadDir, row.payment_qr_path), { force: true }, () => {});
  db.prepare('UPDATE services SET payment_qr_path = NULL WHERE id = ?').run(row.id);
  res.json({ service: adminService(serviceOr404(row.id)) });
}));

adminCatalogRouter.get('/services/:id/qr-image', (req, res, next) => {
  try {
    const row = serviceOr404(req.params.id);
    if (!row.payment_qr_path) throw notFound('No QR attached.');
    res.sendFile(path.join(config.uploadDir, row.payment_qr_path));
  } catch (e) { next(e); }
});

/** Preview of the generated official QR at the monthly price, as members will see it. */
adminCatalogRouter.get('/services/:id/qr-preview', wrap(async (req, res) => {
  const row = serviceOr404(req.params.id);
  const p = platformSettings();
  const uri = upiIntent({ vpa: row.payment_upi_id || p.upiId, payee: row.payment_payee || p.payee, amountPaise: row.monthly_price, reference: 'SBZPREVIEW', note: `Subtize ${row.name}` });
  res.json({ upiUri: uri, image: await qrDataUrl(uri) });
}));

/* ── Change requests ────────────────────────────────────────────────────── */

function changeView(r) {
  return {
    id: r.id, serviceId: r.service_id, service: r.service_name, lister: r.lister_name, field: r.field,
    currentValue: r.current_value, proposedValue: r.proposed_value, note: r.note, status: r.status,
    decisionNote: r.decision_note, decidedAt: r.decided_at, createdAt: r.created_at,
  };
}

adminCatalogRouter.get('/change-requests', (req, res) => {
  const rows = db.prepare(
    `SELECT cr.*, s.name AS service_name, u.full_name AS lister_name FROM change_requests cr
       JOIN services s ON s.id = cr.service_id JOIN users u ON u.id = cr.lister_id
      WHERE (? IS NULL OR cr.status = ?) ORDER BY cr.status = 'pending' DESC, cr.id DESC`,
  ).all(req.query.status || null, req.query.status || null);
  res.json({ requests: rows.map(changeView) });
});

adminCatalogRouter.post('/change-requests/:id/:decision', wrap((req, res) => {
  const cr = db.prepare('SELECT * FROM change_requests WHERE id = ?').get(req.params.id);
  if (!cr) throw notFound('No such request.');
  if (cr.status !== 'pending') throw conflict('Already decided.');
  const decision = v.oneOf(req.params.decision, 'Decision', ['approve', 'reject']);
  const note = v.str(req.body.note, 'Note', { required: false, max: 500 });
  tx(() => {
    if (decision === 'approve') {
      if (cr.field === 'monthly_price') db.prepare("UPDATE services SET monthly_price = ?, updated_at = datetime('now') WHERE id = ?").run(Number(cr.proposed_value), cr.service_id);
      if (cr.field === 'plan_months') db.prepare("UPDATE services SET plan_months = ?, updated_at = datetime('now') WHERE id = ?").run(cr.proposed_value, cr.service_id);
    }
    db.prepare("UPDATE change_requests SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ?")
      .run(decision === 'approve' ? 'approved' : 'rejected', req.user.id, note, cr.id);
  })();
  notify(cr.lister_id, { title: `Change request ${decision === 'approve' ? 'approved' : 'declined'}`, body: note, link: `/lister#/services/${cr.service_id}` });
  logActivity({ actor: req.user, action: `change_request.${decision}d`, entity: 'service', entityId: cr.service_id, detail: cr.field });
  res.json({ ok: true });
}));

/* ── Coupons ────────────────────────────────────────────────────────────── */

function couponView(c) {
  return {
    id: c.id, code: c.code, description: c.description, serviceId: c.service_id, service: c.service_name || null,
    discountType: c.discount_type, discountValue: c.discount_value, maxDiscount: c.max_discount, minValue: c.min_value,
    startsOn: c.starts_on, expiresOn: c.expires_on, usageLimit: c.usage_limit, perUserLimit: c.per_user_limit,
    used: c.used, active: Boolean(c.is_active), public: Boolean(c.is_public), createdAt: c.created_at,
    live: Boolean(c.is_active) && c.starts_on <= today() && c.expires_on >= today() && (c.usage_limit == null || c.used < c.usage_limit),
  };
}

const COUPON_SELECT = `
  SELECT c.*, s.name AS service_name,
         (SELECT COUNT(*) FROM payments p WHERE p.coupon_id = c.id AND p.status IN ('pending', 'verified')) AS used
    FROM coupons c LEFT JOIN services s ON s.id = c.service_id`;

function readCoupon(b) {
  const type = v.oneOf(b.discountType, 'Discount type', ['percent', 'fixed']);
  const value = type === 'percent' ? v.int(b.discountValue, 'Discount %', { min: 1, max: 90 }) : v.rupees(b.discountValue, 'Discount amount', { min: 1, max: 100000 });
  const starts = v.isoDate(b.startsOn, 'Start date', { required: true });
  const expires = v.isoDate(b.expiresOn, 'Expiry date', { required: true });
  if (expires < starts) throw badRequest('Expiry date must be on or after the start date.', { field: 'expiresOn' });
  const serviceId = b.serviceId === '' || b.serviceId == null ? null : v.int(b.serviceId, 'Service', { min: 1 });
  if (serviceId && !db.prepare('SELECT 1 FROM services WHERE id = ? AND deleted_at IS NULL').get(serviceId)) throw badRequest('That service does not exist.');
  return {
    code: v.str(b.code, 'Coupon code', { min: 3, max: 20 }).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    description: v.str(b.description, 'Description', { required: false, max: 200 }),
    service_id: serviceId,
    discount_type: type,
    discount_value: value,
    max_discount: type === 'percent' ? v.rupees(b.maxDiscount, 'Maximum discount', { required: false, min: 1 }) : null,
    min_value: v.rupees(b.minValue, 'Minimum subscription value', { required: false, min: 0 }) ?? 0,
    starts_on: starts,
    expires_on: expires,
    usage_limit: b.usageLimit === '' || b.usageLimit == null ? null : v.int(b.usageLimit, 'Usage limit', { min: 1, max: 100000 }),
    per_user_limit: v.int(b.perUserLimit, 'Per-user limit', { min: 1, max: 100, fallback: 1 }),
    is_active: b.active === undefined ? 1 : v.bool(b.active) ? 1 : 0,
    is_public: b.public === undefined ? 1 : v.bool(b.public) ? 1 : 0,
  };
}

adminCatalogRouter.get('/coupons', (req, res) => {
  const rows = db.prepare(`${COUPON_SELECT} ORDER BY c.created_at DESC`).all();
  res.json({ coupons: rows.map(couponView) });
});

adminCatalogRouter.post('/coupons', wrap((req, res) => {
  const f = readCoupon(req.body);
  if (db.prepare('SELECT 1 FROM coupons WHERE code = ? COLLATE NOCASE').get(f.code)) throw conflict('That coupon code already exists.');
  const cols = [...Object.keys(f), 'created_by'];
  const id = db.prepare(`INSERT INTO coupons (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(f), req.user.id).lastInsertRowid;
  logActivity({ actor: req.user, action: 'coupon.created', entity: 'coupon', entityId: id, detail: f.code });
  res.status(201).json({ coupon: couponView(db.prepare(`${COUPON_SELECT} WHERE c.id = ?`).get(id)) });
}));

adminCatalogRouter.put('/coupons/:id', wrap((req, res) => {
  const c = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id);
  if (!c) throw notFound('No such coupon.');
  const f = readCoupon(req.body);
  if (f.code !== c.code && db.prepare('SELECT 1 FROM coupons WHERE code = ? COLLATE NOCASE AND id <> ?').get(f.code, c.id)) throw conflict('That coupon code already exists.');
  db.prepare(`UPDATE coupons SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(f), c.id);
  logActivity({ actor: req.user, action: 'coupon.updated', entity: 'coupon', entityId: c.id, detail: f.code });
  res.json({ coupon: couponView(db.prepare(`${COUPON_SELECT} WHERE c.id = ?`).get(c.id)) });
}));

adminCatalogRouter.post('/coupons/:id/toggle', wrap((req, res) => {
  const c = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id);
  if (!c) throw notFound('No such coupon.');
  db.prepare('UPDATE coupons SET is_active = ? WHERE id = ?').run(c.is_active ? 0 : 1, c.id);
  res.json({ coupon: couponView(db.prepare(`${COUPON_SELECT} WHERE c.id = ?`).get(c.id)) });
}));

adminCatalogRouter.delete('/coupons/:id', wrap((req, res) => {
  const c = db.prepare(`${COUPON_SELECT} WHERE c.id = ?`).get(req.params.id);
  if (!c) throw notFound('No such coupon.');
  // Used coupons stay for the payment record; they are only switched off.
  if (c.used || db.prepare('SELECT 1 FROM payments WHERE coupon_id = ?').get(c.id)) {
    db.prepare('UPDATE coupons SET is_active = 0 WHERE id = ?').run(c.id);
    return res.json({ deactivated: true });
  }
  db.prepare('DELETE FROM coupons WHERE id = ?').run(c.id);
  res.json({ deleted: true });
}));

/* ── Payments ───────────────────────────────────────────────────────────── */

const PAYMENT_SELECT = `
  SELECT p.*, s.name AS service_name, s.public_id AS service_public_id, u.full_name AS user_name, u.email AS user_email,
         u.public_id AS user_public_id, sub.public_id AS subscription_public_id, sub.status AS subscription_status, sub.months,
         vb.full_name AS verifier_name
    FROM payments p JOIN services s ON s.id = p.service_id JOIN users u ON u.id = p.user_id
    JOIN subscriptions sub ON sub.id = p.subscription_id LEFT JOIN users vb ON vb.id = p.verified_by`;

function paymentView(p) {
  return {
    id: p.public_id, internalId: p.id, status: p.status,
    user: { id: p.user_id, publicId: p.user_public_id, name: p.user_name, email: p.user_email },
    service: { id: p.service_id, publicId: p.service_public_id, name: p.service_name },
    subscription: { id: p.subscription_public_id, internalId: p.subscription_id, status: p.subscription_status, months: p.months },
    amount: p.amount, couponCode: p.coupon_code, discount: p.discount, finalAmount: p.final_amount,
    upiTxnId: p.upi_txn_id, upiRef: p.upi_ref, payeeVpa: p.payee_vpa, qrPayload: p.qr_payload,
    createdAt: p.created_at, submittedAt: p.submitted_at,
    verifiedAt: p.verified_at, verifiedBy: p.verifier_name, rejectionReason: p.rejection_reason,
    activation: p.subscription_status === 'active' || p.subscription_status === 'expired' ? 'activated'
      : p.status === 'verified' ? 'awaiting_activation' : p.status === 'rejected' ? 'not_activated' : 'pending',
  };
}

adminCatalogRouter.get('/payments', (req, res) => {
  const where = ["p.status <> 'awaiting_payment' OR ? = 'awaiting_payment'"];
  const args = [req.query.status || ''];
  if (req.query.status) { where.push('p.status = ?'); args.push(req.query.status); }
  if (req.query.q) {
    where.push('(p.public_id LIKE ? OR p.upi_txn_id LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR s.name LIKE ? OR sub.public_id LIKE ?)');
    const like = `%${req.query.q}%`;
    args.push(like, like, like, like, like, like);
  }
  const rows = db.prepare(`${PAYMENT_SELECT} WHERE (${where.join(') AND (')}) ORDER BY p.status = 'pending' DESC, COALESCE(p.submitted_at, p.created_at) DESC LIMIT 300`).all(...args);
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM payments GROUP BY status').all().map((r) => [r.status, r.n]));
  res.json({ payments: rows.map(paymentView), counts });
});

const paymentOr404 = (id) => {
  const p = db.prepare(`${PAYMENT_SELECT} WHERE p.public_id = ?`).get(id);
  if (!p) throw notFound('No such payment.');
  return p;
};

adminCatalogRouter.post('/payments/:id/verify', wrap((req, res) => {
  const p = paymentOr404(req.params.id);
  if (p.status !== 'pending') throw conflict(p.status === 'awaiting_payment' ? 'The member has not submitted a transaction ID yet.' : `This payment is already ${p.status}.`);
  const andActivate = req.body.activate === undefined ? true : v.bool(req.body.activate);
  let dates = null;
  tx(() => {
    db.prepare("UPDATE payments SET status = 'verified', verified_by = ?, verified_at = datetime('now') WHERE id = ?").run(req.user.id, p.id);
    db.prepare("UPDATE subscriptions SET status = 'verified', updated_at = datetime('now') WHERE id = ?").run(p.subscription_id);
    if (andActivate) dates = activate(p.subscription_id, req.user.id);
  })();
  if (!andActivate) notify(p.user_id, { title: 'Payment verified', body: `${p.service_name}: activation is next.`, link: `/app#/subscriptions/${p.subscription_public_id}` });
  logActivity({ actor: req.user, action: andActivate ? 'payment.verified_and_activated' : 'payment.verified', entity: 'payment', entityId: p.public_id, detail: p.upi_txn_id });
  res.json({ payment: paymentView(paymentOr404(p.public_id)), activated: dates });
}));

adminCatalogRouter.post('/payments/:id/reject', wrap((req, res) => {
  const p = paymentOr404(req.params.id);
  if (!['pending', 'awaiting_payment'].includes(p.status)) throw conflict(`This payment is already ${p.status}.`);
  const reason = v.str(req.body.reason, 'Reason', { min: 5, max: 300 });
  tx(() => {
    db.prepare("UPDATE payments SET status = 'rejected', verified_by = ?, verified_at = datetime('now'), rejection_reason = ? WHERE id = ?").run(req.user.id, reason, p.id);
    db.prepare("UPDATE subscriptions SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(p.subscription_id);
  })();
  notify(p.user_id, { title: 'Payment could not be verified', body: `${p.service_name}: ${reason}`, link: `/app#/subscriptions/${p.subscription_public_id}` });
  logActivity({ actor: req.user, action: 'payment.rejected', entity: 'payment', entityId: p.public_id, detail: reason });
  res.json({ payment: paymentView(paymentOr404(p.public_id)) });
}));

/* ── Subscriptions & usage ──────────────────────────────────────────────── */

const subOr404 = (id) => {
  const row = db.prepare(`${SUB_SELECT} WHERE sub.public_id = ?`).get(id);
  if (!row) throw notFound('No such subscription.');
  return row;
};

adminCatalogRouter.get('/subscriptions', (req, res) => {
  const where = ["sub.status <> 'pending_payment'"];
  const args = [];
  if (req.query.status) { where.push('sub.status = ?'); args.push(req.query.status); }
  if (req.query.serviceId) { where.push('sub.service_id = ?'); args.push(req.query.serviceId); }
  if (req.query.q) {
    where.push('(sub.public_id LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR s.name LIKE ?)');
    const like = `%${req.query.q}%`;
    args.push(like, like, like, like);
  }
  const rows = db.prepare(`${SUB_SELECT} WHERE ${where.join(' AND ')} ORDER BY sub.created_at DESC LIMIT 300`).all(...args);
  const counts = Object.fromEntries(db.prepare("SELECT status, COUNT(*) AS n FROM subscriptions WHERE status <> 'pending_payment' GROUP BY status").all().map((r) => [r.status, r.n]));
  res.json({
    subscriptions: rows.map((r) => ({ ...memberSubscription(r), user: { id: r.user_id, name: r.user_name, email: r.user_email, publicId: r.user_public_id } })),
    counts,
  });
});

adminCatalogRouter.get('/subscriptions/:id', wrap((req, res) => {
  const row = subOr404(req.params.id);
  const payments = db.prepare(`${PAYMENT_SELECT} WHERE p.subscription_id = ? ORDER BY p.id DESC`).all(row.id);
  res.json({
    subscription: { ...memberSubscription(row, { withUsage: true }), user: { id: row.user_id, name: row.user_name, email: row.user_email, publicId: row.user_public_id } },
    payments: payments.map(paymentView),
  });
}));

adminCatalogRouter.post('/subscriptions/:id/activate', wrap((req, res) => {
  const row = subOr404(req.params.id);
  if (row.status !== 'verified') throw conflict('Only a verified payment can be activated.');
  const dates = activate(row.id, req.user.id);
  logActivity({ actor: req.user, action: 'subscription.activated', entity: 'subscription', entityId: row.public_id });
  res.json({ subscription: memberSubscription(subOr404(row.public_id)), activated: dates });
}));

adminCatalogRouter.post('/subscriptions/:id/cancel', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM subscriptions WHERE public_id = ?').get(req.params.id);
  if (!row) throw notFound('No such subscription.');
  cancelByAdmin(row, req.user, v.str(req.body.reason, 'Reason', { min: 3, max: 300 }));
  res.json({ subscription: memberSubscription(subOr404(row.public_id)) });
}));

adminCatalogRouter.get('/usage', (req, res) => {
  const args = [];
  let extra = '';
  if (req.query.q) {
    extra = ' AND (sub.public_id LIKE ? OR u.full_name LIKE ? OR s.name LIKE ?)';
    const like = `%${req.query.q}%`;
    args.push(like, like, like);
  }
  const rows = db.prepare(`${SUB_SELECT} WHERE sub.status = 'active'${extra} ORDER BY sub.end_date LIMIT 300`).all(...args);
  res.json({
    subscriptions: rows.map((r) => {
      const u = usageSummary(r);
      return { ...memberSubscription(r), user: { id: r.user_id, name: r.user_name }, usage: { allowed: u.allowed, used: u.used, remaining: u.remaining, unit: u.unit, percent: u.percent, totalUsed: u.totalUsed, cycleStart: u.cycleStart, cycleEnd: u.cycleEnd } };
    }),
  });
});

adminCatalogRouter.post('/subscriptions/:id/usage', wrap((req, res) => {
  const row = subOr404(req.params.id);
  const units = v.int(req.body.units, 'Units', { min: 1, max: 100, fallback: 1 });
  const usage = recordUsage(row, { units, note: v.str(req.body.note, 'Note', { required: false, max: 200 }), source: 'admin', by: req.user.id });
  logActivity({ actor: req.user, action: 'usage.recorded', entity: 'subscription', entityId: row.public_id, detail: String(units) });
  res.json({ usage });
}));
