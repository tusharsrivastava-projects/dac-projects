/**
 * Turns a spoken or typed request into something the app can act on:
 * a search, a filter tweak, an availability answer, a subscription to start,
 * or checkout fields to fill.
 *
 *   "find a gym subscription near me under ₹1,000"
 *     → { intent: 'search', filters: { category: 'gym', maxPrice: 1000, nearMe: true, distance: 5 } }
 *
 * The rule parser below handles the phrasings people actually use and needs no
 * network. When ANTHROPIC_API_KEY is set, lib/llm.js gets first go and this is
 * the fallback — both return the same shape, and both are resolved against
 * the real catalogue by resolve() here.
 */
import { db } from '../db/index.js';
import { findLocation } from './geo.js';
import { addDays, dayKey, today } from './dates.js';
import { DAY_NAMES, searchServices, serviceDetail, tokens } from './catalog.js';
import { formatINR } from './money.js';

export const CATEGORY_WORDS = {
  gym: ['gym', 'gyms', 'fitness', 'workout', 'weights', 'crossfit', 'bodybuilding', 'strength training'],
  yoga: ['yoga', 'meditation', 'pilates', 'pranayam', 'wellness'],
  meals: ['tiffin', 'meal', 'meals', 'food', 'lunch', 'dinner', 'mess', 'dabba', 'thali', 'breakfast'],
  laundry: ['laundry', 'dry clean', 'dry cleaning', 'ironing', 'press', 'washing clothes', 'clothes'],
  'car-care': ['car wash', 'bike wash', 'car cleaning', 'car care', 'vehicle', 'car', 'bike', 'scooter'],
  tuition: ['tuition', 'coaching', 'tutor', 'classes for', 'maths', 'math', 'science', 'jee', 'neet', 'homework'],
  salon: ['salon', 'haircut', 'hair cut', 'grooming', 'beauty', 'parlour', 'parlor', 'barber', 'spa', 'facial'],
  dance: ['dance', 'zumba', 'bollywood dance', 'hip hop', 'aerobics'],
  music: ['music', 'guitar', 'piano', 'keyboard', 'singing', 'vocal', 'tabla', 'violin'],
  swimming: ['swimming', 'swim', 'pool'],
  coworking: ['coworking', 'co-working', 'co working', 'desk', 'workspace', 'office space', 'library', 'reading room', 'study space', 'study room'],
  dairy: ['milk', 'dairy', 'newspaper', 'daily essentials', 'groceries', 'eggs', 'bread'],
  'home-cleaning': ['house cleaning', 'home cleaning', 'cleaning', 'maid', 'housekeeping', 'deep clean', 'bathroom cleaning'],
  sports: ['badminton', 'football', 'cricket', 'tennis', 'table tennis', 'basketball', 'skating', 'sports', 'martial arts', 'karate', 'taekwondo', 'boxing'],
  'pet-care': ['pet', 'pets', 'dog', 'dogs', 'cat', 'pet grooming', 'dog walking', 'dog walker'],
};

const DAY_WORDS = {
  monday: 'mon', mon: 'mon', tuesday: 'tue', tue: 'tue', tues: 'tue', wednesday: 'wed', wed: 'wed',
  thursday: 'thu', thu: 'thu', thurs: 'thu', friday: 'fri', fri: 'fri', saturday: 'sat', sat: 'sat', sunday: 'sun', sun: 'sun',
};
const NUMBER_WORDS = { one: 1, a: 1, single: 1, two: 2, three: 3, four: 4, six: 6, twelve: 12 };

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const amount = (n, k) => Math.round(Number(String(n).replace(/,/g, '')) * (k ? 1000 : 1));

