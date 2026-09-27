import { db, notify } from '../db/index.js';
import { badRequest } from './http.js';
import { cardCode } from './ids.js';
import { addDays, addMonths, daysBetween, localStamp, planEnd, today } from './dates.js';
import { platformSettings } from './platform.js';
import { DAY_NAMES } from './catalog.js';
import { formatINR } from './money.js';

/* ── Housekeeping ───────────────────────────────────────────────────────── */

/** Flips lapsed plans to expired. Cheap; called before anything reads statuses. */
export function expireDue() {
  const due = db.prepare("SELECT id, user_id, public_id FROM subscriptions WHERE status = 'active' AND end_date < ?").all(today());
  if (!due.length) return 0;
  const upd = db.prepare("UPDATE subscriptions SET status = 'expired', updated_at = datetime('now') WHERE id = ?");
  db.transaction(() => {
    for (const s of due) {
      upd.run(s.id);
      notify(s.user_id, { title: 'A subscription has expired', body: `${s.public_id} reached its end date.`, link: `/app#/subscriptions/${s.public_id}` });
    }
  })();
  return due.length;
}

/* ── Coupons ────────────────────────────────────────────────────────────── */

/**
 * Checks a code against a service and order value. Returns the coupon and
 * the discount in paise, or throws a 400 that says exactly why not.
 */
export function applyCoupon(code, { service, amount, userId }) {
  const c = db.prepare('SELECT * FROM coupons WHERE code = ? COLLATE NOCASE').get(String(code || '').trim());
  const nope = (msg) => { throw badRequest(msg, { field: 'couponCode' }); };
  if (!c || !c.is_active) nope('That coupon code is not valid.');
  if (!service.coupons_enabled) nope('Coupons cannot be used on this service.');
  if (c.service_id != null && c.service_id !== service.id) nope('That coupon is for a different service.');
  const t = today();
  if (c.starts_on > t) nope(`That coupon starts on ${c.starts_on}.`);
  if (c.expires_on < t) nope('That coupon has expired.');
  if (amount < c.min_value) nope(`That coupon needs an order of at least ${formatINR(c.min_value)}.`);

  const used = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE coupon_id = ? AND status IN ('pending', 'verified')").get(c.id).n;
  if (c.usage_limit != null && used >= c.usage_limit) nope('That coupon has been fully used.');
  if (userId) {
    const mine = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE coupon_id = ? AND user_id = ? AND status IN ('pending', 'verified')")
      .get(c.id, userId).n;
    if (mine >= c.per_user_limit) nope('You have already used that coupon.');
  }

  let discount = c.discount_type === 'percent' ? Math.floor((amount * c.discount_value) / 100) : c.discount_value;
  if (c.max_discount != null) discount = Math.min(discount, c.max_discount);
  discount = Math.min(discount, amount - 100); // always leave at least ₹1 to pay
  return { coupon: c, discount: Math.max(0, discount) };
}

/** Price breakdown for a checkout, without creating anything. */
export function quote(service, { months = 1, couponCode = null, userId = null }) {
  const offered = String(service.plan_months || '1').split(',').map(Number);
  if (!offered.includes(Number(months))) {
    throw badRequest(`This service offers ${offered.map((m) => `${m}-month`).join(', ')} plans.`, { field: 'months' });
  }
  const amount = service.monthly_price * months;
  let coupon = null;
  let discount = 0;
  if (couponCode) ({ coupon, discount } = applyCoupon(couponCode, { service, amount, userId }));
  return {
    months: Number(months),
    monthlyPrice: service.monthly_price,
    amount,
    discount,
    finalAmount: amount - discount,
    coupon: coupon ? { code: coupon.code, type: coupon.discount_type, value: coupon.discount_value } : null,
  };
}

/* ── Activation ─────────────────────────────────────────────────────────── */

/**
 * Starts a paid subscription. If the member already has an active plan for
 * the same service (a renewal), the new one picks up the day after it ends.
 */
export function activate(subId, adminId) {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subId);
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(sub.service_id);
  const current = db.prepare(
    "SELECT end_date FROM subscriptions WHERE user_id = ? AND service_id = ? AND status = 'active' AND id <> ? ORDER BY end_date DESC LIMIT 1",
  ).get(sub.user_id, sub.service_id, sub.id);
  const start = current && current.end_date >= today() ? addDays(current.end_date, 1) : today();
  const end = planEnd(start, sub.months);

  db.prepare(
    `UPDATE subscriptions
        SET status = 'active', start_date = ?, end_date = ?, activated_at = datetime('now'), activated_by = ?,
            usage_allowed = ?, usage_unit = ?, card_code = COALESCE(card_code, ?), updated_at = datetime('now')
      WHERE id = ?`,
  ).run(start, end, adminId, svc.usage_allowed, svc.usage_unit, cardCode(), sub.id);

  notify(sub.user_id, {
    title: `${svc.name} is active`,
    body: `Your subscription runs ${start} to ${end}. Your digital card is ready.`,
    link: `/app#/cards/${sub.public_id}`,
  });
  return { start, end };
}

/* ── Usage ──────────────────────────────────────────────────────────────── */

/**
 * Usage allowances reset monthly even on multi-month plans. Works out which
 * monthly cycle today falls in and what has been used inside it.
 */
