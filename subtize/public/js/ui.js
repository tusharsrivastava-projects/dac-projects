/* DOM, formatting, icons, toasts and dialogs shared by every page. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escapes text destined for an innerHTML template. Use it on every dynamic value. */
export const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** Tiny element builder: el('div', { class: 'card', onclick }, [children]). */
export function el(tag, attrs = {}, children = []) {
  if (Array.isArray(attrs) || attrs instanceof Node || typeof attrs === 'string') { children = attrs; attrs = {}; }
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Parses an HTML string into a DocumentFragment. */
export const html = (str) => document.createRange().createContextualFragment(str);

/* ── Formatting ─────────────────────────────────────────────────────────── */

/** Money arrives from the API in paise. */
export function inr(paise, { decimals = 'auto' } = {}) {
  const r = Math.round(Number(paise || 0)) / 100;
  const frac = decimals === 'auto' ? (r % 1 ? 2 : 0) : decimals;
  return `₹${r.toLocaleString('en-IN', { minimumFractionDigits: frac, maximumFractionDigits: frac })}`;
}
/** Compact: ₹1.2L, ₹3.4K. For stat tiles only. */
export function inrShort(paise) {
  const r = Math.round(Number(paise || 0)) / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(2)}Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(2)}L`;
  if (r >= 1e4) return `₹${(r / 1e3).toFixed(1)}K`;
  return inr(paise, { decimals: 0 });
}

const asDate = (v) => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
  // SQLite datetime('now') is UTC without a zone marker.
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(v) ? `${v.replace(' ', 'T')}Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};
export const fmtDate = (v) => { const d = asDate(v); return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
export const fmtDateShort = (v) => { const d = asDate(v); return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'; };
export const fmtDateTime = (v) => { const d = asDate(v); return d ? d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'; };
export const fmtMonth = (ym) => { if (!ym) return '—'; const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); };
export function fmtAgo(v) {
  const d = asDate(v);
  if (!d) return '—';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return fmtDate(v);
}
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
export const DAY_LETTER = { mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S' };
export const thisMonth = () => new Date().toISOString().slice(0, 7);

/* ── Status pills: one vocabulary across the app ────────────────────────── */

const STATUS = {
  // subscriptions
  active: ['Active', 'good'], expiring: ['Expiring soon', 'warn'], expired: ['Expired', 'neutral'], cancelled: ['Cancelled', 'bad'],
  pending_payment: ['Awaiting payment', 'warn'], pending_verification: ['Pending verification', 'warn'], verified: ['Verified', 'info'],
  rejected: ['Rejected', 'bad'], excluded: ['Excluded', 'neutral'], pending: ['Pending verification', 'warn'], upcoming: ['Upcoming', 'info'],
  // payments
  awaiting_payment: ['Awaiting payment', 'warn'],
  // services
  draft: ['Draft', 'neutral'], pending_review: ['In review', 'warn'], inactive: ['Inactive', 'neutral'],
  // users
  suspended: ['Suspended', 'bad'], banned: ['Banned', 'bad'],
  // applications
  applied: ['Applied', 'info'], under_review: ['Under review', 'warn'], verification_required: ['Verification required', 'warn'],
  approved: ['Approved', 'good'],
  // agreements
  pending_lister: ['Awaiting lister signature', 'warn'], pending_admin: ['Awaiting Subtize.ai', 'warn'], terminated: ['Terminated', 'bad'],
  // settlements
  processing: ['Processing', 'info'], paid: ['Paid', 'good'], on_hold: ['On hold', 'bad'], not_generated: ['Not generated', 'neutral'],
  // change requests
  approved_change: ['Approved', 'good'],
};
export const statusLabel = (s) => STATUS[s]?.[0] || String(s || '').replace(/_/g, ' ');
export const pill = (status, label = null) => {
  const [text, tone] = STATUS[status] || [status, 'neutral'];
  return `<span class="pill tone-${tone}">${esc(label || text)}</span>`;
};
export const tonePill = (text, tone = 'neutral') => `<span class="pill tone-${tone}">${esc(text)}</span>`;

/* ── Icons (inline so there is no icon-font request) ────────────────────── */

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  compass: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  card: 'M3 6.5h18v11H3zM3 10h18M7 14.5h4',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM6.5 6.5h1v1h-1zM16.5 6.5h1v1h-1zM6.5 16.5h1v1h-1z',
  ticket: 'M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3zM14 4v2M14 10v2M14 16v2',
  gauge: 'M12 21a9 9 0 1 1 9-9M12 12l4-4M3 12h2M12 3v2M19 5l-1.4 1.4',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l13-3v3M16.5 13.5h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  users: 'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14c2.4.7 4 2.6 4 6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  logout: 'M14.5 8V5.5h-10v13h10V16M9.5 12h11m0 0-3-3m3 3-3 3',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  checkCircle: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM8 12.5l2.7 2.7L16 9.5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3',
  micOff: 'M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.9-.8M5.5 11.5a6.5 6.5 0 0 0 10.6 5M18.5 11.5a6.4 6.4 0 0 1-.6 2.7M12 18v3',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  navigation: 'M3 11l18-8-8 18-2-8z',
  calendar: 'M4 5.5h16v15H4zM4 10h16M8.5 3v4M15.5 3v4',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5.5l3.5 2',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
  percent: 'M19 5 5 19M7 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM17 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  filter: 'M3 5h18l-7 8.5V20l-4-2v-4.5z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  download: 'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19.5h16',
  upload: 'M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 19.5h16',
  share: 'M16 6a2.5 2.5 0 1 0 0-.01zM6 12a2.5 2.5 0 1 0 0-.01zM16 18a2.5 2.5 0 1 0 0-.01zM8.2 11l5.6-3.5M8.2 13l5.6 3.5',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  mail: 'M3.5 5.5h17v13h-17zM3.5 6.5l8.5 6 8.5-6',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  lock: 'M6.5 10.5h11v9h-11zM8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5',
  eye: 'M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6 0 9.5 7 9.5 7a15 15 0 0 1-2.6 3.4M6.2 6.3C3.9 7.9 2.5 12 2.5 12S6 19 12 19a9 9 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  alert: 'M12 8v5m0 3h.01M10.3 3.8 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 7.5h.01',
  x: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM9 9l6 6M15 9l-6 6',
  trash: 'M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5 7.5 20h9l1-13.5M10 10v6.5M14 10v6.5',
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z',
  chevron: 'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
  back: 'M15 5l-7 7 7 7',
  arrowRight: 'M5 12h14m0 0-6-6m6 6-6 6',
  external: 'M14 4h6v6M20 4 11 13M18 14v6H4V6h6',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  fileCheck: 'M6 3h8l4 4v14H6zM14 3v4h4M9 14l2 2 4-4',
  briefcase: 'M3.5 8.5h17v11h-17zM9 8.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2.5M3.5 13h17',
  store: 'M4 9.5V20h16V9.5M3 9.5 5 4h14l2 5.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM10 20v-5h4v5',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3',
  signature: 'M3 17c3-1 4-9 7-9s-1 9 2 9 3-5 5-5 2 3 4 3M3 21h18',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0zM8 21h8',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  ban: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM5.6 5.6l12.8 12.8',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4.5v15l13-7.5z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7C10 3 6.5 4 7.5 6s4.5 1 4.5 1zM12 7c2-4 5.5-3 4.5-1S12 7 12 7z',
  zap: 'M13 2 4 14h7l-1 8 9-12h-7z',
  smartphone: 'M7 2.5h10v19H7zM11 18.5h2',
  inbox: 'M3.5 5.5h17v13h-17zM3.5 13h5l1.5 2.5h4L15.5 13h5',
  globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  // Categories
  dumbbell: 'M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11',
  lotus: 'M12 20c-4 0-8-2-9-6 3 0 5.5 1 7 2.5M12 20c4 0 8-2 9-6-3 0-5.5 1-7 2.5M12 20c-2-2-3-5-3-8 0-3 1.5-6 3-8 1.5 2 3 5 3 8 0 3-1 6-3 8z',
  utensils: 'M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 3c-2 1.5-3 4-3 7h3v11',
  shirt: 'M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z',
  car: 'M5 16h14v-4l-2-5H7l-2 5zM3 16h18v3H3zM7.5 16v3M16.5 16v3M7 12h10',
  book: 'M4 5a2 2 0 0 1 2-2h14v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 1h14v-3',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  guitar: 'M14 10l6-6M18 2l4 4M11.5 9.5a4 4 0 0 0-5.6.1c-.8.8-1 1.9-.9 2.9-1.4.2-2.6.9-3 2.1-.8 2.4 2 5.2 4.4 4.4 1.2-.4 1.9-1.6 2.1-3 1 .1 2.1-.1 2.9-.9a4 4 0 0 0 .1-5.6zM9 15a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
  waves: 'M2 7c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2M2 12c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2M2 17c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2',
  desk: 'M3 8h18M5 8v12M19 8v12M14 8v6h5M9 4h6v4H9z',
  milk: 'M8 2h8M9 2v3L7 9v13h10V9l-2-4V2M7 13h10',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8M9 18h6',
  paw: 'M12 13c-3 0-5 3-5 5.5 0 1.5 1 2.5 2.5 2.5 1 0 1.7-.5 2.5-.5s1.5.5 2.5.5c1.5 0 2.5-1 2.5-2.5 0-2.5-2-5.5-5-5.5zM5.5 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18.5 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM15 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
};

export const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.grid}"/></svg>`;

export const BRAND_MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 7.4c-.9-1.4-2.4-2.2-4.2-2.2-2.4 0-4 1.2-4 2.9 0 1.8 1.4 2.5 4.1 3 2.8.6 4.3 1.4 4.3 3.3 0 1.8-1.7 3.1-4.3 3.1-2 0-3.6-.8-4.6-2.2"/></svg>';
export const brand = (href = '/') => `<a class="brand" href="${href}" aria-label="Subtize.ai home"><span class="mark">${BRAND_MARK}</span><span>Subtize<span class="tld">.ai</span></span></a>`;

/* ── Toasts ─────────────────────────────────────────────────────────────── */

export function toast(message, tone = 'good', ms = 4200) {
  let host = $('.toasts');
  if (!host) { host = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const ic = tone === 'bad' ? 'alert' : tone === 'info' ? 'info' : 'checkCircle';
  const t = el('div', { class: `toast ${tone}`, html: `${icon(ic)}<div>${esc(message)}</div>` });
  host.append(t);
  setTimeout(() => t.remove(), ms);
}

/* ── Dialogs ────────────────────────────────────────────────────────────── */

/**
 * Opens a modal. `body` is an HTML string or node. Resolves with whatever
 * `onSubmit` returns (or true for the confirm button), or null if dismissed.
 * If onSubmit throws, its message is shown and the dialog stays open.
 */
export function modal({ title, body = '', confirm = 'Confirm', cancel = 'Cancel', tone = 'primary', wide = false, onSubmit = null, onOpen = null, hideConfirm = false }) {
  return new Promise((resolve) => {
    const back = el('div', { class: 'modal-backdrop' });
    const box = el('form', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, novalidate: true });
    box.innerHTML = `
      <div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="btn btn-ghost btn-icon btn-sm" data-x aria-label="Close">${icon('close')}</button></div>
      <div class="modal-body"></div>
      <div class="modal-err" hidden style="padding:0 22px 12px"></div>
      <div class="modal-foot">
        ${cancel ? `<button type="button" class="btn btn-secondary" data-x>${esc(cancel)}</button>` : ''}
        ${hideConfirm ? '' : `<button type="submit" class="btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}">${esc(confirm)}</button>`}
      </div>`;
    const bodyEl = $('.modal-body', box);
    if (body instanceof Node) bodyEl.append(body); else bodyEl.innerHTML = body;
    back.append(box);
    document.body.append(back);

    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
    $$('[data-x]', box).forEach((b) => b.addEventListener('click', () => close(null)));
    box.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', box);
      const err = $('.modal-err', box);
      err.hidden = true;
      if (!onSubmit) return close(true);
      btn.classList.add('is-loading');
      try {
        const v = await onSubmit(box);
        close(v === undefined ? true : v);
      } catch (ex) {
        err.hidden = false;
        err.innerHTML = `<div class="panel-note danger">${icon('alert')}<div>${esc(ex.message || ex)}</div></div>`;
      } finally { btn?.classList.remove('is-loading'); }
    });
    onOpen?.(box, close);
    ($('input, textarea, select', bodyEl) || $('button[type=submit]', box))?.focus();
  });
}