/** Speech engines write "₹1,000" as "rupees 1000", "1000 rupees", "1k", "one thousand". */
function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[₹]/g, ' rs ')
    .replace(/\brupees?\b|\binr\b|\brs\.?/g, ' rs ')
    .replace(/\bone thousand\b/g, '1000').replace(/\btwo thousand\b/g, '2000').replace(/\bthree thousand\b/g, '3000')
    .replace(/\bfive hundred\b/g, '500').replace(/\bfive thousand\b/g, '5000')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/[“”"?!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Rule parser ────────────────────────────────────────────────────────── */

export function parseRules(input, context = {}) {
  const raw = String(input || '').trim();
  let t = ` ${normalise(raw)} `;
  const filters = {};
  const fields = {};
  const consumed = [];
  const take = (re) => { t = t.replace(re, ' '); };

  // Checkout fields first: a transaction ID is a long digit run that must not be read as a price.
  const txn = t.match(/(?:transaction|txn|utr|upi ref(?:erence)?|reference)\s*(?:id|number|no\.?|num)?\s*(?:is|:)?\s*([a-z0-9][a-z0-9 ]{8,45})/);
  if (txn) {
    const id = txn[1].replace(/\s+/g, '').toUpperCase().match(/^[A-Z0-9]{10,35}/)?.[0];
    if (id) { fields.upiTxnId = id; take(txn[0]); }
  }
  const coupon = t.match(/(?:coupon|promo|discount|offer)\s*(?:code)?\s*(?:is|:)?\s+(?!code\b)([a-z]+[a-z0-9]*\d+[a-z0-9]*|[a-z0-9]{4,16})\b/);
  if (coupon && !/^(for|on|with|and|available|please|near|under)$/.test(coupon[1])) {
    fields.couponCode = coupon[1].toUpperCase();
    take(coupon[0]);
  }
  if (/\bremove (the )?coupon\b/.test(t)) fields.couponCode = '';

  // Subscriber counts before prices, so "over 20 members" is not a price.
  const subs = t.match(/(?:at least|over|more than|minimum|min)\s*(\d+)\s*(?:subscribers|members|people|users)/);
  if (subs) { filters.minSubscribers = Number(subs[1]); take(subs[0]); }

  const dist = t.match(/(?:within|under|less than|in|upto|up to)?\s*(\d+(?:\.\d+)?)\s*(?:km|kms|kilomet(?:er|re)s?)\b/);
  if (dist) { filters.distance = Number(dist[1]); filters.nearMe = true; take(dist[0]); }
  if (/\b(near me|nearby|near by|close to me|around me|closest|nearest|close by)\b/.test(t)) {
    filters.nearMe = true;
    if (!filters.distance) filters.distance = 5;
    take(/\b(near me|nearby|near by|close to me|around me|close by)\b/g);
  }

  const between = t.match(/between\s*(?:rs\s*)?(\d+(?:\.\d+)?)(k)?\s*(?:rs\s*)?(?:and|to|-)\s*(?:rs\s*)?(\d+(?:\.\d+)?)(k)?/);
  if (between) {
    filters.minPrice = amount(between[1], between[2]);
    filters.maxPrice = amount(between[3], between[4]);
    take(between[0]);
  }
  const under = t.match(/(?:under|below|less than|upto|up to|within|max(?:imum)?|cheaper than|not more than|budget(?: of| is)?|<)\s*(?:rs\s*)?(\d+(?:\.\d+)?)(k)?\s*(?:rs)?(?!\s*(?:km|kms|kilomet|month|months|days|subscribers|members))/);
  if (under && !between) { filters.maxPrice = amount(under[1], under[2]); take(under[0]); }
  const over = t.match(/(?:above|over|more than|at least|minimum|starting at|from)\s*(?:rs\s*)?(\d+(?:\.\d+)?)(k)?\s*(?:rs)?(?!\s*(?:km|kms|kilomet|month|months|days|subscribers|members))/);
  if (over && !between) { filters.minPrice = amount(over[1], over[2]); take(over[0]); }
  const bare = t.match(/\brs\s*(\d+(?:\.\d+)?)(k)?\b|\b(\d+(?:\.\d+)?)(k)?\s*rs\b/);
  if (bare && filters.maxPrice == null && filters.minPrice == null) {
    filters.maxPrice = amount(bare[1] || bare[3], bare[2] || bare[4]);
    take(bare[0]);
  }

  // Duration
  const dur = t.match(/\b(\d+|one|a|single|two|three|four|six|twelve)[\s-]*(month|months|mo)\b/);
  if (dur) {
    const m = NUMBER_WORDS[dur[1]] ?? Number(dur[1]);
    if ([1, 3, 6, 12].includes(m)) { filters.duration = m; fields.months = m; }
    take(dur[0]);
  }
  if (/\bquarterly\b/.test(t)) { filters.duration = 3; fields.months = 3; take(/\bquarterly\b/); }
  if (/\bhalf[- ]?yearly\b/.test(t)) { filters.duration = 6; fields.months = 6; take(/\bhalf[- ]?yearly\b/); }
  if (/\b(yearly|annual|one year|1 year|a year)\b/.test(t)) { filters.duration = 12; fields.months = 12; take(/\b(yearly|annual|one year|1 year|a year)\b/); }

  // Days
  const days = new Set();
  if (/\bweekends?\b/.test(t)) { days.add('sat'); days.add('sun'); take(/\bweekends?\b/g); }
  if (/\bweekdays?\b/.test(t)) { ['mon', 'tue', 'wed', 'thu', 'fri'].forEach((d) => days.add(d)); take(/\bweekdays?\b/g); }
  if (/\btoday\b/.test(t)) { days.add(dayKey(today())); take(/\btoday\b/g); }
  if (/\btomorrow\b/.test(t)) { days.add(dayKey(addDays(today(), 1))); take(/\btomorrow\b/g); }
  for (const [word, key] of Object.entries(DAY_WORDS)) {
    const re = new RegExp(`\\b${word}s?\\b`, 'g');
    if (re.test(t)) { days.add(key); take(re); }
  }
  if (days.size) filters.days = [...days];

  if (/\b(coupon|coupons|offer|offers|discount|discounts|deal|deals|promo)\b/.test(t)) {
    filters.offers = true;
    take(/\b(with |any )?(coupon|coupons|offer|offers|discount|discounts|deal|deals|promo)s?\b/g);
  }
  if (/\b(at home|home service|doorstep|door step|home visit|comes? to (my )?home)\b/.test(t)) {
    filters.type = 'doorstep'; take(/\b(at home|home service|doorstep|door step|home visit|comes? to (my )?home)\b/g);
  } else if (/\bonline\b/.test(t)) { filters.type = 'online'; take(/\bonline\b/g); }

  if (/\b(cheapest|lowest price|least expensive|affordable|budget)\b/.test(t)) filters.sort = 'price_asc';
  else if (/\b(most popular|popular|most subscribers|trending|best rated|top)\b/.test(t)) filters.sort = 'popular';
  else if (/\b(closest|nearest)\b/.test(t)) filters.sort = 'distance';
  else if (/\b(premium|expensive|luxury)\b/.test(t)) filters.sort = 'price_desc';
  else if (/\b(newest|latest|new)\b/.test(t)) filters.sort = 'newest';

  // Place names from the known-areas table.
  const area = findAreaIn(t);
  if (area) { filters.area = area.area; filters.city = area.city; take(new RegExp(`\\b(in|at|near|around)?\\s*${escapeRe(area.area.toLowerCase())}\\b`, 'g')); }

  // Category: longest synonym wins so "car wash" beats "car".
  let best = null;
  for (const [slug, words] of Object.entries(CATEGORY_WORDS)) {
    for (const w of words) {
      if (new RegExp(`\\b${escapeRe(w)}\\b`).test(t) && (!best || w.length > best.w.length)) best = { slug, w };
    }
  }
  if (best) { filters.category = best.slug; consumed.push(best.w); }

  // Intent
  let intent = 'search';
  const s = ` ${normalise(raw)} `;
  if (/\b(clear|reset|remove all|start over)\b.*\b(filters?|search)\b/.test(s)) intent = 'clear';
  else if (/\b(show|open|go to|take me to|view)\b.*\b(my )?(subscriptions?|cards?|payments?|usage|coupons?|profile|settings|dashboard)\b/.test(s)
    && !best) intent = 'navigate';
  else if (/\b(subscribe|sign me up|enrol|enroll|join|book|buy|start (a |my )?subscription|get me a subscription|purchase)\b/.test(s)) intent = 'subscribe';
  else if (/\b(is|are|does|do|when|which days|what days|what time|timings?)\b.*\b(open|available|availability|working|timings?|run|closed)\b/.test(s)
    || /\b(availability|open on|available on)\b/.test(s)) intent = 'availability';
  else if (context.page === 'checkout' && (fields.upiTxnId || fields.couponCode !== undefined || fields.months)) intent = 'fill';
  else if (!best && Object.keys(filters).length && /^\s*(only|just|and|also|make it|change|filter|under|below|within|with|on|show only|now)\b/.test(s)) intent = 'filter';

  let navigate = null;
  if (intent === 'navigate') {
    navigate = ['subscriptions', 'cards', 'payments', 'usage', 'coupons', 'profile', 'settings', 'dashboard']
      .find((p) => new RegExp(`\\b${p.replace(/s$/, '')}s?\\b`).test(s));
  }

  // Whatever is left is free text for relevance ranking ("physiotherapy", a service name).
  const leftover = tokens(t.replace(/\b(subscribe|subscription|sign|up|enrol|enroll|join|book|buy|me|to|open|available|availability|is|are|does|when|which|days|what|time|timings|working|find|show|search|looking|cheapest|popular|closest|nearest|affordable|budget|premium|newest|latest|top|best)\b/g, ' '))
    .filter((w) => !consumed.some((c) => c.includes(w)));
  if (leftover.length) filters.q = leftover.join(' ');

  return { intent, filters, fields, navigate, text: raw };
}

function findAreaIn(text) {
  const rows = db.prepare('SELECT area, city, lat, lng FROM locations').all()
    .sort((a, b) => b.area.length - a.area.length);
  return rows.find((r) => text.includes(` ${r.area.toLowerCase()} `) || text.includes(` ${r.area.toLowerCase()}`)) || null;
}

/* ── Resolution against the catalogue ──────────────────────────────────── */

/** Finds the service someone is naming, e.g. "iron paradise" → Iron Paradise Gym. */
export function matchServiceByName(text) {
  const words = tokens(text);
  if (!words.length) return null;
  const rows = db.prepare("SELECT id, name, slug FROM services WHERE status = 'active' AND deleted_at IS NULL").all();
  let best = null;
  for (const r of rows) {
    const nameWords = tokens(r.name);
    if (!nameWords.length) continue;
    const hits = nameWords.filter((w) => words.includes(w)).length;
    const score = hits / nameWords.length;
    if (hits >= Math.min(2, nameWords.length) && score >= 0.5 && (!best || score > best.score)) best = { ...r, score };
  }
  return best;
}

const NOUNS = {
  gym: ['gym', 'gyms'], yoga: ['yoga class', 'yoga classes'], meals: ['tiffin or meal plan', 'tiffin and meal plans'],
  laundry: ['laundry service', 'laundry services'], 'car-care': ['car or bike care plan', 'car and bike care plans'],
  tuition: ['tuition class', 'tuition classes'], salon: ['salon', 'salons'], dance: ['dance class', 'dance classes'],
  music: ['music class', 'music classes'], swimming: ['swimming pool', 'swimming pools'],
  coworking: ['coworking or study space', 'coworking and study spaces'], dairy: ['milk and essentials plan', 'milk and essentials plans'],
  'home-cleaning': ['home cleaning service', 'home cleaning services'], sports: ['sports academy', 'sports academies'],
  'pet-care': ['pet care service', 'pet care services'],
};

const describeFilters = (f, n = 2) => {
  const bits = [];
  const one = n === 1;
  if (f.category) bits.push(NOUNS[f.category]?.[one ? 0 : 1] || f.category);
  else if (f.q) bits.push(`${one ? 'service' : 'services'} matching "${f.q}"`);
  else bits.push(one ? 'service' : 'services');
  if (f.area) bits.push(`in ${f.area}`);
  else if (f.nearMe) bits.push(`within ${f.distance || 5} km of you`);
  if (f.minPrice != null && f.maxPrice != null) bits.push(`between ₹${f.minPrice} and ₹${f.maxPrice}`);
  else if (f.maxPrice != null) bits.push(`under ₹${f.maxPrice.toLocaleString('en-IN')}`);
  else if (f.minPrice != null) bits.push(`from ₹${f.minPrice.toLocaleString('en-IN')}`);
  if (f.days?.length) bits.push(`open ${f.days.map((d) => DAY_NAMES[d]).join(', ')}`);
  if (f.duration) bits.push(`with a ${f.duration}-month plan`);
  if (f.offers) bits.push('with a coupon');
  if (f.type === 'doorstep') bits.push('that come to you');
  if (f.type === 'online') bits.push('online');
  if (f.minSubscribers) bits.push(`with ${f.minSubscribers}+ subscribers`);
  return bits.join(' ');
};

/**
 * Takes a parsed request and grounds it: runs the search, picks the service
 * for subscribe/availability questions, and writes the reply the UI speaks.
 */
export function resolve(parsed, { user = null, origin = null, context = {} } = {}) {
  const { intent, filters, fields } = parsed;
  const out = { intent, filters, fields, navigate: parsed.navigate || null, service: null, results: null, reply: '', source: parsed.source || 'rules' };
  const f = { ...filters };
  const needsOrigin = f.nearMe && !origin;
  const searchOrigin = origin || (f.area ? findLocation(f.area) : null);
  if (f.area && searchOrigin && !f.distance) f.distance = 4;

  if (intent === 'clear') { out.reply = 'Filters cleared. Showing everything.'; return out; }
  if (intent === 'navigate') { out.reply = out.navigate ? `Opening your ${out.navigate}.` : 'Where would you like to go?'; return out; }
  if (intent === 'fill') {
    const bits = [];
    if (fields.months) bits.push(`${fields.months}-month plan`);
    if (fields.couponCode) bits.push(`coupon ${fields.couponCode}`);
    if (fields.couponCode === '') bits.push('coupon removed');
    if (fields.upiTxnId) bits.push(`transaction ID ${fields.upiTxnId}`);
    out.reply = bits.length ? `Filled in: ${bits.join(', ')}.` : 'I did not catch anything to fill in.';
    return out;
  }

  // A named service beats a category search for subscribe and availability.
  const named = matchServiceByName(parsed.text) || (context.serviceId ? { id: context.serviceId } : null);

  if (intent === 'availability') {
    const svc = named ? serviceDetail(named.id, { user, origin: searchOrigin }) : null;
    if (!svc) {
      const r = searchServices(f, { user, origin: searchOrigin, limit: 20 });
      out.results = r;
      const day = f.days?.[0];
      out.reply = day
        ? `${r.total} ${describeFilters({ ...f, days: [] }, r.total)} ${r.total === 1 ? 'is' : 'are'} open on ${DAY_NAMES[day]}.`
        : `Found ${r.total} ${describeFilters(f, r.total)}. Tap one to see its days.`;
      return out;
    }
    out.service = svc;
    const asked = f.days?.length ? f.days : null;
    if (asked) {
      const open = asked.filter((d) => svc.availableDays.includes(d));
      const closed = asked.filter((d) => !svc.availableDays.includes(d));
      out.reply = closed.length
        ? `${svc.name} is not available on ${closed.map((d) => DAY_NAMES[d]).join(' or ')}. It runs ${svc.availableDayNames.join(', ')}.`
        : `Yes — ${svc.name} is available on ${open.map((d) => DAY_NAMES[d]).join(' and ')}${svc.hours ? `, ${svc.hours}` : ''}.`;
    } else {
      out.reply = `${svc.name} is available ${svc.availableDayNames.join(', ')}${svc.hours ? `, ${svc.hours}` : ''}.`
        + (svc.spotsLeft != null ? ` ${svc.spotsLeft} spots left.` : '');
    }
    return out;
  }

  if (intent === 'subscribe') {
    let svc = named ? serviceDetail(named.id, { user, origin: searchOrigin }) : null;
    if (!svc && (f.category || f.q || f.maxPrice != null)) {
      const r = searchServices({ ...f, sort: f.sort || (searchOrigin ? 'distance' : 'popular') }, { user, origin: searchOrigin, limit: 5 });
      out.results = r;
      svc = r.services[0] || null;
    }
    if (!svc) { out.reply = 'Which service would you like to subscribe to? Try saying its name.'; out.intent = 'search'; return out; }
    out.service = svc;
    const months = fields.months && svc.plans.includes(fields.months) ? fields.months : svc.plans[0];
    out.fields = { ...fields, months };
    out.reply = `Starting a ${months}-month subscription to ${svc.name} for ${formatINR(svc.monthlyPrice * months)}${fields.couponCode ? ` with coupon ${fields.couponCode}` : ''}.`;
    return out;
  }

  const r = searchServices(f, { user, origin: searchOrigin, limit: 60 });
  out.results = r;
  out.reply = r.total
    ? `Found ${r.total} ${describeFilters(f, r.total)}.`
    : `No ${describeFilters(f)} matched. Try widening the price or distance.`;
  if (needsOrigin) out.needsLocation = true;
  return out;
}
