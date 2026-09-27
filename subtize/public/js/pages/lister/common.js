/* Shared state and small helpers for the lister dashboard. */
import { api } from '../../api.js';
import { $, esc, fmtMonth, icon, inr, pill, showFieldError, thisMonth, toast } from '../../ui.js';

/* ── Standing (verification + agreement gate) ───────────────────────────── */

export const state = {
  user: null,
  standing: null,
  commission: 20,
  meta: null,
  shell: null,
};

const listeners = new Set();
export const onStanding = (fn) => listeners.add(fn);

export function setStanding(standing) {
  if (!standing) return;
  state.standing = standing;
  listeners.forEach((fn) => fn(standing));
}

export async function refreshStanding() {
  const { standing } = await api.get('/api/lister/agreement');
  setStanding(standing);
  return standing;
}

/** Why a lister cannot add services yet, in plain words (or null when they can). */
export function publishBlocker(standing = state.standing) {
  if (!standing || standing.canPublish) return null;
  switch (standing.nextStep) {
    case 'sign_agreement': return 'Sign the Subtize.ai Lister Agreement to start adding services.';
    case 'await_countersign': return 'You have signed the agreement. You can add services as soon as Subtize.ai countersigns it.';
    case 'agreement_pending': return 'Subtize.ai is preparing your Lister Agreement. You can add services once it is issued and signed.';
    case 'agreement_inactive': return 'Your Lister Agreement is not active, so new services cannot be added. Contact Subtize.ai support.';
    default: return 'Your lister verification is not complete yet, so new services cannot be added.';
  }
}

/** The onboarding banner shown above every page until the agreement is active. */
export function bannerHtml(standing = state.standing) {
  if (!standing || !standing.nextStep) return '';
  const step = standing.nextStep;
  if (step === 'sign_agreement') {
    return `<div class="lister-banner action" role="region" aria-label="Action needed">
      <div class="icon-tile">${icon('signature')}</div>
      <div class="grow"><b>Sign your Lister Agreement to go live</b>
        <p>Subtize.ai has verified your business${standing.verificationId ? ` (Verification ID <span class="mono">${esc(standing.verificationId)}</span>)` : ''}. Review and e-sign the agreement, including the ${state.commission}% platform commission, to start listing services.</p></div>
      <a class="btn btn-primary" href="#/agreement" data-go-sign>${icon('signature', 'sm')} Review &amp; sign</a>
    </div>`;
  }
  if (step === 'await_countersign') {
    return `<div class="lister-banner info" role="status">
      <div class="icon-tile">${icon('clock')}</div>
      <div class="grow"><b>Waiting for Subtize.ai to countersign</b>
        <p>Thanks for signing. Subtize.ai will countersign your agreement shortly; you can add services as soon as it is active.</p></div>
      <a class="btn btn-secondary" href="#/agreement">View agreement</a>
    </div>`;
  }
  const text = step === 'agreement_inactive'
    ? 'Your Lister Agreement is no longer active. Existing subscribers are honoured, but you cannot add services. Contact Subtize.ai support for help.'
    : step === 'agreement_pending'
      ? 'Your business is verified. Subtize.ai is preparing your Lister Agreement and will notify you when it is ready to sign.'
      : 'Your lister verification is not complete. Some features stay locked until Subtize.ai approves your application.';
  return `<div class="lister-banner warn" role="status">
    <div class="icon-tile">${icon('alert')}</div>
    <div class="grow"><b>${step === 'agreement_inactive' ? 'Agreement inactive' : step === 'agreement_pending' ? 'Agreement on its way' : 'Verification pending'}</b><p>${text}</p></div>
    <a class="btn btn-secondary" href="#/agreement">Agreement</a>
  </div>`;
}

/* ── Meta (categories, locations) ───────────────────────────────────────── */

let metaPromise = null;
export function loadMeta() {
  if (!metaPromise) metaPromise = api.get('/api/meta').then((m) => { state.meta = m; return m; }).catch((e) => { metaPromise = null; throw e; });
  return metaPromise;
}

/* ── Month picker ───────────────────────────────────────────────────────── */

