import express from 'express';
import { db, logActivity, notify, tx } from '../db/index.js';
import { AGREEMENT_SELECT, agreementDocument, agreementView } from '../lib/agreement.js';
import { destroyUserSessions } from '../lib/auth.js';
import { thisMonth, today } from '../lib/dates.js';
import { badRequest, conflict, notFound, wrap } from '../lib/http.js';
import { agreementPublicId, verificationId } from '../lib/ids.js';
import { platformSettings, savePlatformSettings } from '../lib/platform.js';
import { monthlySummary, trend } from '../lib/revenue.js';
import { SUB_SELECT, expireDue, memberSubscription } from '../lib/subscriptions.js';
import * as v from '../lib/validate.js';
import { requireAdmin } from '../middleware/session.js';
import { APPLICATION_STATUS, applicationView, sendDoc } from './applications.js';
import { listerStanding } from './lister.js';
import { sessionUser } from './auth.js';

export const adminRouter = express.Router();
adminRouter.use(requireAdmin);
adminRouter.use((_req, _res, next) => { expireDue(); next(); });

const count = (sql, ...a) => db.prepare(sql).get(...a).n;

/* ── Dashboard ──────────────────────────────────────────────────────────── */

adminRouter.get('/dashboard', (req, res) => {
  const month = thisMonth();
  const t = today();
  const summary = monthlySummary(month);
  const allTime = db.prepare("SELECT COALESCE(SUM(final_amount), 0) AS gross FROM payments WHERE status = 'verified'").get().gross;
  const paidOut = count("SELECT COALESCE(SUM(payable), 0) AS n FROM settlements WHERE status = 'paid'");
  const owed = count("SELECT COALESCE(SUM(payable), 0) AS n FROM settlements WHERE status <> 'paid'");

  const pendingPayments = db.prepare(
    `SELECT p.public_id, p.final_amount, p.upi_txn_id, p.submitted_at, s.name AS service, u.full_name AS user
       FROM payments p JOIN services s ON s.id = p.service_id JOIN users u ON u.id = p.user_id
      WHERE p.status = 'pending' ORDER BY p.submitted_at LIMIT 6`,
  ).all();
  const pendingApps = db.prepare(
    "SELECT id, public_id, business_name, city, status, created_at FROM lister_applications WHERE status IN ('applied', 'under_review') ORDER BY created_at LIMIT 6",
  ).all();

  res.json({
    month,
    metrics: {
      totalUsers: count("SELECT COUNT(*) AS n FROM users WHERE role <> 'admin'"),
      activeUsers: count("SELECT COUNT(DISTINCT user_id) AS n FROM subscriptions WHERE status = 'active' AND end_date >= ?", t),
      totalServices: count('SELECT COUNT(*) AS n FROM services WHERE deleted_at IS NULL'),
      activeServices: count("SELECT COUNT(*) AS n FROM services WHERE status = 'active' AND deleted_at IS NULL"),
      totalSubscribers: count("SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active' AND end_date >= ?", t),
      monthlySubscriptions: count('SELECT COUNT(*) AS n FROM subscriptions WHERE activated_at IS NOT NULL AND substr(activated_at, 1, 7) = ?', month),
      pendingPayments: count("SELECT COUNT(*) AS n FROM payments WHERE status = 'pending'"),
      verifiedPayments: count("SELECT COUNT(*) AS n FROM payments WHERE status = 'verified'"),
      cancelledSubscriptions: count("SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'cancelled'"),
      totalRevenue: allTime,
      monthRevenue: summary.gross,
      listerPayouts: summary.listerPayable,
      commission: summary.commission,
      commissionPercent: platformSettings().commissionPercent,
      payoutsPaid: paidOut,
      payoutsOwed: owed,
      listers: count("SELECT COUNT(*) AS n FROM users WHERE role = 'lister'"),
      pendingApplications: count("SELECT COUNT(*) AS n FROM lister_applications WHERE status IN ('applied', 'under_review')"),
      pendingAgreements: count("SELECT COUNT(*) AS n FROM agreements WHERE status = 'pending_admin'"),
      pendingChanges: count("SELECT COUNT(*) AS n FROM change_requests WHERE status = 'pending'"),
      servicesInReview: count("SELECT COUNT(*) AS n FROM services WHERE status = 'pending_review' AND deleted_at IS NULL"),
    },
    trend: trend(6),
    pendingPayments: pendingPayments.map((p) => ({ id: p.public_id, amount: p.final_amount, upiTxnId: p.upi_txn_id, submittedAt: p.submitted_at, service: p.service, user: p.user })),
    pendingApplications: pendingApps.map((a) => ({ id: a.id, publicId: a.public_id, businessName: a.business_name, city: a.city, status: a.status, createdAt: a.created_at })),
    topServices: summary.services.slice(0, 5).map((s) => ({ service: s.service, gross: s.gross, payments: s.payments })),
  });
});

