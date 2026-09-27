import express from 'express';
import { db, logActivity, notify } from '../db/index.js';
import { monthBounds, thisMonth } from '../lib/dates.js';
import { conflict, notFound, wrap } from '../lib/http.js';
import { toRupees } from '../lib/money.js';
import { SETTLEMENT_SELECT, generateSettlements, listerTotals, monthlySummary, settlementView, trend } from '../lib/revenue.js';
import * as v from '../lib/validate.js';
import { requireAdmin } from '../middleware/session.js';

export const adminFinanceRouter = express.Router();
adminFinanceRouter.use(requireAdmin);

const monthOf = (q) => (/^\d{4}-\d{2}$/.test(q || '') ? q : thisMonth());

adminFinanceRouter.get('/revenue', (req, res) => {
  const month = monthOf(req.query.month);
  const s = monthlySummary(month);
  res.json({ ...s, listers: listerTotals(month), trend: trend(12) });
});

adminFinanceRouter.get('/settlements', (req, res) => {
  const args = [];
  let where = '1 = 1';
  if (req.query.month) { where = 'st.month = ?'; args.push(monthOf(req.query.month)); }
  const rows = db.prepare(`${SETTLEMENT_SELECT} WHERE ${where} ORDER BY st.month DESC, st.payable DESC`).all(...args);
  res.json({ settlements: rows.map(settlementView) });
});

adminFinanceRouter.post('/settlements/generate', wrap((req, res) => {
  const month = monthOf(req.body.month);
  const n = generateSettlements(month, req.user.id);
  logActivity({ actor: req.user, action: 'settlements.generated', entity: 'settlement', entityId: month, detail: `${n} lister(s)` });
  const rows = db.prepare(`${SETTLEMENT_SELECT} WHERE st.month = ? ORDER BY st.payable DESC`).all(month);
  res.json({ month, generated: n, settlements: rows.map(settlementView) });
}));

adminFinanceRouter.post('/settlements/:id/status', wrap((req, res) => {
  const st = db.prepare('SELECT * FROM settlements WHERE id = ?').get(req.params.id);
  if (!st) throw notFound('No such settlement.');
  if (st.status === 'paid') throw conflict('This settlement is already marked paid.');
  const status = v.oneOf(req.body.status, 'Status', ['pending', 'processing', 'paid', 'on_hold']);
  const reference = v.str(req.body.reference, 'Payout reference', { required: status === 'paid', max: 80 });
  db.prepare(
    `UPDATE settlements SET status = ?, reference = COALESCE(?, reference), paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END,
            updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(status, reference, status, req.user.id, st.id);
  notify(st.lister_id, {
    title: status === 'paid' ? `Settlement for ${st.month} paid` : `Settlement for ${st.month}: ${status.replace('_', ' ')}`,
    body: status === 'paid' ? `₹${toRupees(st.payable).toLocaleString('en-IN')} · ref ${reference}` : null,
    link: '/lister#/settlements',
  });
  logActivity({ actor: req.user, action: `settlement.${status}`, entity: 'settlement', entityId: st.id, detail: reference });
  res.json({ settlement: settlementView(db.prepare(`${SETTLEMENT_SELECT} WHERE st.id = ?`).get(st.id)) });
}));

/** Everything an accountant asks for at month end, in one response. */
function monthlyReport(month) {
  const { start, end } = monthBounds(month);
  const s = monthlySummary(month);
  const q = (sql, ...a) => db.prepare(sql).get(...a).n;
  return {
    month,
    period: { start, end },
    revenue: { gross: s.gross, commission: s.commission, listerPayable: s.listerPayable, discounts: s.discounts, payments: s.payments },
    subscriptions: {
      activated: q('SELECT COUNT(*) AS n FROM subscriptions WHERE activated_at IS NOT NULL AND substr(activated_at, 1, 7) = ?', month),
      cancelled: q("SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'cancelled' AND substr(cancelled_at, 1, 7) = ?", month),
      expired: q("SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'expired' AND end_date BETWEEN ? AND ?", start, end),
      rejectedPayments: q("SELECT COUNT(*) AS n FROM payments WHERE status = 'rejected' AND substr(verified_at, 1, 7) = ?", month),
    },
    users: {
      newUsers: q("SELECT COUNT(*) AS n FROM users WHERE role <> 'admin' AND substr(created_at, 1, 7) = ?", month),
      newListers: q("SELECT COUNT(*) AS n FROM lister_applications WHERE status = 'approved' AND substr(reviewed_at, 1, 7) = ?", month),
    },
    services: s.services,
    listers: listerTotals(month),
  };
}

adminFinanceRouter.get('/reports/monthly', (req, res) => res.json({ report: monthlyReport(monthOf(req.query.month)) }));

const csvCell = (x) => {
  const s = String(x ?? '');
  // Leading =,+,-,@ would run as a formula in Excel; prefix them.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');
const rupees = (p) => toRupees(p).toFixed(2);

adminFinanceRouter.get('/reports/monthly.csv', (req, res) => {
  const r = monthlyReport(monthOf(req.query.month));
  const lines = [
    ['Subtize.ai monthly financial report', r.month],
    [],
    ['Gross subscriptions (INR)', rupees(r.revenue.gross)],
    [`Subtize.ai commission (INR)`, rupees(r.revenue.commission)],
    ['Lister settlements (INR)', rupees(r.revenue.listerPayable)],
    ['Coupon discounts given (INR)', rupees(r.revenue.discounts)],
    ['Verified payments', r.revenue.payments],
    [],
    ['Service ID', 'Service', 'Lister', 'Business', 'Payments', 'Gross (INR)', 'Commission %', 'Commission (INR)', 'Lister payable (INR)'],
    ...r.services.map((s) => [s.servicePublicId, s.service, s.listerName || 'Subtize.ai direct', s.businessName || '', s.payments, rupees(s.gross), s.percent, rupees(s.commission), rupees(s.payable)]),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="subtize-report-${r.month}.csv"`);
  res.send(`﻿${csv(lines)}\n`);
});

adminFinanceRouter.get('/reports/payments.csv', (req, res) => {
  const month = monthOf(req.query.month);
  const rows = db.prepare(
    `SELECT p.*, s.name AS service, u.full_name AS user, u.email, sub.public_id AS sub_id, vb.full_name AS verifier
       FROM payments p JOIN services s ON s.id = p.service_id JOIN users u ON u.id = p.user_id
       JOIN subscriptions sub ON sub.id = p.subscription_id LEFT JOIN users vb ON vb.id = p.verified_by
      WHERE substr(p.created_at, 1, 7) = ? OR substr(p.verified_at, 1, 7) = ? ORDER BY p.id`,
  ).all(month, month);
  const lines = [
    ['Payment ID', 'Subscription ID', 'User', 'Email', 'Service', 'Amount', 'Coupon', 'Discount', 'Final amount', 'UPI transaction ID', 'Payee VPA', 'Created', 'Status', 'Verified at', 'Verified by'],
    ...rows.map((p) => [p.public_id, p.sub_id, p.user, p.email, p.service, rupees(p.amount), p.coupon_code || '', rupees(p.discount), rupees(p.final_amount), p.upi_txn_id || '', p.payee_vpa, p.created_at, p.status, p.verified_at || '', p.verifier || '']),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="subtize-payments-${month}.csv"`);
  res.send(`﻿${csv(lines)}\n`);
});
