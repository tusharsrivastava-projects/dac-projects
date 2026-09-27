import { db } from '../db/index.js';
import { addMonths, monthBounds, thisMonth } from './dates.js';
import { platformSettings } from './platform.js';
import { splitRevenue } from './money.js';

/**
 * Revenue lands in the month its payment was verified. Commission comes from
 * the lister's active agreement when there is one (it is what they signed),
 * otherwise the platform default.
 */
function commissionFor(listerId) {
  if (!listerId) return platformSettings().commissionPercent;
  const a = db.prepare(
    "SELECT commission_percent FROM agreements WHERE lister_id = ? AND status IN ('active', 'terminated') ORDER BY (status = 'active') DESC, id DESC LIMIT 1",
  ).get(listerId);
  return a?.commission_percent ?? platformSettings().commissionPercent;
}

/** Per-service rows for one month. */
export function monthlyByService(month = thisMonth(), { listerId = null } = {}) {
  const { start, end } = monthBounds(month);
  const rows = db.prepare(
    `SELECT s.id AS service_id, s.public_id, s.name, s.lister_id, u.full_name AS lister_name,
            (SELECT business_name FROM lister_applications la WHERE la.user_id = s.lister_id AND la.status = 'approved' ORDER BY la.id DESC LIMIT 1) AS business_name,
            COUNT(p.id) AS payments, COALESCE(SUM(p.final_amount), 0) AS gross, COALESCE(SUM(p.discount), 0) AS discounts
       FROM payments p JOIN services s ON s.id = p.service_id LEFT JOIN users u ON u.id = s.lister_id
      WHERE p.status = 'verified' AND substr(p.verified_at, 1, 10) BETWEEN ? AND ?
        ${listerId ? 'AND s.lister_id = ?' : ''}
      GROUP BY s.id ORDER BY gross DESC`,
  ).all(...[start, end, ...(listerId ? [listerId] : [])]);
  return rows.map((r) => {
    const pct = commissionFor(r.lister_id);
    const split = splitRevenue(r.gross, pct);
    return {
      serviceId: r.service_id, servicePublicId: r.public_id, service: r.name,
      listerId: r.lister_id, listerName: r.lister_name, businessName: r.business_name,
      payments: r.payments, discounts: r.discounts, ...split,
    };
  });
}

export function monthlySummary(month = thisMonth(), opts = {}) {
  const rows = monthlyByService(month, opts);
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  // Services with no lister are run by the platform itself; all of it is platform income.
  const listed = rows.filter((r) => r.listerId);
  return {
    month,
    gross: sum('gross'),
    commission: sum('commission') + rows.filter((r) => !r.listerId).reduce((n, r) => n + r.payable, 0),
    listerPayable: listed.reduce((n, r) => n + r.payable, 0),
    payments: sum('payments'),
    discounts: sum('discounts'),
    services: rows,
  };
}

/** Last n months, oldest first. */
export function trend(n = 6, opts = {}) {
  const now = `${thisMonth()}-01`;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = addMonths(now, -i).slice(0, 7);
    const s = monthlySummary(m, opts);
    out.push({ month: m, gross: s.gross, commission: s.commission, payable: opts.listerId ? s.listerPayable : s.listerPayable, payments: s.payments });
  }
  return out;
}

/** Per-lister totals for a month, the basis for settlements. */
export function listerTotals(month) {
  const map = new Map();
  for (const r of monthlyByService(month)) {
    if (!r.listerId) continue;
    const t = map.get(r.listerId) || { listerId: r.listerId, listerName: r.listerName, businessName: r.businessName, gross: 0, commission: 0, payable: 0, payments: 0, percent: r.percent };
    t.gross += r.gross; t.commission += r.commission; t.payable += r.payable; t.payments += r.payments;
    map.set(r.listerId, t);
  }
  return [...map.values()];
}

/** Creates or refreshes pending settlements for a month. Paid rows are never touched. */
export function generateSettlements(month, adminId) {
  const totals = listerTotals(month);
  const upsert = db.prepare(
    `INSERT INTO settlements (lister_id, month, gross, commission, payable, commission_percent, payments_count, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (lister_id, month) DO UPDATE SET
       gross = excluded.gross, commission = excluded.commission, payable = excluded.payable,
       commission_percent = excluded.commission_percent, payments_count = excluded.payments_count,
       updated_by = excluded.updated_by, updated_at = datetime('now')
     WHERE settlements.status <> 'paid'`,
  );
  db.transaction(() => {
    for (const t of totals) upsert.run(t.listerId, month, t.gross, t.commission, t.payable, t.percent, t.payments, adminId);
  })();
  return totals.length;
}

export function settlementView(r) {
  return {
    id: r.id, listerId: r.lister_id, listerName: r.lister_name, businessName: r.business_name, month: r.month,
    gross: r.gross, commission: r.commission, payable: r.payable, percent: r.commission_percent,
    payments: r.payments_count, status: r.status, reference: r.reference, paidAt: r.paid_at, updatedAt: r.updated_at,
  };
}

export const SETTLEMENT_SELECT = `
  SELECT st.*, u.full_name AS lister_name,
         (SELECT business_name FROM lister_applications la WHERE la.user_id = st.lister_id ORDER BY la.id DESC LIMIT 1) AS business_name
    FROM settlements st JOIN users u ON u.id = st.lister_id`;