/* ── Users ──────────────────────────────────────────────────────────────── */

function adminUser(u) {
  return {
    ...sessionUser(u),
    statusReason: u.status_reason,
    address: u.address,
    upiId: u.upi_id,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
    activeSubscriptions: u.active_subs ?? undefined,
    totalSpent: u.total_spent ?? undefined,
  };
}

adminRouter.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  const where = ['1 = 1'];
  const args = [];
  if (q) {
    where.push(`(u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.public_id LIKE ? OR CAST(u.id AS TEXT) = ?
                 OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.public_id LIKE ?))`);
    const like = `%${q}%`;
    args.push(like, like, like, like, q, like);
  }
  if (req.query.status) { where.push('u.status = ?'); args.push(req.query.status); }
  if (req.query.role) { where.push('u.role = ?'); args.push(req.query.role); }
  const rows = db.prepare(
    `SELECT u.*,
            (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.end_date >= ?) AS active_subs,
            (SELECT COALESCE(SUM(final_amount), 0) FROM payments p WHERE p.user_id = u.id AND p.status = 'verified') AS total_spent
       FROM users u WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC LIMIT 200`,
  ).all(today(), ...args);
  res.json({ users: rows.map(adminUser), total: rows.length });
});

const userOr404 = (id) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw notFound('No such user.');
  return u;
};