/**
 * Confirmation for destructive or important actions. With `reason`, asks for
 * a note and resolves with it; with `typeToConfirm`, the user must type a word.
 */
export function confirmAction({ title, message, confirm = 'Confirm', tone = 'danger', reason = false, reasonLabel = 'Reason', reasonRequired = true, typeToConfirm = null }) {
  const body = `
    <p>${message}</p>
    ${reason ? `<div class="field mt-16"><label for="cf-reason">${esc(reasonLabel)}${reasonRequired ? '' : ' <span class="muted">(optional)</span>'}</label><textarea id="cf-reason" class="textarea" name="reason" rows="3"></textarea></div>` : ''}
    ${typeToConfirm ? `<div class="field mt-16"><label for="cf-type">Type <b class="mono">${esc(typeToConfirm)}</b> to confirm</label><input id="cf-type" class="input" name="typed" autocomplete="off"></div>` : ''}`;
  return modal({
    title, body, confirm, tone,
    onSubmit: (form) => {
      const r = form.elements.reason?.value.trim();
      if (reason && reasonRequired && (!r || r.length < 3)) throw new Error(`Please add a ${reasonLabel.toLowerCase()}.`);
      if (typeToConfirm && form.elements.typed.value.trim().toUpperCase() !== typeToConfirm.toUpperCase()) throw new Error(`Type ${typeToConfirm} to confirm.`);
      return reason ? (r || '') : true;
    },
  });
}

/* ── Misc ───────────────────────────────────────────────────────────────── */

export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) {
    if (v instanceof File) continue;
    if (k in out) out[k] = [].concat(out[k], v); else out[k] = v;
  }
  return out;
}

/** Marks the field the API complained about (errors carry details.field). */
export function showFieldError(form, err) {
  $$('.is-invalid', form).forEach((n) => n.classList.remove('is-invalid'));
  $$('.field .error[data-auto]', form).forEach((n) => n.remove());
  const name = err?.details?.field;
  const input = name && form.elements[name];
  const target = input instanceof RadioNodeList ? input[0] : input;
  if (target?.classList) {
    target.classList.add('is-invalid');
    target.closest('.field')?.append(el('div', { class: 'error', 'data-auto': '1', text: err.message }));
    target.focus?.();
    return true;
  }
  return false;
}

export async function copyText(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); } catch { toast('Could not copy. Select and copy it manually.', 'bad'); }
}

/** Busy state for a button while an async action runs. */
export async function busy(btn, fn) {
  btn?.classList.add('is-loading');
  try { return await fn(); } finally { btn?.classList.remove('is-loading'); }
}

export const setTitle = (t) => { document.title = t ? `${t} · Subtize.ai` : 'Subtize.ai'; };
