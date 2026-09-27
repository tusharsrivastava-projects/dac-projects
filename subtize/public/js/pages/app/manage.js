/* #/manage — every subscription in one management table with actions. */
import { api } from '../../api.js';
import { emptyState } from '../../components.js';
import { go, pageHead } from '../../shell.js';
import { $, $$, esc, fmtDate, icon, inr, pill } from '../../ui.js';
import {
  activationLabel, canRenew, cancelSubscription, dayStrip, excludeSubscription, isEnded, mountPage, onAct,
  openTodayPill, subPill,
} from './common.js';

const VIEWS = [
  { key: 'current', label: 'Current', test: (s) => ['active', 'expiring', 'pending'].includes(s.bucket) },
  { key: 'ended', label: 'Ended', test: (s) => ['expired', 'cancelled'].includes(s.bucket) },
  { key: 'excluded', label: 'Excluded', test: (s) => s.bucket === 'excluded' },
  { key: 'all', label: 'All', test: () => true },
];

function usageCell(s) {
  const u = s.usage;
  if (!u) return '<span class="muted">—</span>';
  if (u.allowed == null) return `<span class="num">${u.used}</span> <span class="muted small">${esc(u.unit)} · unlimited</span>`;
  const pct = Math.min(100, Math.round((u.used / Math.max(1, u.allowed)) * 100));
  return `<div class="mini-usage"><span class="num">${u.used}/${u.allowed}</span> <span class="muted small">${esc(u.unit)}</span>
    <div class="meter ${pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : ''}"><span style="width:${pct}%"></span></div></div>`;
}

const dateCell = (d) => {
  if (!d) return '—';
  const [a, b] = fmtDate(d).split(/ (?=\d{4}$)/);
  return `<span class="nowrap">${esc(a)}</span> <span class="muted">${esc(b || '')}</span>`;
};

function row(s) {
  const p = s.payment;
  return `<tr>
    <td data-label="Service"><a class="cell-title" href="#/subscriptions/${esc(s.id)}">${esc(s.service.name)}</a><div class="cell-sub">${subPill(s)}</div></td>
    <td data-label="Start date">${dateCell(s.startDate)}</td>
    <td data-label="Expiry date">${dateCell(s.endDate)}</td>
    <td data-label="Amount paid" class="num nowrap">${p ? inr(p.finalAmount) : '—'}</td>
    <td data-label="Discount" class="num nowrap">${p?.discount ? `${inr(p.discount)}${p.couponCode ? `<div class="cell-sub mono">${esc(p.couponCode)}</div>` : ''}` : '—'}</td>
    <td data-label="Payment">${p ? pill(p.status, p.status === 'pending' ? 'Pending' : p.status === 'awaiting_payment' ? 'Unpaid' : null) : '—'}</td>
    <td data-label="Activation" class="small">${esc(activationLabel(s))}</td>
    <td data-label="Usage">${usageCell(s)}</td>
    <td data-label="Remaining" class="num nowrap">${s.status === 'active' ? `${s.remainingDays} d` : '—'}</td>
    <td data-label="Available days">${dayStrip(s.service.availableDays)}<div class="mt-8">${s.service.status === 'active' ? openTodayPill(s.service.availableDays) : pill('inactive', 'Unavailable')}</div></td>
    <td data-label="Actions" class="actions-cell">
      <div class="row" style="--gap:6px">
        <a class="btn btn-ghost btn-sm" href="#/subscriptions/${esc(s.id)}" title="View" aria-label="View">${icon('eye', 'sm')}<span class="lbl">View</span></a>
        ${canRenew(s) ? `<a class="btn btn-ghost btn-sm" href="#/checkout/${s.service.id}" title="Renew">${icon('refresh', 'sm')}<span class="lbl">Renew</span></a>` : ''}
        ${!isEnded(s) ? `<button type="button" class="btn btn-ghost btn-sm danger-text" data-act="cancel" data-id="${esc(s.id)}" title="Cancel">${icon('x', 'sm')}<span class="lbl">Cancel</span></button>` : ''}
        ${!s.excluded ? `<button type="button" class="btn btn-ghost btn-sm" data-act="exclude" data-id="${esc(s.id)}" title="Exclude from Subtize.ai">${icon('ban', 'sm')}<span class="lbl">Exclude</span></button>` : ''}
      </div>
    </td>
  </tr>`;
}

export async function renderManage({ view, query, isCurrent }) {
  const { subscriptions } = await api.get('/api/me/subscriptions');
  if (!isCurrent()) return;
  let active = VIEWS.some((v) => v.key === query.get('view')) ? query.get('view') : 'current';

  const page = mountPage(view, `
    ${pageHead('Manage Subscriptions', 'Cancel, exclude or review everything from one place. Changes apply instantly.')}
    <div class="row between wrap mb-16" style="--gap:12px">
      <div class="segmented" role="tablist" aria-label="Show">${VIEWS.map((v) => `<button type="button" role="tab" data-view="${v.key}" class="${v.key === active ? 'active' : ''}">${esc(v.label)} <span class="muted">${subscriptions.filter(v.test).length}</span></button>`).join('')}</div>
      <div class="input-group manage-search">${icon('search')}<input class="input" type="search" placeholder="Filter by service" aria-label="Filter by service"></div>
    </div>
    <div data-table></div>
    <div class="panel-note mt-16 small">${icon('info')}<div><b>Cancel</b> ends a plan now. <b>Exclude from Subtize.ai</b> hides the service everywhere in the app; you can keep an active plan until its end date or cancel it at the same time.</div></div>`);

  const host = $('[data-table]', page);
  const input = $('input[type=search]', page);
  const draw = () => {
    const needle = input.value.trim().toLowerCase();
    const list = subscriptions.filter(VIEWS.find((v) => v.key === active).test)
      .filter((s) => !needle || s.service.name.toLowerCase().includes(needle) || s.id.toLowerCase().includes(needle));
    host.innerHTML = list.length ? `
      <div class="table-wrap"><table class="table rtable manage-table">
        <thead><tr><th>Service</th><th>Start</th><th>Expiry</th><th>Amount</th><th>Discount</th><th>Payment</th><th>Activation</th><th>Usage</th><th>Days left</th><th>Availability · today</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${list.map(row).join('')}</tbody></table></div>`
      : emptyState({ ic: 'layers', title: needle ? 'No matches' : 'Nothing here', text: needle ? 'No subscription matches that name.' : 'No subscriptions in this view.', action: '<a class="btn btn-primary" href="#/explore">Explore services</a>' });
  };
  draw();

  input.addEventListener('input', draw);
  page.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]');
    if (!v) return;
    active = v.dataset.view;
    $$('[data-view]', page).forEach((b) => b.classList.toggle('active', b === v));
    draw();
  });
  const find = (btn) => subscriptions.find((x) => x.id === btn.dataset.id);
  onAct(page, {
    cancel: async (btn) => { const s = find(btn); if (s && await cancelSubscription(s)) go(`/manage?view=${active}`); },
    exclude: async (btn) => { const s = find(btn); if (s && await excludeSubscription(s)) go(`/manage?view=${active}`); },
  });
}