adminRouter.get('/users/:id', wrap((req, res) => {
  const u = userOr404(req.params.id);
  const subs = db.prepare(`${SUB_SELECT} WHERE sub.user_id = ? ORDER BY sub.created_at DESC`).all(u.id).map((r) => memberSubscription(r));
  const payments = db.prepare(
    `SELECT p.*, s.name AS service, v.full_name AS verifier FROM payments p JOIN services s ON s.id = p.service_id
       LEFT JOIN users v ON v.id = p.verified_by WHERE p.user_id = ? ORDER BY p.id DESC`,
  ).all(u.id);
  const activity = db.prepare('SELECT action, entity, entity_id, detail, created_at, actor_name FROM activity_log WHERE actor_id = ? OR (entity = ? AND entity_id = ?) ORDER BY id DESC LIMIT 50')
    .all(u.id, 'user', String(u.id));
  const app = db.prepare('SELECT * FROM lister_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(u.id);
  res.json({
    user: { ...adminUser(u), city: u.city, preferredArea: u.preferred_area, paymentNote: u.payment_note, referredBy: u.referred_by },
    subscriptions: subs,
    payments: payments.map((p) => ({
      id: p.public_id, service: p.service, amount: p.amount, discount: p.discount, finalAmount: p.final_amount, couponCode: p.coupon_code,
      upiTxnId: p.upi_txn_id, status: p.status, createdAt: p.created_at, verifiedAt: p.verified_at, verifier: p.verifier, rejectionReason: p.rejection_reason,
    })),
    activity: activity.map((a) => ({ action: a.action, entity: a.entity, entityId: a.entity_id, detail: a.detail, at: a.created_at, actor: a.actor_name })),
    application: app ? { id: app.id, publicId: app.public_id, status: app.status, businessName: app.business_name } : null,
    lister: u.role === 'lister' ? listerStanding(u.id) : null,
  });
}));

adminRouter.post('/users/:id/status', wrap((req, res) => {
  const u = userOr404(req.params.id);
  if (u.id === req.user.id) throw badRequest('You cannot change the status of your own account.');
  if (u.role === 'admin') throw badRequest('Admin accounts are managed separately.');
  const status = v.oneOf(req.body.status, 'Status', ['active', 'inactive', 'suspended', 'banned']);
  const reason = v.str(req.body.reason, 'Reason', { required: status !== 'active', max: 300 });
  db.prepare("UPDATE users SET status = ?, status_reason = ?, updated_at = datetime('now') WHERE id = ?").run(status, status === 'active' ? null : reason, u.id);
  if (status !== 'active') destroyUserSessions(u.id);
  // A banned or suspended lister's services come off the catalogue with them.
  if (u.role === 'lister' && ['suspended', 'banned'].includes(status)) {
    db.prepare("UPDATE services SET status = 'inactive', updated_at = datetime('now') WHERE lister_id = ? AND status = 'active'").run(u.id);
  }
  logActivity({ actor: req.user, action: `user.${status}`, entity: 'user', entityId: u.id, detail: reason });
  res.json({ user: adminUser(userOr404(u.id)) });
}));

adminRouter.post('/users/:id/role', wrap((req, res) => {
  const u = userOr404(req.params.id);
  if (u.role === 'admin') throw badRequest('Admin roles are not changed here.');
  const role = v.oneOf(req.body.role, 'Role', ['user', 'lister']);
  if (role === u.role) return res.json({ user: adminUser(u) });
  tx(() => {
    db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(role, u.id);
    if (role === 'user') {
      db.prepare("UPDATE services SET status = 'inactive', updated_at = datetime('now') WHERE lister_id = ? AND status = 'active'").run(u.id);
      db.prepare("UPDATE agreements SET status = 'terminated', terminated_at = datetime('now') WHERE lister_id = ? AND status <> 'terminated'").run(u.id);
    } else {
      ensureAgreement(u.id, req.user);
    }
  })();
  destroyUserSessions(u.id); // their dashboard changes; make them sign in again
  notify(u.id, { title: role === 'lister' ? 'You are now a Subtize.ai lister' : 'Your lister access was removed', link: role === 'lister' ? '/lister' : '/app' });
  logActivity({ actor: req.user, action: role === 'lister' ? 'user.lister_assigned' : 'user.lister_removed', entity: 'user', entityId: u.id });
  res.json({ user: adminUser(userOr404(u.id)) });
}));

adminRouter.post('/users/:id/subscriptions/:subId/cancel', wrap((req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE public_id = ? AND user_id = ?').get(req.params.subId, req.params.id);
  if (!sub) throw notFound('No such subscription for this user.');
  cancelByAdmin(sub, req.user, v.str(req.body.reason, 'Reason', { max: 300 }));
  res.json({ ok: true });
}));

export function cancelByAdmin(sub, admin, reason) {
  if (['cancelled', 'expired', 'rejected'].includes(sub.status)) throw conflict('This subscription has already ended.');
  tx(() => {
    db.prepare(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now'), cancelled_by = ?, cancel_reason = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(admin.id, `Cancelled by Subtize.ai: ${reason}`, sub.id);
    db.prepare("UPDATE payments SET status = 'rejected', rejection_reason = ? WHERE subscription_id = ? AND status IN ('awaiting_payment', 'pending')").run(`Subscription cancelled: ${reason}`, sub.id);
  })();
  notify(sub.user_id, { title: 'A subscription was cancelled', body: `${sub.public_id}: ${reason}`, link: `/app#/subscriptions/${sub.public_id}` });
  logActivity({ actor: admin, action: 'subscription.cancelled_by_admin', entity: 'subscription', entityId: sub.public_id, detail: reason });
}

/* ── Listers ────────────────────────────────────────────────────────────── */

adminRouter.get('/listers', (req, res) => {
  const month = thisMonth();
  const summary = monthlySummary(month);
  const byLister = new Map();
  for (const s of summary.services) {
    if (!s.listerId) continue;
    const t = byLister.get(s.listerId) || { gross: 0, payable: 0 };
    t.gross += s.gross; t.payable += s.payable;
    byLister.set(s.listerId, t);
  }
  const q = `%${String(req.query.q || '').trim()}%`;
  const rows = db.prepare(
    `SELECT u.*, la.business_name, la.city AS business_city, la.verification_id, la.status AS app_status,
            (SELECT COUNT(*) FROM services s WHERE s.lister_id = u.id AND s.deleted_at IS NULL) AS services,
            (SELECT COUNT(*) FROM subscriptions sub JOIN services s ON s.id = sub.service_id WHERE s.lister_id = u.id AND sub.status = 'active' AND sub.end_date >= ?) AS subscribers,
            (SELECT status FROM agreements a WHERE a.lister_id = u.id ORDER BY a.id DESC LIMIT 1) AS agreement_status
       FROM users u LEFT JOIN lister_applications la ON la.id = (SELECT id FROM lister_applications WHERE user_id = u.id ORDER BY id DESC LIMIT 1)
      WHERE u.role = 'lister' AND (u.full_name LIKE ? OR u.email LIKE ? OR COALESCE(la.business_name, '') LIKE ? OR COALESCE(la.verification_id, '') LIKE ?)
      ORDER BY u.created_at DESC`,
  ).all(today(), q, q, q, q);
  res.json({
    month,
    listers: rows.map((r) => ({
      ...adminUser(r), businessName: r.business_name, businessCity: r.business_city, verificationId: r.verification_id,
      applicationStatus: r.app_status, agreementStatus: r.agreement_status, services: r.services, subscribers: r.subscribers,
      monthGross: byLister.get(r.id)?.gross || 0, monthPayable: byLister.get(r.id)?.payable || 0,
    })),
  });
});

/* ── Applications ───────────────────────────────────────────────────────── */

const appOr404 = (id) => {
  const row = db.prepare('SELECT * FROM lister_applications WHERE id = ?').get(id);
  if (!row) throw notFound('No such application.');
  return row;
};

adminRouter.get('/applications', (req, res) => {
  const where = ['1 = 1'];
  const args = [];
  if (req.query.status) { where.push('status = ?'); args.push(req.query.status); }
  if (req.query.q) {
    where.push('(business_name LIKE ? OR applicant_name LIKE ? OR email LIKE ? OR public_id LIKE ?)');
    const like = `%${req.query.q}%`;
    args.push(like, like, like, like);
  }
  const rows = db.prepare(`SELECT * FROM lister_applications WHERE ${where.join(' AND ')} ORDER BY created_at DESC`).all(...args);
  const counts = Object.fromEntries(Object.keys(APPLICATION_STATUS).map((s) => [s, 0]));
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM lister_applications GROUP BY status').all()) counts[r.status] = r.n;
  res.json({ applications: rows.map((r) => applicationView(r)), counts });
});

adminRouter.get('/applications/:id', wrap((req, res) => {
  const row = appOr404(req.params.id);
  const reveal = req.query.reveal === '1';
  if (reveal) logActivity({ actor: req.user, action: 'application.sensitive_viewed', entity: 'application', entityId: row.id });
  const agreement = db.prepare(`${AGREEMENT_SELECT} WHERE a.application_id = ? ORDER BY a.id DESC LIMIT 1`).get(row.id);
  const history = db.prepare("SELECT action, detail, actor_name, created_at FROM activity_log WHERE entity = 'application' AND entity_id = ? ORDER BY id DESC").all(String(row.id));
  res.json({
    application: applicationView(row, { reveal }),
    agreement: agreement ? agreementView(agreement, { includeSignature: false }) : null,
    history: history.map((h) => ({ action: h.action, detail: h.detail, actor: h.actor_name, at: h.created_at })),
  });
}));

adminRouter.get('/applications/:id/documents/:docId', (req, res, next) => {
  const doc = db.prepare('SELECT * FROM application_documents WHERE id = ? AND application_id = ?').get(req.params.docId, req.params.id);
  if (!doc) return next(notFound('Document not found.'));
  logActivity({ actor: req.user, action: 'application.document_viewed', entity: 'application', entityId: req.params.id, detail: doc.kind });
  sendDoc(res, doc);
});

function setAppStatus(row, admin, status, { note = null, correction = null } = {}) {
  db.prepare(
    `UPDATE lister_applications SET status = ?, admin_note = COALESCE(?, admin_note), correction_note = ?, reviewed_by = ?,
            reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  ).run(status, note, correction, admin.id, row.id);
  logActivity({ actor: admin, action: `application.${status}`, entity: 'application', entityId: row.id, detail: note || correction });
}

adminRouter.post('/applications/:id/review', wrap((req, res) => {
  const row = appOr404(req.params.id);
  if (!['applied', 'verification_required'].includes(row.status)) throw conflict(`Application is ${APPLICATION_STATUS[row.status].toLowerCase()}.`);
  setAppStatus(row, req.user, 'under_review', { correction: row.correction_note });
  notify(row.user_id, { title: 'Your lister application is under review', link: '/become-lister' });
  res.json({ application: applicationView(appOr404(row.id)) });
}));

adminRouter.post('/applications/:id/verify', wrap((req, res) => {
  const row = appOr404(req.params.id);
  const docs = req.body.documentsVerified !== undefined ? (v.bool(req.body.documentsVerified) ? 1 : 0) : row.documents_verified;
  const addr = req.body.addressVerified !== undefined ? (v.bool(req.body.addressVerified) ? 1 : 0) : row.address_verified;
  db.prepare("UPDATE lister_applications SET documents_verified = ?, address_verified = ?, updated_at = datetime('now') WHERE id = ?").run(docs, addr, row.id);
  logActivity({ actor: req.user, action: 'application.checks_updated', entity: 'application', entityId: row.id, detail: `documents ${docs ? 'ok' : 'pending'}, address ${addr ? 'ok' : 'pending'}` });
  res.json({ application: applicationView(appOr404(row.id)) });
}));

adminRouter.post('/applications/:id/request-correction', wrap((req, res) => {
  const row = appOr404(req.params.id);
  if (['approved', 'rejected'].includes(row.status)) throw conflict('This application is already decided.');
  const note = v.str(req.body.note, 'What needs correcting', { min: 5, max: 1000 });
  setAppStatus(row, req.user, 'verification_required', { correction: note });
  notify(row.user_id, { title: 'Your lister application needs a correction', body: note, link: '/become-lister' });
  res.json({ application: applicationView(appOr404(row.id)) });
}));

/** Makes sure an approved lister has an agreement waiting to be signed. */
function ensureAgreement(listerId, admin) {
  const existing = db.prepare("SELECT * FROM agreements WHERE lister_id = ? AND status <> 'terminated' ORDER BY id DESC LIMIT 1").get(listerId);
  if (existing) return existing;
  const app = db.prepare("SELECT * FROM lister_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(listerId);
  let vid = app?.verification_id;
  if (!vid) {
    vid = verificationId();
    if (app) db.prepare('UPDATE lister_applications SET verification_id = ? WHERE id = ?').run(vid, app.id);
  }
  const n = db.prepare('SELECT COUNT(*) AS n FROM agreements').get().n + 1;
  db.prepare('INSERT INTO agreements (public_id, lister_id, application_id, verification_id, commission_percent) VALUES (?, ?, ?, ?, ?)')
    .run(agreementPublicId(n), listerId, app?.id ?? null, vid, platformSettings().commissionPercent);
  logActivity({ actor: admin, action: 'agreement.issued', entity: 'user', entityId: listerId });
  return db.prepare('SELECT * FROM agreements WHERE lister_id = ? ORDER BY id DESC LIMIT 1').get(listerId);
}

adminRouter.post('/applications/:id/approve', wrap((req, res) => {
  const row = appOr404(req.params.id);
  if (row.status === 'approved') throw conflict('Already approved.');
  if (row.status === 'rejected') throw conflict('This application was rejected. Ask the applicant to apply again.');
  if (!row.documents_verified || !row.address_verified) throw badRequest('Mark the documents and the address as verified before approving.');
  const user = userOr404(row.user_id);
  if (user.status !== 'active') throw badRequest(`The applicant's account is ${user.status}.`);
  const note = v.str(req.body.note, 'Note', { required: false, max: 500 });
  const vid = row.verification_id || verificationId();
  tx(() => {
    db.prepare('UPDATE lister_applications SET verification_id = ? WHERE id = ?').run(vid, row.id);
    setAppStatus(row, req.user, 'approved', { note });
    if (user.role === 'user') db.prepare("UPDATE users SET role = 'lister', updated_at = datetime('now') WHERE id = ?").run(user.id);
    ensureAgreement(user.id, req.user);
  })();
  destroyUserSessions(user.id);
  notify(user.id, { title: 'You are approved as a Subtize.ai lister', body: `Verification ID ${vid}. Sign the Lister Agreement to start publishing.`, link: '/lister#/agreement' });
  res.json({ application: applicationView(appOr404(row.id)) });
}));

adminRouter.post('/applications/:id/reject', wrap((req, res) => {
  const row = appOr404(req.params.id);
  if (row.status === 'approved') throw conflict('Approved applications are suspended, not rejected.');
  const note = v.str(req.body.note, 'Reason', { min: 5, max: 1000 });
  setAppStatus(row, req.user, 'rejected', { note });
  notify(row.user_id, { title: 'Your lister application was not approved', body: note, link: '/become-lister' });
  res.json({ application: applicationView(appOr404(row.id)) });
}));

adminRouter.post('/applications/:id/suspend', wrap((req, res) => {
  const row = appOr404(req.params.id);
  const note = v.str(req.body.note, 'Reason', { min: 5, max: 1000 });
  tx(() => {
    setAppStatus(row, req.user, 'suspended', { note });
    db.prepare("UPDATE services SET status = 'inactive', updated_at = datetime('now') WHERE lister_id = ? AND status = 'active'").run(row.user_id);
  })();
  notify(row.user_id, { title: 'Your lister account is suspended', body: note, link: '/lister' });
  res.json({ application: applicationView(appOr404(row.id)) });
}));

adminRouter.post('/applications/:id/reinstate', wrap((req, res) => {
  const row = appOr404(req.params.id);
  if (row.status !== 'suspended') throw conflict('Only a suspended lister can be reinstated.');
  setAppStatus(row, req.user, 'approved', { note: 'Reinstated' });
  notify(row.user_id, { title: 'Your lister account is reinstated', link: '/lister' });
  res.json({ application: applicationView(appOr404(row.id)) });
}));

/* ── Agreements ─────────────────────────────────────────────────────────── */

adminRouter.get('/agreements', (req, res) => {
  const args = [];
  let where = '1 = 1';
  if (req.query.status) { where = 'a.status = ?'; args.push(req.query.status); }
  const rows = db.prepare(`${AGREEMENT_SELECT} WHERE ${where} ORDER BY a.id DESC`).all(...args);
  res.json({ agreements: rows.map((r) => agreementView(r, { includeSignature: false })) });
});

const agreementOr404 = (id) => {
  const row = db.prepare(`${AGREEMENT_SELECT} WHERE a.id = ?`).get(id);
  if (!row) throw notFound('No such agreement.');
  return row;
};

adminRouter.get('/agreements/:id', wrap((req, res) => res.json({ agreement: agreementView(agreementOr404(req.params.id)) })));

adminRouter.post('/agreements/:id/countersign', wrap((req, res) => {
  const row = agreementOr404(req.params.id);
  if (row.status !== 'pending_admin') throw conflict(row.status === 'pending_lister' ? 'The lister has not signed yet.' : 'This agreement is not waiting on Subtize.ai.');
  const name = v.str(req.body.signedName, 'Signatory name', { min: 2, max: 120 });
  db.prepare("UPDATE agreements SET status = 'active', admin_signed_name = ?, admin_signed_by = ?, admin_signed_at = datetime('now') WHERE id = ?")
    .run(name, req.user.id, row.id);
  notify(row.lister_id, { title: 'Your Lister Agreement is active', body: 'You can now add services for review.', link: '/lister#/services' });
  logActivity({ actor: req.user, action: 'agreement.countersigned', entity: 'agreement', entityId: row.public_id });
  res.json({ agreement: agreementView(agreementOr404(row.id)) });
}));

adminRouter.post('/agreements/:id/terminate', wrap((req, res) => {
  const row = agreementOr404(req.params.id);
  if (row.status === 'terminated') throw conflict('Already terminated.');
  const reason = v.str(req.body.reason, 'Reason', { min: 5, max: 500 });
  tx(() => {
    db.prepare("UPDATE agreements SET status = 'terminated', terminated_at = datetime('now') WHERE id = ?").run(row.id);
    db.prepare("UPDATE services SET status = 'inactive', updated_at = datetime('now') WHERE lister_id = ? AND status = 'active'").run(row.lister_id);
  })();
  notify(row.lister_id, { title: 'Your Lister Agreement was terminated', body: reason, link: '/lister#/agreement' });
  logActivity({ actor: req.user, action: 'agreement.terminated', entity: 'agreement', entityId: row.public_id, detail: reason });
  res.json({ agreement: agreementView(agreementOr404(row.id)) });
}));

/** Reissues a fresh agreement after a termination, e.g. on renegotiation. */
adminRouter.post('/listers/:id/agreement', wrap((req, res) => {
  const u = userOr404(req.params.id);
  if (u.role !== 'lister') throw badRequest('That user is not a lister.');
  const a = ensureAgreement(u.id, req.user);
  res.status(201).json({ agreement: agreementView(agreementOr404(a.id)) });
}));

adminRouter.get('/agreements/:id/download', (req, res, next) => {
  try {
    const row = agreementOr404(req.params.id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Subtize-Lister-Agreement-${row.public_id}.html"`);
    res.send(agreementDocument({ ...agreementView(row), listerSignedIp: row.lister_signed_ip }));
  } catch (e) { next(e); }
});

/* ── Settings, categories, activity, outbox ─────────────────────────────── */

adminRouter.get('/settings', (_req, res) => res.json({ settings: platformSettings() }));

adminRouter.put('/settings', wrap((req, res) => {
  const b = req.body;
  const patch = {
    upiId: b.upiId !== undefined ? v.vpa(b.upiId, 'Official UPI ID') : undefined,
    payee: b.payee !== undefined ? v.str(b.payee, 'Payee name', { max: 80 }) : undefined,
    commissionPercent: b.commissionPercent !== undefined ? v.int(b.commissionPercent, 'Commission', { min: 0, max: 60 }) : undefined,
    supportEmail: b.supportEmail !== undefined ? v.email(b.supportEmail, 'Support email') : undefined,
    supportPhone: b.supportPhone !== undefined ? v.str(b.supportPhone, 'Support phone', { max: 30 }) : undefined,
    defaultCity: b.defaultCity !== undefined ? v.str(b.defaultCity, 'Default city', { max: 60 }) : undefined,
    expiringSoonDays: b.expiringSoonDays !== undefined ? v.int(b.expiringSoonDays, 'Expiring-soon window', { min: 1, max: 30 }) : undefined,
  };
  const settings = savePlatformSettings(patch);
  logActivity({ actor: req.user, action: 'settings.updated', entity: 'settings', detail: Object.keys(patch).filter((k) => patch[k] !== undefined).join(', ') });
  res.json({ settings });
}));

adminRouter.get('/categories', (_req, res) => {
  res.json({ categories: db.prepare('SELECT c.*, (SELECT COUNT(*) FROM services s WHERE s.category_id = c.id AND s.deleted_at IS NULL) AS services FROM categories c ORDER BY sort, name').all() });
});

adminRouter.post('/categories', wrap((req, res) => {
  const name = v.str(req.body.name, 'Category name', { min: 2, max: 60 });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug)) throw conflict('That category exists.');
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM categories').get().n;
  db.prepare('INSERT INTO categories (slug, name, icon, sort) VALUES (?, ?, ?, ?)').run(slug, name, v.str(req.body.icon, 'Icon', { required: false, max: 30 }) || 'grid', sort);
  res.status(201).json({ category: db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug) });
}));

