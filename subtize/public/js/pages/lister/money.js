/* #/revenue and #/settlements — what the lister earned and when it is paid. */
import { api } from '../../api.js';
import { emptyState, revenueChart, statTile } from '../../components.js';
import { pageHead } from '../../shell.js';
import { $, esc, fmtDate, fmtMonth, icon, inr, pill, thisMonth } from '../../ui.js';
import { dataTable, downloadCsv, formulaHtml, monthPicker, rupees, state, wireMonthPicker } from './common.js';

const chartRows = (trend) => trend.map((r) => ({ month: r.month, gross: r.gross, commission: r.gross - r.payable, payable: r.payable }));

/* ── Revenue ────────────────────────────────────────────────────────────── */

export async function renderRevenue({ view, query, isCurrent }) {
  let month = query.get('month') || thisMonth();
  view.innerHTML = `
    ${pageHead('Monthly Revenue', 'Revenue counts in the month a member’s payment to the official Subtize.ai QR is verified.',
      '<button class="btn btn-secondary" type="button" id="rev-csv" disabled>' + icon('download', 'sm') + ' Export CSV</button>')}
    <div class="card filter-bar">${monthPicker('rev-month', month)}</div>
    <div id="rev-body"><div class="loading">Loading revenue…</div></div>`;

  let current = null;
  const body = $('#rev-body', view);
  const load = async () => {
    body.innerHTML = '<div class="loading">Loading revenue…</div>';
    history.replaceState(null, '', `#/revenue${month !== thisMonth() ? `?month=${month}` : ''}`);
    const d = await api.get('/api/lister/revenue', { month });
    if (!isCurrent()) return;
    current = d;
    $('#rev-csv', view).disabled = !d.services.length;
    const pct = d.services[0]?.percent ?? state.commission;
    const label = fmtMonth(d.month);
    body.innerHTML = `
      <section class="lister-money-row three">
        ${statTile({ label: 'Gross subscription revenue', value: inr(d.gross), sub: `${d.payments} verified payment${d.payments === 1 ? '' : 's'} in ${esc(label)}`, ic: 'trend' })}
        ${statTile({ label: `Subtize.ai platform commission (${pct}%)`, value: inr(d.commission), sub: 'Retained by Subtize.ai', ic: 'percent' })}
        ${statTile({ label: 'Payable to you', value: inr(d.payable), sub: `Your ${100 - pct}% · settled monthly`, ic: 'wallet', hero: true })}
      </section>
      <div class="card mt-16">${formulaHtml({ gross: d.gross, commission: d.commission, payable: d.payable, percent: pct, monthLabel: label })}</div>

      <h2 class="lister-h2">By service · ${esc(label)}</h2>
      ${d.services.length ? dataTable(d.services, [
        { label: 'Service', cell: (r) => `<a class="cell-title" href="#/services/${r.serviceId}">${esc(r.service)}</a>` },
        { label: 'Payments', cell: (r) => `<span class="num">${r.payments}</span>`, cls: 'right' },
        { label: 'Gross', cell: (r) => `<span class="num">${inr(r.gross)}</span>`, cls: 'right' },
        { label: 'Commission %', cell: (r) => `<span class="num">${r.percent}%</span>`, cls: 'right' },
        { label: 'Commission', cell: (r) => `<span class="num">${inr(r.commission)}</span>`, cls: 'right' },
        { label: 'Payable', cell: (r) => `<b class="num accent">${inr(r.payable)}</b>`, cls: 'right' },
      ], {
        foot: `<tfoot><tr><td data-label="Total"><b>Total</b></td><td class="right num" data-label="Payments">${d.payments}</td><td class="right num" data-label="Gross"><b>${inr(d.gross)}</b></td>
          <td class="right" data-label="Commission %">${pct}%</td><td class="right num" data-label="Commission"><b>${inr(d.commission)}</b></td><td class="right num" data-label="Payable"><b class="accent">${inr(d.payable)}</b></td></tr></tfoot>`,
      }) : emptyState({ ic: 'chart', title: 'No revenue this month', text: `No member payments for your services were verified in ${esc(label)}.` })}

      <h2 class="lister-h2">Last 12 months</h2>
      <div class="trend-split">
        <div class="card">
          <div class="card-head"><h3>${icon('chart')} Monthly revenue</h3><span class="small muted">Gross = your payout + Subtize.ai commission</span></div>
          <div id="rev-chart"></div>
        </div>
        ${trendSummary(d.trend, pct)}
      </div>`;
    revenueChart($('#rev-chart', body), chartRows(d.trend), { payoutLabel: 'Your payout', commissionLabel: `Subtize.ai commission (${pct}%)` });
  };

  const safeLoad = () => load().catch((err) => {
    if (!isCurrent()) return;
    body.innerHTML = emptyState({ ic: 'alert', title: 'Could not load revenue', text: esc(err.message) });
  });
  wireMonthPicker(view, 'rev-month', (v) => { month = v; safeLoad(); });
  $('#rev-csv', view).addEventListener('click', () => {
    if (!current) return;
    downloadCsv(`subtize-revenue-${current.month}.csv`, ['Service', 'Payments', 'Gross (INR)', 'Commission %', 'Commission (INR)', 'Payable (INR)'],
      current.services.map((r) => [r.service, r.payments, rupees(r.gross), r.percent, rupees(r.commission), rupees(r.payable)]));
  });
  await load();
}

