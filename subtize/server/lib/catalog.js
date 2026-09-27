import { db } from '../db/index.js';
import { distanceKm } from './geo.js';
import { dayKey, today } from './dates.js';

export const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/* ── Counts ─────────────────────────────────────────────────────────────── */

/** Active subscribers per service, in one query. */
export function subscriberCounts() {
  const rows = db.prepare(
    `SELECT service_id, COUNT(*) AS n FROM subscriptions
      WHERE status = 'active' AND end_date >= ? GROUP BY service_id`,
  ).all(today());
  return new Map(rows.map((r) => [r.service_id, r.n]));
}

/** Seats taken for capacity purposes: active plus anything waiting on payment checks. */
export function seatsTaken(serviceId) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM subscriptions
      WHERE service_id = ? AND (
        (status = 'active' AND end_date >= ?) OR status IN ('pending_verification', 'verified'))`,
  ).get(serviceId, today()).n;
}

/** Seats taken for every capped service at once, for list views. */
export function seatsTakenAll() {
  const rows = db.prepare(
    `SELECT sub.service_id, COUNT(*) AS n FROM subscriptions sub JOIN services s ON s.id = sub.service_id
      WHERE s.max_subscribers IS NOT NULL AND ((sub.status = 'active' AND sub.end_date >= ?) OR sub.status IN ('pending_verification', 'verified'))
      GROUP BY sub.service_id`,
  ).all(today());
  return new Map(rows.map((r) => [r.service_id, r.n]));
}

/** Coupons someone could actually use today, grouped by service (null key = all services). */
export function liveCoupons({ publicOnly = true } = {}) {
  const rows = db.prepare(
    `SELECT c.*,
            (SELECT COUNT(*) FROM payments p WHERE p.coupon_id = c.id AND p.status IN ('pending', 'verified')) AS used
       FROM coupons c
      WHERE c.is_active = 1 AND c.starts_on <= ? AND c.expires_on >= ?
        ${publicOnly ? 'AND c.is_public = 1' : ''}`,
  ).all(today(), today());
  return rows.filter((c) => c.usage_limit == null || c.used < c.usage_limit);
}

/** How many times this member has used each coupon (pending or verified payments). */
export function myCouponUses(userId) {
  const rows = db.prepare(
    "SELECT coupon_id, COUNT(*) AS n FROM payments WHERE user_id = ? AND coupon_id IS NOT NULL AND status IN ('pending', 'verified') GROUP BY coupon_id",
  ).all(userId);
  return new Map(rows.map((r) => [r.coupon_id, r.n]));
}

export const couponLabel = (c) =>
  c.discount_type === 'percent' ? `${c.discount_value}% off` : `₹${Math.round(c.discount_value / 100)} off`;

/* ── Public projection ──────────────────────────────────────────────────── */

const splitDays = (csv) => String(csv || '').split(',').filter(Boolean);

function imagesFor(ids) {
  if (!ids.length) return new Map();
  const rows = db.prepare(
    `SELECT service_id, path FROM service_images WHERE service_id IN (${ids.map(() => '?').join(',')}) ORDER BY sort, id`,
  ).all(...ids);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.service_id)) map.set(r.service_id, []);
    map.get(r.service_id).push(`/uploads/${r.path}`);
  }
  return map;
}

/**
 * The only shape a service leaves the server in for explorers and users.
 * Built from an allow-list: lister_id, provider_*, payment config and
 * anything internal simply never gets copied across.
 */
export function publicService(row, ctx = {}) {
  const days = splitDays(row.available_days);
  const count = ctx.counts?.get(row.id) ?? 0;
  const offers = (ctx.coupons || []).filter((c) => row.coupons_enabled && (c.service_id == null || c.service_id === row.id)
    && !((ctx.myCouponUses?.get(c.id) || 0) >= c.per_user_limit));
  // Rank by what it would actually save on one month, so ₹150 off and 15% off compare fairly.
  const saving = (c) => {
    if (row.monthly_price < c.min_value) return 0;
    const raw = c.discount_type === 'percent' ? Math.floor((row.monthly_price * c.discount_value) / 100) : c.discount_value;
    return c.max_discount != null ? Math.min(raw, c.max_discount) : raw;
  };
  const best = offers.filter((c) => saving(c) > 0).sort((a, b) => saving(b) - saving(a))[0];
  const dist = ctx.origin ? distanceKm(ctx.origin, row) : null;
  const todayKey = dayKey(today());
  const taken = row.max_subscribers == null ? null : ctx.withCapacity ? seatsTaken(row.id) : (ctx.seats?.get(row.id) ?? 0);

  return {
    id: row.id,
    publicId: row.public_id,
    slug: row.slug,
    name: row.name,
    category: { slug: row.category_slug, name: row.category_name, icon: row.category_icon },
    shortDescription: row.short_description,
    description: row.description,
    area: row.area,
    city: row.city,
    lat: row.lat,
    lng: row.lng,
    distanceKm: dist == null ? null : Math.round(dist * 10) / 10,
    serviceType: row.service_type,
    monthlyPrice: row.monthly_price,
    plans: String(row.plan_months || '1').split(',').map(Number),
    availableDays: days,
    availableDayNames: days.map((d) => DAY_NAMES[d]),
    openToday: days.includes(todayKey),
    hours: row.hours,
    usagePolicy: {
      allowed: row.usage_allowed,
      unit: row.usage_unit,
      period: 'month',
      restrictions: row.usage_restrictions,
      rules: row.service_rules,
    },
    maxSubscribers: row.max_subscribers,
    spotsLeft: row.max_subscribers != null && taken != null ? Math.max(0, row.max_subscribers - taken) : null,
    subscriberCount: count,
    subscriberLabel: `${count} subscriber${count === 1 ? '' : 's'} currently subscribed`,
    hasOffer: Boolean(best),
    offerLabel: best ? couponLabel(best) : null,
    offerCode: best && best.is_public ? best.code : null,
    images: ctx.images?.get(row.id) || [],
    status: row.status,
    mySubscription: ctx.mine?.get(row.id) || null,
    excluded: ctx.excluded?.has(row.id) || false,
  };
}

const BASE_SELECT = `
  SELECT s.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon
    FROM services s JOIN categories c ON c.id = s.category_id`;

export function serviceRow(idOrSlug) {
  const byId = /^\d+$/.test(String(idOrSlug));
  return db.prepare(`${BASE_SELECT} WHERE s.deleted_at IS NULL AND ${byId ? 's.id' : 's.slug'} = ?`).get(idOrSlug) || null;
}

/** Everything a viewer-specific projection needs, gathered once per request. */
export function viewerContext(user, { origin = null } = {}) {
  const ctx = { counts: subscriberCounts(), seats: seatsTakenAll(), coupons: liveCoupons(), origin, mine: new Map(), excluded: new Set() };
  if (user) {
    const subs = db.prepare(
      `SELECT sub.service_id, sub.status, sub.public_id, sub.end_date,
              (SELECT public_id FROM payments p WHERE p.subscription_id = sub.id ORDER BY p.id DESC LIMIT 1) AS payment_id
         FROM subscriptions sub
        WHERE sub.user_id = ? AND sub.status IN ('pending_payment', 'pending_verification', 'verified', 'active')
        ORDER BY sub.id DESC`,
    ).all(user.id);
    for (const s of subs) {
      if (!ctx.mine.has(s.service_id)) ctx.mine.set(s.service_id, { status: s.status, id: s.public_id, endDate: s.end_date, paymentId: s.payment_id });
    }
    ctx.myCouponUses = myCouponUses(user.id);
    for (const r of db.prepare('SELECT service_id FROM user_exclusions WHERE user_id = ?').all(user.id)) {
      ctx.excluded.add(r.service_id);
    }
  }
  return ctx;
}

/* ── Search ─────────────────────────────────────────────────────────────── */

const STOP = new Set(('a an the for me my near nearby in at on to of with and or under below above over than less more within '
  + 'find show search get need want looking some any service services subscription subscriptions monthly month per around '
  + 'rs inr km please i am is are can you which what where good best cheap cheapest only just also now make change filter apply '
  + 'class classes lesson lessons plan plans option options place places something anything that it this those').split(' '));

export const tokens = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]/g, ' ')
  .split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

function relevance(row, words) {
  if (!words.length) return 1;
  const name = row.name.toLowerCase();
  const cat = `${row.category_name} ${row.category_slug}`.toLowerCase();
  const area = `${row.area} ${row.city}`.toLowerCase();
  const text = `${row.short_description} ${row.description}`.toLowerCase();
  let score = 0;
  for (const w of words) {
    const stem = w.length > 4 ? w.replace(/(es|s)$/, '') : w;
    if (name.includes(stem)) score += 3;
    if (cat.includes(stem)) score += 3;
    if (area.includes(stem)) score += 2;
    if (text.includes(stem)) score += 1;
  }
  return score;
}

/**
 * Filters and ranks active services.
 *
 * @param {object} f  q, category, minPrice/maxPrice (rupees), lat/lng + distance (km),
 *                    area, city, days[], duration, minSubscribers, offers, type, sort
 */
export function searchServices(f = {}, { user = null, origin = null, includeExcluded = false, limit = 60, offset = 0 } = {}) {
  const ctx = viewerContext(user, { origin });
  let rows = db.prepare(`${BASE_SELECT} WHERE s.status = 'active' AND s.deleted_at IS NULL`).all();

  const words = tokens(f.q);
  const cats = [].concat(f.category || []).flatMap((c) => String(c).split(',')).filter(Boolean);
  const days = [].concat(f.days || []).flatMap((d) => String(d).split(',')).filter(Boolean);

  rows = rows.filter((r) => {
    if (!includeExcluded && ctx.excluded.has(r.id)) return false;
    if (cats.length && !cats.includes(r.category_slug)) return false;
    if (f.minPrice != null && r.monthly_price < Number(f.minPrice) * 100) return false;
    if (f.maxPrice != null && r.monthly_price > Number(f.maxPrice) * 100) return false;
    if (f.type && r.service_type !== f.type) return false;
    if (f.city && r.city.toLowerCase() !== String(f.city).toLowerCase()) return false;
    if (f.area && !r.area.toLowerCase().includes(String(f.area).toLowerCase()) && !origin) return false;
    if (days.length) {
      const offered = splitDays(r.available_days);
      if (!days.every((d) => offered.includes(d))) return false;
    }
    if (f.duration && !String(r.plan_months).split(',').map(Number).includes(Number(f.duration))) return false;
    if (f.minSubscribers && (ctx.counts.get(r.id) || 0) < Number(f.minSubscribers)) return false;
    if (origin && f.distance) {
      const d = distanceKm(origin, r);
      if (d == null || d > Number(f.distance)) return false;
    }
    return true;
  });

  if (words.length) {
    rows = rows.map((r) => ({ r, score: relevance(r, words) })).filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score).map((x) => x.r);
  }

  ctx.images = imagesFor(rows.map((r) => r.id));
  let list = rows.map((r) => publicService(r, ctx));
  if (f.offers) list = list.filter((s) => s.hasOffer);

  const sorters = {
    price_asc: (a, b) => a.monthlyPrice - b.monthlyPrice,
    price_desc: (a, b) => b.monthlyPrice - a.monthlyPrice,
    popular: (a, b) => b.subscriberCount - a.subscriberCount,
    distance: (a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9),
    newest: (a, b) => b.id - a.id,
  };
  const sort = f.sort || (words.length ? 'relevance' : origin ? 'distance' : 'popular');
  if (sorters[sort]) list.sort(sorters[sort]);

  return { total: list.length, services: list.slice(offset, offset + limit), sort };
}

export function serviceDetail(idOrSlug, { user = null, origin = null, allowInactive = false } = {}) {
  const row = serviceRow(idOrSlug);
  if (!row || (!allowInactive && row.status !== 'active')) return null;
  const ctx = viewerContext(user, { origin });
  ctx.images = imagesFor([row.id]);
  ctx.withCapacity = true;
  return publicService(row, ctx);
}

export function categoriesWithCounts() {
  return db.prepare(
    `SELECT c.slug, c.name, c.icon,
            (SELECT COUNT(*) FROM services s WHERE s.category_id = c.id AND s.status = 'active' AND s.deleted_at IS NULL) AS services
       FROM categories c ORDER BY c.sort, c.name`,
  ).all();
}