export function monthList(count = 24) {
  const [y, m] = thisMonth().split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** A select with previous / next buttons. `allowAll` adds an "All months" option (value ''). */
export function monthPicker(id, value, { allowAll = false, label = 'Month' } = {}) {
  const months = monthList();
  return `<div class="field month-field">
    <label for="${id}">${esc(label)}</label>
    <div class="month-picker">
      <button type="button" class="btn btn-secondary btn-icon" data-month-step="1" data-for="${id}" aria-label="Previous month">${icon('back')}</button>
      <select class="select" id="${id}">
        ${allowAll ? `<option value="" ${!value ? 'selected' : ''}>All months</option>` : ''}
        ${months.map((m) => `<option value="${m}" ${m === value ? 'selected' : ''}>${esc(fmtMonth(m))}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-secondary btn-icon" data-month-step="-1" data-for="${id}" aria-label="Next month">${icon('chevron')}</button>
    </div>
  </div>`;
}

/** Wires the prev/next buttons of every month picker in `root`; calls onChange(value). */
export function wireMonthPicker(root, id, onChange) {
  const sel = $(`#${id}`, root);
  sel.addEventListener('change', () => onChange(sel.value));
  root.querySelectorAll(`[data-for="${id}"]`).forEach((b) => b.addEventListener('click', () => {
    const i = sel.selectedIndex + Number(b.dataset.monthStep);
    if (i < 0 || i >= sel.options.length) return;
    sel.selectedIndex = i;
    onChange(sel.value);
  }));
}

/* ── Money formula ──────────────────────────────────────────────────────── */

export function formulaHtml({ gross, commission, payable, percent = state.commission, monthLabel = '' }) {
  return `<div class="formula" aria-label="How your payout is calculated">
    <div class="formula-part"><span class="eyebrow">Gross revenue</span><b class="num">${inr(gross)}</b></div>
    <div class="formula-op" aria-hidden="true">−</div>
    <div class="formula-part"><span class="eyebrow">Subtize.ai ${percent}%</span><b class="num">${inr(commission)}</b></div>
    <div class="formula-op" aria-hidden="true">=</div>
    <div class="formula-part result"><span class="eyebrow">Payable to you</span><b class="num">${inr(payable)}</b></div>
  </div>
  <p class="small muted mt-8 mb-0">${monthLabel ? `${esc(monthLabel)}: ` : ''}Subtize.ai retains ${percent}% of the total subscription revenue from your services in a month. The remaining ${100 - percent}% is paid to you through the monthly settlement.</p>`;
}

/* ── Tables ─────────────────────────────────────────────────────────────── */

/**
 * A table that turns into stacked cards under 720px. cols: [{ label, cell(row) -> html, cls, head }].
 * The first column becomes the card title on mobile.
 */
export function dataTable(rows, cols, { rowAttrs = () => '', foot = '' } = {}) {
  return `<div class="table-wrap rtable-wrap"><table class="table rtable">
    <thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr ${rowAttrs(r)}>${cols.map((c) => `<td class="${c.cls || ''}" data-label="${esc(c.label)}"><div class="cv">${c.cell(r)}</div></td>`).join('')}</tr>`).join('')}</tbody>
    ${foot}
  </table></div>`;
}

/* ── CSV ────────────────────────────────────────────────────────────────── */

export function downloadCsv(filename, header, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const rupees = (paise) => (Math.round(Number(paise || 0)) / 100).toFixed(2);

/* ── Misc ───────────────────────────────────────────────────────────────── */

export const svcPill = (status) => pill(status);
export const monthsLabel = (n) => `${n} month${n === 1 ? '' : 's'}`;

export function fail(err) {
  toast(err?.message || 'Something went wrong.', 'bad');
}

/**
 * The API names the offending field by its label ("Short description"), not the request key,
 * so map labels to input names before marking the field. Falls back to a toast.
 */
export function formError(form, err, labels = {}) {
  const f = err?.details?.field;
  const name = (f && (labels[f] || (form.elements[f] ? f : null))) || null;
  if (name && showFieldError(form, { message: err.message, details: { field: name } })) return;
  fail(err);
}

export const FIELD_LABEL = {
  monthly_price: 'Monthly price', plan_months: 'Plan lengths', payment_qr: 'Official payment QR', settlement: 'Settlement details', other: 'Other',
};

export const CR_STATUS = { pending: ['Pending', 'warn'], approved: ['Approved', 'good'], rejected: ['Rejected', 'bad'] };

/** Shows a proposed/current change-request value in human terms. */
export function crValue(field, value) {
  if (value == null || value === '') return '—';
  if (field === 'monthly_price' && /^\d+$/.test(value)) return inr(Number(value));
  if (field === 'plan_months') return String(value).split(',').map((n) => monthsLabel(Number(n))).join(', ');
  return esc(value);
}
