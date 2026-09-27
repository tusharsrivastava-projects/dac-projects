import express from 'express';
import { db } from '../db/index.js';
import { categoriesWithCounts, couponLabel, liveCoupons, searchServices, serviceDetail } from '../lib/catalog.js';
import { allLocations, cityCentre, findLocation } from '../lib/geo.js';
import { notFound, wrap } from '../lib/http.js';
import { parseRules, resolve } from '../lib/assistant.js';
import { llmEnabled, parseWithClaude } from '../lib/llm.js';
import { platformSettings, publicBaseUrl } from '../lib/platform.js';
import { today } from '../lib/dates.js';
import { expireDue, usageSummary } from '../lib/subscriptions.js';
import { rateLimit } from '../middleware/rateLimit.js';

export const publicRouter = express.Router();

const num = (v) => (v === undefined || v === '' || v === null || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * Where "near me" is measured from: the browser's coordinates if sent, then a
 * named area, then the member's saved location, then nothing.
 */
export function originFor(req, src = req.query) {
  const lat = num(src.lat);
  const lng = num(src.lng);
  if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, source: 'device' };
  if (src.area) {
    const loc = findLocation(src.area);
    if (loc) return { lat: loc.lat, lng: loc.lng, source: 'area', area: loc.area };
  }
  if (req.user) {
    const u = db.prepare('SELECT pref_lat, pref_lng, preferred_area FROM users WHERE id = ?').get(req.user.id);
    if (u?.pref_lat != null) return { lat: u.pref_lat, lng: u.pref_lng, source: 'profile', area: u.preferred_area };
  }
  return null;
}

publicRouter.get('/meta', (req, res) => {
  const p = platformSettings();
  const stats = db.prepare(
    `SELECT (SELECT COUNT(*) FROM services WHERE status = 'active' AND deleted_at IS NULL) AS services,
            (SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND end_date >= ?) AS subscribers,
            (SELECT COUNT(DISTINCT area) FROM services WHERE status = 'active' AND deleted_at IS NULL) AS areas`,
  ).get(today());
  res.json({
    categories: categoriesWithCounts(),
    locations: allLocations(),
    stats,
    platform: {
      supportEmail: p.supportEmail, supportPhone: p.supportPhone, defaultCity: p.defaultCity,
      commissionPercent: p.commissionPercent, payee: p.payee,
    },
    cityCentre: cityCentre(p.defaultCity),
    ai: { llm: llmEnabled() },
    baseUrl: publicBaseUrl(req),
  });
});

publicRouter.get('/services', (req, res) => {
  expireDue();
  const q = req.query;
  const origin = originFor(req);
  const f = {
    q: q.q || null,
    category: q.category || null,
    minPrice: num(q.minPrice),
    maxPrice: num(q.maxPrice),
    distance: num(q.distance),
    area: origin?.source === 'area' ? null : q.area || null,
    city: q.city || null,
    days: q.days ? String(q.days).split(',') : null,
    duration: num(q.duration),
    minSubscribers: num(q.minSubscribers),
    offers: q.offers === '1' || q.offers === 'true',
    type: q.type || null,
    sort: q.sort || null,
  };
  const limit = Math.min(100, num(q.limit) || 60);
  const offset = Math.max(0, num(q.offset) || 0);
  const result = searchServices(f, { user: req.user, origin, limit, offset, includeExcluded: q.includeExcluded === '1' });
  res.json({ ...result, origin });
});

publicRouter.get('/services/:idOrSlug', (req, res, next) => {
  expireDue();
  const origin = originFor(req);
  const svc = serviceDetail(req.params.idOrSlug, { user: req.user, origin });
  if (!svc) return next(notFound('That service is not available.'));
  const similar = searchServices({ category: svc.category.slug }, { user: req.user, origin, limit: 5 })
    .services.filter((s) => s.id !== svc.id).slice(0, 4);
  res.json({ service: svc, similar });
});

const assistantLimit = rateLimit({ max: 40, windowMs: 60 * 1000, message: 'Slow down a little — too many searches in a minute.' });

publicRouter.post('/assistant', assistantLimit, wrap(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 500);
  if (!text) return res.json({ intent: 'search', filters: {}, fields: {}, reply: 'Tell me what you are looking for — for example, "gym near me under ₹1,000".' });
  const context = { page: req.body.context?.page || 'search', serviceId: num(req.body.context?.serviceId) };
  const origin = originFor(req, req.body);
  const parsed = (await parseWithClaude(text, context)) || { ...parseRules(text, context), source: 'rules' };
  res.json(resolve(parsed, { user: req.user, origin, context }));
}));

publicRouter.get('/coupons', (_req, res) => {
  const rows = liveCoupons();
  const names = new Map(db.prepare('SELECT id, name, slug FROM services').all().map((s) => [s.id, s]));
  res.json({
    coupons: rows.map((c) => ({
      code: c.code,
      description: c.description,
      label: couponLabel(c),
      discountType: c.discount_type,
      discountValue: c.discount_value,
      maxDiscount: c.max_discount,
      minValue: c.min_value,
      expiresOn: c.expires_on,
      remaining: c.usage_limit == null ? null : Math.max(0, c.usage_limit - c.used),
      service: c.service_id ? { id: c.service_id, name: names.get(c.service_id)?.name, slug: names.get(c.service_id)?.slug } : null,
    })),
  });
});

/**
 * What a provider sees when they scan a subscription card. Enough to decide
 * whether to let someone in — never the member's contact details.
 */
publicRouter.get('/verify/:code', (req, res, next) => {
  expireDue();
  const row = db.prepare(
    `SELECT sub.*, s.name AS service_name, s.available_days, u.full_name
       FROM subscriptions sub JOIN services s ON s.id = sub.service_id JOIN users u ON u.id = sub.user_id
      WHERE sub.card_code = ?`,
  ).get(String(req.params.code || ''));
  if (!row) return next(notFound('This card is not recognised.'));
  const [first, ...rest] = row.full_name.trim().split(/\s+/);
  const usage = usageSummary(row);
  const valid = row.status === 'active' && row.start_date <= today() && row.end_date >= today();
  res.json({
    valid,
    status: row.status === 'active' && row.start_date > today() ? 'upcoming' : row.status,
    subscriptionId: row.public_id,
    holder: `${first}${rest.length ? ` ${rest[rest.length - 1][0]}.` : ''}`,
    service: row.service_name,
    validFrom: row.start_date,
    validTo: row.end_date,
    availableDays: row.available_days.split(','),
    usage: { allowed: usage.allowed, used: usage.used, remaining: usage.remaining, unit: usage.unit },
    checkedAt: new Date().toISOString(),
  });
});
