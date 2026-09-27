/* Helpers shared by every admin console screen. */
import { api } from '../../api.js';
import { currentRoute, setBadge } from '../../shell.js';
import { $, $$, esc, icon, inr, modal, pill, showFieldError, toast, tonePill } from '../../ui.js';
import { emptyState } from '../../components.js';

/* ── Mounting and events ───────────────────────────────────────────────── */

/**
 * Renders a screen into a fresh root inside #view. Listeners are attached to
 * that root, so they disappear with it on the next route change.
 */
export function mount(view, markup) {
  view.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'adm';
  root.innerHTML = markup;
  view.append(root);
  return root;
}

/** Delegated listener: on(root, 'click', '[data-act=verify]', (e, btn) => …). */
export function on(root, type, selector, fn) {
  root.addEventListener(type, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  });
}

/** Updates the hash query without re-rendering the route (for live search boxes). */
export function setQuery(patch) {
  const { path, query } = currentRoute();
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v == null) query.delete(k); else query.set(k, v);
  }
  const qs = query.toString();
  history.replaceState(null, '', `#${path}${qs ? `?${qs}` : ''}`);
}

/** Builds a hash link that keeps the current query except for the given overrides. */
export function hrefWith(path, query, patch) {
  const q = new URLSearchParams(query);
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v == null) q.delete(k); else q.set(k, v);
  }
  const qs = q.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

/** Tabs that keep other filters (search, category) in the link. */
export function filterTabs(items, active, path, query, key = 'tab') {
  return `<div class="tabs" role="tablist">${items.map((t) => `<a role="tab" class="tab ${t.key === active ? 'active' : ''}" aria-selected="${t.key === active}"
    href="${hrefWith(path, query, { [key]: t.key === 'all' ? '' : t.key })}">${esc(t.label)}${t.count != null ? `<span class="count">${t.count}</span>` : ''}</a>`).join('')}</div>`;
}

/* ── Small renderers ───────────────────────────────────────────────────── */

export const money = (p) => `<span class="num">${inr(p)}</span>`;
export const mono = (s) => (s ? `<span class="mono">${esc(s)}</span>` : '<span class="muted">—</span>');
export const dash = '<span class="muted">—</span>';
export const orDash = (s) => (s == null || s === '' ? dash : esc(s));

export const copyBtn = (text, label = 'Copy') => (text
  ? `<button type="button" class="btn btn-ghost btn-icon btn-sm adm-copy" data-copy="${esc(text)}" title="${esc(label)}" aria-label="${esc(label)}">${icon('copy', 'sm')}</button>`
  : '');

export const roleLabel = (r) => ({ admin: 'Admin', lister: 'Lister', user: 'Member' }[r] || r);
export const rolePill = (r) => tonePill(roleLabel(r), r === 'admin' ? 'info' : r === 'lister' ? 'good' : 'neutral');
export const userStatusPill = (s) => (s === 'inactive' ? tonePill('Inactive', 'neutral') : pill(s));
export const yesNo = (b) => (b ? tonePill('Yes', 'good') : tonePill('No', 'neutral'));

export const ACTIVATION = {
  activated: ['Activated', 'good'],
  awaiting_activation: ['Awaiting activation', 'warn'],
  not_activated: ['Not activated', 'neutral'],
  pending: ['Pending', 'neutral'],
};
export const activationPill = (a) => tonePill(...(ACTIVATION[a] || [a, 'neutral']));

export const appStatusPill = (s) => (s ? pill(s) : tonePill('No application', 'neutral'));
export const agreementPill = (s) => (s ? pill(s) : tonePill('No agreement', 'neutral'));

export function kv(pairs) {
  return `<dl class="kv">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v == null || v === '' ? dash : v}</dd>`).join('')}</dl>`;
}

export function card(title, body, { actions = '', ic = null, cls = '' } = {}) {
  return `<section class="card ${cls}">
    <div class="card-head"><h3>${ic ? `<span class="icon-tile sm">${icon(ic)}</span>` : ''}${esc(title)}</h3>${actions ? `<div class="row wrap adm-card-actions">${actions}</div>` : ''}</div>
    ${body}
  </section>`;
}

export const searchBox = (value = '', placeholder = 'Search', name = 'q') => `
  <label class="input-group adm-search"><span class="sr-only">${esc(placeholder)}</span>${icon('search')}
    <input class="input" type="search" name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" data-search></label>`;

export const loadingRow = '<div class="loading">Loading…</div>';

/**
 * Table with data-labels so it can collapse into cards on phones.
 * cols: [{ label, render(row) → html, cls?: 'right'|'nowrap', key? }]
 */