function trendSummary(trend, pct) {
  const sum = (k) => trend.reduce((n, r) => n + (r[k] || 0), 0);
  const gross = sum('gross');
  const payout = sum('payable');
  const active = trend.filter((r) => r.gross > 0);
  const best = active.reduce((b, r) => (!b || r.gross > b.gross ? r : b), null);
  return `<div class="card">
    <div class="card-head"><h3>${icon('trend')} 12-month totals</h3></div>
    <dl class="kv">
      <dt>Gross</dt><dd class="num">${inr(gross)}</dd>
      <dt>Commission</dt><dd class="num">${inr(gross - payout)} <span class="muted small">(${pct}%)</span></dd>
      <dt>Your payout</dt><dd class="num accent">${inr(payout)}</dd>
      <dt>Payments</dt><dd class="num">${sum('payments')}</dd>
      <dt>Best month</dt><dd>${best ? `${esc(fmtMonth(best.month))} · ${inr(best.gross)}` : '—'}</dd>
      <dt>Monthly average</dt><dd class="num">${active.length ? inr(Math.round(gross / active.length)) : '—'}</dd>
    </dl>
    <p class="small muted mt-16 mb-0">Average over months with revenue.</p>
  </div>`;
}

/* ── Settlements ────────────────────────────────────────────────────────── */

export async function renderSettlements({ view, isCurrent }) {
  const [{ settlements }, live] = await Promise.all([
    api.get('/api/lister/settlements'),
    api.get('/api/lister/revenue', { month: thisMonth() }).catch(() => null),
  ]);
  if (!isCurrent()) return;
  const paid = settlements.filter((s) => s.status === 'paid');
  const paidTotal = paid.reduce((n, s) => n + s.payable, 0);
  const openTotal = settlements.filter((s) => s.status !== 'paid').reduce((n, s) => n + s.payable, 0);
  const pct = settlements[0]?.percent ?? state.commission;
  const hasCurrent = settlements.some((s) => s.month === thisMonth());

  view.innerHTML = `
    ${pageHead('Settlement', 'Your monthly statements and payouts from Subtize.ai.')}
    <section class="lister-money-row three">
      ${statTile({ label: 'Paid to date', value: inr(paidTotal), sub: `${paid.length} settlement${paid.length === 1 ? '' : 's'} paid`, ic: 'checkCircle', hero: true })}
      ${statTile({ label: 'Awaiting payout', value: inr(openTotal), sub: 'Pending, processing or on hold', ic: 'clock' })}
      ${statTile({ label: `This month so far (${esc(fmtMonth(thisMonth()))})`, value: live ? inr(live.payable) : '—', sub: hasCurrent ? 'Statement generated' : 'Estimate · statement after month end', ic: 'trend' })}
    </section>

    <div class="card mt-16 settle-process">
      <div class="card-head"><h3>${icon('info')} How monthly settlement works</h3></div>
      <ol class="process">
        <li><span class="process-n">1</span><div><b>Month closes</b><p>All member payments verified during the calendar month count towards that month.</p></div></li>
        <li><span class="process-n">2</span><div><b>Statement generated</b><p>Subtize.ai totals the gross revenue from your services and deducts the ${pct}% platform commission.</p></div></li>
        <li><span class="process-n">3</span><div><b>Processing</b><p>The remaining ${100 - pct}% is queued for transfer to the bank account verified during onboarding.</p></div></li>
        <li><span class="process-n">4</span><div><b>Paid</b><p>You see the transfer reference and paid date here. Cancellations or adjustments appear in the statement.</p></div></li>
      </ol>
    </div>

    <h2 class="lister-h2">Statements</h2>
    ${settlements.length ? dataTable(settlements, [
      { label: 'Month', cell: (s) => `<b>${esc(fmtMonth(s.month))}</b>` },
      { label: 'Gross', cell: (s) => `<span class="num">${inr(s.gross)}</span>`, cls: 'right' },
      { label: 'Commission', cell: (s) => `<span class="num">${inr(s.commission)}</span> <span class="muted small">(${s.percent}%)</span>`, cls: 'right' },
      { label: 'Payable', cell: (s) => `<b class="num accent">${inr(s.payable)}</b>`, cls: 'right' },
      { label: 'Payments', cell: (s) => `<span class="num">${s.payments}</span>`, cls: 'right' },
      { label: 'Status', cell: (s) => pill(s.status) },
      { label: 'Reference', cell: (s) => (s.reference ? `<span class="mono">${esc(s.reference)}</span>` : '<span class="muted">—</span>') },
      { label: 'Paid on', cell: (s) => (s.paidAt ? esc(fmtDate(s.paidAt)) : '<span class="muted">—</span>') },
    ]) : emptyState({ ic: 'wallet', title: 'No statements yet', text: 'Your first settlement statement appears after the first month with verified payments closes.' })}
    <div class="panel-note mt-16">${icon('shield')}<div>Payouts only go to the bank account or UPI verified during onboarding. To change it, open any service in <a href="#/services">My Services</a> and use <strong>Request a change → Settlement details</strong>, or contact Subtize.ai support.</div></div>`;
}