adminRouter.post('/locations', wrap((req, res) => {
  const area = v.str(req.body.area, 'Area', { max: 80 });
  const city = v.str(req.body.city, 'City', { max: 60 });
  const lat = v.num(req.body.lat, 'Latitude', { min: -90, max: 90 });
  const lng = v.num(req.body.lng, 'Longitude', { min: -180, max: 180 });
  db.prepare('INSERT INTO locations (area, city, lat, lng) VALUES (?, ?, ?, ?) ON CONFLICT (area, city) DO UPDATE SET lat = excluded.lat, lng = excluded.lng')
    .run(area, city, lat, lng);
  res.status(201).json({ ok: true });
}));

adminRouter.get('/activity', (req, res) => {
  const rows = db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(Math.min(500, Number(req.query.limit) || 150));
  res.json({ activity: rows.map((a) => ({ id: a.id, actor: a.actor_name, action: a.action, entity: a.entity, entityId: a.entity_id, detail: a.detail, at: a.created_at })) });
});

adminRouter.get('/outbox', (_req, res) => {
  const rows = db.prepare('SELECT * FROM mail_outbox ORDER BY id DESC LIMIT 100').all();
  res.json({ messages: rows.map((m) => ({ id: m.id, to: m.to_email, subject: m.subject, body: m.body_text, status: m.status, error: m.error, at: m.created_at })) });
});

adminRouter.get('/notifications', (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(req.user.id);
  res.json({
    notifications: rows.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, read: Boolean(n.read_at), createdAt: n.created_at })),
    unread: rows.filter((n) => !n.read_at).length,
  });
});

adminRouter.post('/notifications/read', (req, res) => {
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
  res.json({ ok: true });
});
