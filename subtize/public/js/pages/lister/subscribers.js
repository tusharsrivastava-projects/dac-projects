/* #/subscribers and #/cancellations — who subscribes to the lister's services. */
import { api } from '../../api.js';
import { emptyState, usageMeter } from '../../components.js';
import { pageHead } from '../../shell.js';
import { $, esc, fmtDate, fmtMonth, icon, inr, pill, thisMonth } from '../../ui.js';
import { dataTable, downloadCsv, fail, monthPicker, monthsLabel, rupees, wireMonthPicker } from './common.js';

const STATUSES = [['', 'All statuses'], ['active', 'Active'], ['expired', 'Expired'], ['cancelled', 'Cancelled']];

const myServices = () => api.get('/api/lister/services').then((r) => r.services);

const period = (r) => `<span class="nowrap">${esc(fmtDate(r.startDate))}</span> – <span class="nowrap">${esc(fmtDate(r.endDate))}</span>`;
const who = (r) => `<div class="cell-title">${esc(r.subscriber)}</div><div class="cell-sub mono">${esc(r.id)}</div>`;

/* ── Subscribers ────────────────────────────────────────────────────────── */

export async function renderSubscribers({ view, query, isCurrent }) {
  const services = await myServices().catch(() => []);
  if (!isCurrent()) return;
  const f = { month: query.get('month') || thisMonth(), serviceId: query.get('serviceId') || '', status: query.get('status') || '' };

  view.innerHTML = `
    ${pageHead('Subscribers', 'Members whose plans run in the selected month. Contact details stay private; check members in with their digital card.',
      `<button class="btn btn-secondary" id="btn-csv" type="button" disabled>${icon('download', 'sm')} Export CSV</button>`)}
    <div class="card filter-bar">
      ${monthPicker('sub-month', f.month)}
      <div class="field"><label for="sub-svc">Service</label>
        <select class="select" id="sub-svc"><option value="">All services</option>${services.map((s) => `<option value="${s.id}" ${String(s.id) === f.serviceId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="sub-status">Status</label>
        <select class="select" id="sub-status">${STATUSES.map(([k, l]) => `<option value="${k}" ${k === f.status ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div id="sub-summary" class="summary-line"></div>
    <div id="sub-list"><div class="loading">Loading subscribers…</div></div>`;

  let rows = [];
  const list = $('#sub-list', view);
  const load = async () => {
    list.innerHTML = '<div class="loading">Loading subscribers…</div>';
    $('#btn-csv', view).disabled = true;
    // Keep filters in the URL without re-rendering, so the page can be shared or reloaded.
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/subscribers${q ? `?${q}` : ''}`);
    try {
      const data = await api.get('/api/lister/subscribers', f);
      if (!isCurrent()) return;
      rows = data.subscribers;
      const total = rows.reduce((n, r) => n + (r.amount || 0), 0);
      const active = rows.filter((r) => r.status === 'active').length;
      $('#sub-summary', view).innerHTML = rows.length
        ? `<b>${rows.length}</b> subscriber${rows.length === 1 ? '' : 's'} in ${esc(fmtMonth(data.month))} · <b>${active}</b> active · plan value <b>${inr(total)}</b>`
        : '';
      $('#btn-csv', view).disabled = !rows.length;
      list.innerHTML = rows.length ? dataTable(rows, [
        { label: 'Subscriber', cell: who },
        { label: 'Service', cell: (r) => esc(r.service) },
        { label: 'Plan', cell: (r) => esc(monthsLabel(r.months)), cls: 'nowrap' },
        { label: 'Status', cell: (r) => pill(r.status) },
        { label: 'Period', cell: period },
        { label: 'Amount', cell: (r) => (r.amount != null ? `<span class="num">${inr(r.amount)}</span>` : '<span class="muted">—</span>'), cls: 'right' },
        { label: 'Usage', cell: (r) => (r.usage ? `<div class="usage-cell">${usageMeter(r.usage)}</div>` : '<span class="muted small">—</span>'), cls: 'usage-col' },
      ]) : emptyState({ ic: 'users', title: 'No subscribers found', text: `Nobody matches these filters for ${esc(fmtMonth(f.month))}. Try another month or clear the filters.` });
    } catch (err) {
      if (!isCurrent()) return;
      list.innerHTML = emptyState({ ic: 'alert', title: 'Could not load subscribers', text: esc(err.message) });
      fail(err);
    }
  };

  wireMonthPicker(view, 'sub-month', (v) => { f.month = v; load(); });
  $('#sub-svc', view).addEventListener('change', (e) => { f.serviceId = e.target.value; load(); });
  $('#sub-status', view).addEventListener('change', (e) => { f.status = e.target.value; load(); });
  $('#btn-csv', view).addEventListener('click', () => {
    downloadCsv(`subtize-subscribers-${f.month}.csv`,
      ['Subscription ID', 'Subscriber', 'Service', 'Plan months', 'Status', 'Start date', 'End date', 'Amount (INR)', 'Usage used', 'Usage allowed', 'Usage unit'],
      rows.map((r) => [r.id, r.subscriber, r.service, r.months, r.status, r.startDate, r.endDate, r.amount != null ? rupees(r.amount) : '',
        r.usage?.used ?? '', r.usage ? (r.usage.allowed ?? 'Unlimited') : '', r.usage?.unit ?? '']));
  });
  load();
}

/* ── Cancellations ──────────────────────────────────────────────────────── */

export async function renderCancellations({ view, query, isCurrent }) {
  const f = { month: query.has('month') ? query.get('month') : thisMonth() };
  view.innerHTML = `
    ${pageHead('Cancellations', 'Subscriptions members cancelled. Cancellations and any adjustments show up in your monthly settlement.')}
    <div class="card filter-bar">${monthPicker('can-month', f.month, { allowAll: true, label: 'Cancelled in' })}</div>
    <div id="can-summary" class="summary-line"></div>
    <div id="can-list"><div class="loading">Loading cancellations…</div></div>`;

  const list = $('#can-list', view);
  const load = async () => {
    list.innerHTML = '<div class="loading">Loading cancellations…</div>';
    history.replaceState(null, '', `#/cancellations${f.month !== thisMonth() ? `?month=${f.month}` : ''}`);
    try {
      const { cancellations: rows } = await api.get('/api/lister/cancellations', { month: f.month });
      if (!isCurrent()) return;
      const label = f.month ? fmtMonth(f.month) : 'all time';
      $('#can-summary', view).innerHTML = rows.length
        ? `<b>${rows.length}</b> cancellation${rows.length === 1 ? '' : 's'} in ${esc(label)} · plan value <b>${inr(rows.reduce((n, r) => n + (r.amount || 0), 0))}</b>` : '';
      list.innerHTML = rows.length ? dataTable(rows, [
        { label: 'Subscriber', cell: who },
        { label: 'Service', cell: (r) => esc(r.service) },
        { label: 'Cancelled', cell: (r) => `<span class="nowrap">${esc(fmtDate(r.cancelledAt))}</span>` },
        { label: 'Reason', cell: (r) => (r.cancelReason ? `<span class="soft">${esc(r.cancelReason)}</span>` : '<span class="muted">No reason given</span>') },
        { label: 'Plan', cell: (r) => `${esc(monthsLabel(r.months))}<div class="cell-sub">${esc(fmtDate(r.startDate))} – ${esc(fmtDate(r.endDate))}</div>` },
        { label: 'Amount', cell: (r) => (r.amount != null ? `<span class="num">${inr(r.amount)}</span>` : '—'), cls: 'right' },
      ]) : emptyState({ ic: 'checkCircle', title: 'No cancellations', text: f.month ? `Nobody cancelled in ${esc(label)}.` : 'Nobody has cancelled a subscription to your services.' });
    } catch (err) {
      if (!isCurrent()) return;
      list.innerHTML = emptyState({ ic: 'alert', title: 'Could not load cancellations', text: esc(err.message) });
    }
  };
  wireMonthPicker(view, 'can-month', (v) => { f.month = v; load(); });
  load();
}