export function usageSummary(sub) {
  if (!sub.start_date) {
    return { allowed: sub.usage_allowed, unit: sub.usage_unit, used: 0, remaining: sub.usage_allowed, totalUsed: 0, percent: 0, cycleStart: null, cycleEnd: null, log: [] };
  }
  const t = today() < sub.start_date ? sub.start_date : today() > sub.end_date ? sub.end_date : today();
  let cycleStart = sub.start_date;
  for (let i = 1; i < sub.months; i++) {
    const next = addMonths(sub.start_date, i);
    if (next <= t) cycleStart = next; else break;
  }
  const cycleEnd = [addDays(addMonths(cycleStart, 1), -1), sub.end_date].sort()[0];

  const log = db.prepare(
    `SELECT u.units, u.note, u.source, u.logged_at FROM usage_logs u WHERE u.subscription_id = ? ORDER BY u.logged_at DESC, u.id DESC`,
  ).all(sub.id);
  const inCycle = log.filter((l) => l.logged_at.slice(0, 10) >= cycleStart && l.logged_at.slice(0, 10) <= cycleEnd);
  const used = inCycle.reduce((n, l) => n + l.units, 0);
  const totalUsed = log.reduce((n, l) => n + l.units, 0);
  const allowed = sub.usage_allowed;
  return {
    allowed,
    unit: sub.usage_unit,
    used,
    remaining: allowed == null ? null : Math.max(0, allowed - used),
    totalUsed,
    percent: allowed ? Math.min(100, Math.round((used / allowed) * 100)) : 0,
    cycleStart,
    cycleEnd,
    log: log.slice(0, 50),
  };
}

/** Records one or more uses. Refuses past the allowance, or on an inactive plan. */
export function recordUsage(sub, { units = 1, note = null, source, by }) {
  if (sub.status !== 'active') throw badRequest('Usage can only be recorded on an active subscription.');
  if (today() < sub.start_date) throw badRequest(`This plan starts on ${sub.start_date}.`);
  const usage = usageSummary(sub);
  if (usage.allowed != null && usage.used + units > usage.allowed) {
    throw badRequest(`Only ${usage.remaining} ${usage.unit} left this cycle.`);
  }
  db.prepare('INSERT INTO usage_logs (subscription_id, units, note, source, logged_by, logged_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sub.id, units, note, source, by, localStamp());
  return usageSummary(sub);
}

/* ── Projection ─────────────────────────────────────────────────────────── */

export const SUB_SELECT = `
  SELECT sub.*, s.name AS service_name, s.slug AS service_slug, s.area, s.city, s.available_days, s.hours,
         s.usage_restrictions, s.service_rules, s.status AS service_status, s.service_type,
         c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon,
         u.full_name AS user_name, u.email AS user_email, u.public_id AS user_public_id,
         p.public_id AS payment_id, p.status AS payment_status, p.amount, p.discount, p.final_amount,
         p.coupon_code, p.upi_txn_id, p.submitted_at, p.verified_at, p.rejection_reason
    FROM subscriptions sub
    JOIN services s ON s.id = sub.service_id
    JOIN categories c ON c.id = s.category_id
    JOIN users u ON u.id = sub.user_id
    LEFT JOIN payments p ON p.id = (SELECT id FROM payments WHERE subscription_id = sub.id ORDER BY id DESC LIMIT 1)`;

/**
 * Buckets for the Subscriptions tabs. "expiring" is an active plan within the
 * configured window of its end date.
 */
export function bucketOf(sub) {
  if (sub.excluded) return 'excluded';
  if (sub.status === 'active') {
    const left = daysBetween(today(), sub.end_date);
    return left <= platformSettings().expiringSoonDays ? 'expiring' : 'active';
  }
  if (['pending_payment', 'pending_verification', 'verified'].includes(sub.status)) return 'pending';
  if (sub.status === 'rejected') return 'cancelled';
  return sub.status; // expired, cancelled
}

/** What the member sees. Provider identity is not in the SELECT to begin with. */
export function memberSubscription(row, { withUsage = false } = {}) {
  const days = String(row.available_days || '').split(',').filter(Boolean);
  const remainingDays = row.status === 'active' && row.end_date ? Math.max(0, daysBetween(today(), row.end_date) + 1) : 0;
  const out = {
    id: row.public_id,
    status: row.status,
    bucket: bucketOf(row),
    service: {
      id: row.service_id, slug: row.service_slug, name: row.service_name, area: row.area, city: row.city,
      category: { name: row.category_name, slug: row.category_slug, icon: row.category_icon },
      availableDays: days, availableDayNames: days.map((d) => DAY_NAMES[d]), hours: row.hours,
      restrictions: row.usage_restrictions, rules: row.service_rules, status: row.service_status,
      serviceType: row.service_type,
    },
    months: row.months,
    startDate: row.start_date,
    endDate: row.end_date,
    remainingDays,
    activatedAt: row.activated_at,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    excluded: Boolean(row.excluded),
    payment: row.payment_id ? {
      id: row.payment_id, status: row.payment_status, amount: row.amount, discount: row.discount,
      finalAmount: row.final_amount, couponCode: row.coupon_code, upiTxnId: row.upi_txn_id,
      submittedAt: row.submitted_at, verifiedAt: row.verified_at, rejectionReason: row.rejection_reason,
    } : null,
    hasCard: Boolean(row.card_code && ['active', 'expired'].includes(row.status)),
    userName: row.user_name,
  };
  if (withUsage) out.usage = usageSummary(row);
  else if (row.status === 'active' || row.status === 'expired') {
    const u = usageSummary(row);
    out.usage = { allowed: u.allowed, used: u.used, remaining: u.remaining, unit: u.unit, percent: u.percent };
  }
  return out;
}