export function table(cols, rows, { empty = null, rowAttrs = null, cls = '' } = {}) {
  if (!rows.length) {
    return empty ?? emptyState({ ic: 'inbox', title: 'Nothing here', text: 'No records match these filters.' });
  }
  return `<div class="table-wrap adm-table-wrap"><table class="table adm-table ${cls}">
    <thead><tr>${cols.map((c) => `<th class="${c.cls || ''}" scope="col">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr ${rowAttrs ? rowAttrs(r) : ''}>${cols.map((c) => `<td class="${c.cls || ''}" data-label="${esc(c.label)}"><div class="adm-cell">${c.render(r)}</div></td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

/* ── Forms ─────────────────────────────────────────────────────────────── */

/**
 * The API names the invalid field by its label ("Service name"), while
 * showFieldError looks inputs up by name. `map` translates label → input name.
 */
export function fieldError(form, err, map = {}) {
  const f = err?.details?.field;
  const name = map[f] || f;
  const shown = name ? showFieldError(form, { ...err, details: { ...err.details, field: name } }) : false;
  const box = $('[data-form-error]', form);
  if (box) {
    box.hidden = false;
    box.innerHTML = `<div class="panel-note danger">${icon('alert')}<div>${esc(err.message)}</div></div>`;
    if (!shown) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if (!shown) toast(err.message, 'bad');
}

export function clearFormError(form) {
  const box = $('[data-form-error]', form);
  if (box) { box.hidden = true; box.innerHTML = ''; }
  $$('.is-invalid', form).forEach((n) => n.classList.remove('is-invalid'));
  $$('.field .error[data-auto]', form).forEach((n) => n.remove());
}

export const formErrorSlot = '<div data-form-error hidden></div>';

/** Paise → rupee string for a form field. */
export const rupeesValue = (p) => (p == null ? '' : String(Math.round(p) / 100));

/** A read-only notice dialog (for blocking rules the server explains). */
export function notice(title, message, tone = 'danger') {
  return modal({
    title,
    body: `<div class="panel-note ${tone}">${icon(tone === 'good' ? 'checkCircle' : 'alert')}<div>${esc(message)}</div></div>`,
    cancel: 'Close',
    hideConfirm: true,
  });
}

/** Runs an API call from a button with busy state and toasts. Returns the result or null. */
export async function run(btn, fn, success) {
  btn?.classList.add('is-loading');
  try {
    const out = await fn();
    if (success) toast(typeof success === 'function' ? success(out) : success);
    return out ?? true;
  } catch (err) {
    toast(err.message || 'Something went wrong.', 'bad');
    return null;
  } finally {
    btn?.classList.remove('is-loading');
  }
}

/* ── Month helpers ─────────────────────────────────────────────────────── */

export const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const validMonth = (m) => (/^\d{4}-\d{2}$/.test(m || '') ? m : thisMonth());
export const monthPicker = (value) => `<label class="adm-month"><span class="muted small">Month</span>
  <input class="input" type="month" name="month" value="${esc(value)}" max="${thisMonth()}" data-month></label>`;

/* ── Nav badges ────────────────────────────────────────────────────────── */

let badgeTimer = null;
/** Refreshes the sidebar counts from the dashboard metrics. Cheap to call after any action. */
export async function refreshBadges(metrics = null) {
  try {
    const m = metrics || (await api.get('/api/admin/dashboard')).metrics;
    setBadge('/payments', m.pendingPayments);
    setBadge('/applications', m.pendingApplications);
    setBadge('/agreements', m.pendingAgreements);
    setBadge('/services', m.pendingChanges + m.servicesInReview);
    return m;
  } catch { return null; }
}
export function scheduleBadgeRefresh() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => refreshBadges(), 400);
}

/* ── Labels ────────────────────────────────────────────────────────────── */

export const SERVICE_STATUSES = [
  { key: 'active', label: 'Active' },
  { key: 'pending_review', label: 'In review' },
  { key: 'draft', label: 'Draft' },
  { key: 'inactive', label: 'Inactive' },
];

export const DOC_KIND = { address_proof: 'Address proof', id_proof: 'Business / government ID', business_doc: 'Business document', payment_qr: 'Payment QR' };

export const planLabel = (m) => (Number(m) === 1 ? '1 month' : `${m} months`);

export const changeFieldLabel = (f) => ({ monthly_price: 'Monthly price', plan_months: 'Plan durations' }[f] || f);
export function changeValue(field, value) {
  if (value == null || value === '') return dash;
  if (field === 'monthly_price') return `<span class="num">${inr(Number(value))}</span>`;
  if (field === 'plan_months') return esc(String(value).split(',').map((m) => planLabel(m.trim())).join(', '));
  return esc(value);
}
