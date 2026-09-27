/* Revenue: the commission split for a month, the 12-month trend and lister settlements. */
import { api } from '../../api.js';
import { go, pageHead } from '../../shell.js';
import { $, confirmAction, esc, fmtDateTime, fmtMonth, icon, inr, modal, pill, showFieldError, toast } from '../../ui.js';
import { revenueChart, statTile } from '../../components.js';
import { card, dash, money, mono, monthPicker, mount, on, run, table, validMonth } from './common.js';

const SETTLEMENT_STATUSES = [['pending', 'Pending'], ['processing', 'Processing'], ['paid', 'Paid'], ['on_hold', 'On hold']];

export async function renderRevenue({ view, query }) {
  const month = validMonth(query.get('month'));
  const [rev, st, settings] = await Promise.all([
    api.get('/api/admin/revenue', { month }),
    api.get('/api/admin/settlements', { month }),
    api.get('/api/admin/settings'),
  ]);
  const pct = settings.settings.commissionPercent;
  const m = fmtMonth(month);
  const listed = rev.services.filter((s) => s.listerId);
  const direct = rev.services.filter((s) => !s.listerId);
  const listedGross = listed.reduce((n, s) => n + s.gross, 0);
  const listedCommission = listed.reduce((n, s) => n + s.commission, 0);
  const directGross = direct.reduce((n, s) => n + s.gross, 0);
  const settlements = st.settlements;
  const settledTotal = settlements.reduce((n, s) => n + s.payable, 0);
  const paidTotal = settlements.filter((s) => s.status === 'paid').reduce((n, s) => n + s.payable, 0);
  const rates = [...new Set(listed.map((s) => s.percent))];

  const root = mount(view, `
    ${pageHead('Revenue', `Verified payments land in the month they were verified. Subtize.ai keeps its commission; listers are settled the rest monthly.`, monthPicker(month))}

    <div class="adm-stats three">
      ${statTile({ label: `Gross · ${m}`, value: inr(rev.gross), ic: 'trend', sub: `${rev.payments} verified payment${rev.payments === 1 ? '' : 's'} · ${esc(inr(rev.discounts))} in coupon discounts` })}
      ${statTile({ label: 'Subtize.ai commission', value: inr(rev.commission), ic: 'percent', hero: true, sub: `${rates.length === 1 ? `${rates[0]}%` : `${pct}% default`} of lister revenue + all Direct revenue` })}
      ${statTile({ label: 'Lister settlements', value: inr(rev.listerPayable), ic: 'wallet', sub: `${rates.length === 1 ? `${100 - rates[0]}%` : 'the rest'} of lister revenue` })}
    </div>

    <section class="card adm-formula mt-16">
      <div class="adm-formula-row">
        <div><div class="eyebrow">Lister services gross</div><div class="adm-fig num">${esc(inr(listedGross))}</div></div>
        <span class="adm-op">−</span>
        <div><div class="eyebrow">Commission (${rates.length ? rates.map((r) => `${r}%`).join(' / ') : `${pct}%`})</div><div class="adm-fig num">${esc(inr(listedCommission))}</div></div>
        <span class="adm-op">=</span>
        <div><div class="eyebrow">Lister settlements</div><div class="adm-fig num accent">${esc(inr(rev.listerPayable))}</div></div>
      </div>
      <p class="small soft mt-16">Example at ${pct}%: ₹10,000 gross → ₹${(100 * pct).toLocaleString('en-IN')} Subtize.ai commission → ₹${(100 * (100 - pct)).toLocaleString('en-IN')} lister settlement.
        Services run directly by Subtize.ai (${esc(inr(directGross))} this month) are 100% platform income, so total commission = ${esc(inr(listedCommission))} + ${esc(inr(directGross))} = <b>${esc(inr(rev.commission))}</b>.
        Each lister's rate is the one in their signed agreement.</p>
    </section>

    <section class="card mt-16"><div class="card-head"><h3><span class="icon-tile sm">${icon('chart')}</span>Last 12 months</h3></div><div data-chart></div></section>

    <section class="card mt-16" data-settlements>
      <div class="card-head"><h3><span class="icon-tile sm">${icon('wallet')}</span>Settlements · ${esc(m)}</h3>
        <button type="button" class="btn btn-primary btn-sm" data-generate>${icon('refresh', 'sm')} Generate settlements for ${esc(m)}</button></div>
      <p class="small muted mb-16">Generating creates (or refreshes) one pending settlement per lister from verified payments. Rows already marked paid are never changed.
        ${settlements.length ? `Total payable <b class="soft">${esc(inr(settledTotal))}</b> · paid <b class="soft">${esc(inr(paidTotal))}</b>.` : ''}</p>
      ${table([
        { label: 'Lister', render: (s) => `<a class="cell-title" href="#/users/${s.listerId}">${esc(s.businessName || s.listerName)}</a><div class="cell-sub">${esc(s.listerName)}</div>` },
        { label: 'Payments', cls: 'right', render: (s) => `<span class="num">${s.payments}</span>` },
        { label: 'Gross', cls: 'right', render: (s) => money(s.gross) },
        { label: 'Commission', cls: 'right', render: (s) => `${money(s.commission)} <span class="cell-sub">(${s.percent}%)</span>` },
        { label: 'Payable', cls: 'right', render: (s) => `<b>${money(s.payable)}</b>` },
        { label: 'Status', render: (s) => pill(s.status, s.status === 'pending' ? 'Pending' : null) },
        { label: 'Reference', render: (s) => (s.reference ? `${mono(s.reference)}${s.paidAt ? `<div class="cell-sub">paid ${esc(fmtDateTime(s.paidAt))}</div>` : ''}` : dash) },
        { label: '', cls: 'nowrap', render: (s) => (s.status === 'paid' ? `<span class="muted small row" style="--gap:4px">${icon('lock', 'sm')} Locked</span>` : `<button type="button" class="btn btn-secondary btn-sm" data-status="${s.id}">Update status</button>`) },
      ], settlements, { empty: `<div class="empty"><div class="icon-tile">${icon('wallet')}</div><h3>No settlements for ${esc(m)}</h3><p>Generate them once the month's payments are verified.</p></div>` })}
    </section>

    <div class="stack mt-16">
      ${card(`By service · ${m}`, table([
        { label: 'Service', render: (s) => `<a class="cell-title" href="#/services/${s.serviceId}">${esc(s.service)}</a><div class="cell-sub mono">${esc(s.servicePublicId)}</div>` },
        { label: 'Lister', render: (s) => (s.listerId ? esc(s.businessName || s.listerName) : '<span class="tag">Subtize.ai Direct</span>') },
        { label: 'Payments', cls: 'right', render: (s) => `<span class="num">${s.payments}</span>` },
        { label: 'Gross', cls: 'right', render: (s) => `<b>${money(s.gross)}</b>` },
        { label: 'Rate', cls: 'right', render: (s) => (s.listerId ? `${s.percent}%` : '100%') },
        { label: 'Commission', cls: 'right', render: (s) => money(s.listerId ? s.commission : s.gross) },
        { label: 'Lister payable', cls: 'right', render: (s) => (s.listerId ? money(s.payable) : dash) },
      ], rev.services, { empty: '<p class="muted small">No verified payments this month.</p>' }), { ic: 'store' })}
      ${card(`By lister · ${m}`, table([
        { label: 'Lister', render: (l) => `<a class="cell-title" href="#/users/${l.listerId}">${esc(l.businessName || l.listerName)}</a><div class="cell-sub">${esc(l.listerName)}</div>` },
        { label: 'Payments', cls: 'right', render: (l) => `<span class="num">${l.payments}</span>` },
        { label: 'Gross', cls: 'right', render: (l) => money(l.gross) },
        { label: 'Commission', cls: 'right', render: (l) => `${money(l.commission)} <span class="cell-sub">(${l.percent}%)</span>` },
        { label: 'Payable', cls: 'right', render: (l) => `<b>${money(l.payable)}</b>` },
      ], rev.listers, { empty: '<p class="muted small">No lister revenue this month.</p>' }), { ic: 'briefcase' })}
    </div>`);

  revenueChart($('[data-chart]', root), rev.trend);

  on(root, 'change', '[data-month]', (e) => go(`/revenue?month=${validMonth(e.target.value)}`));

  on(root, 'click', '[data-generate]', async (e, btn) => {
    const ok = await confirmAction({
      title: `Generate settlements for ${m}?`,
      message: `One settlement per lister is created from ${esc(m)}'s verified payments (${esc(inr(rev.listerPayable))} payable in total). Existing unpaid rows are refreshed; paid rows are not touched.`,
      confirm: 'Generate settlements',
      tone: 'primary',
    });
    if (!ok) return;
    const res = await run(btn, () => api.post('/api/admin/settlements/generate', { month }), (r) => `${r.generated} settlement${r.generated === 1 ? '' : 's'} generated for ${m}.`);
    if (res) go(`/revenue?month=${month}`);
  });

  on(root, 'click', '[data-status]', async (e, btn) => {
    const s = settlements.find((x) => String(x.id) === btn.dataset.status);
    const res = await modal({
      title: `Settlement · ${s.businessName || s.listerName}`,
      body: `<p><b class="num">${esc(inr(s.payable))}</b> payable for ${esc(fmtMonth(s.month))} (${esc(inr(s.gross))} gross − ${esc(inr(s.commission))} commission at ${s.percent}%).</p>
        <div class="form-grid mt-16">
          <div class="field"><label for="st-status">Status</label><select id="st-status" class="select" name="status">${SETTLEMENT_STATUSES.map(([v, l]) => `<option value="${v}" ${v === s.status ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label for="st-ref" data-ref-label>Payout reference</label><input id="st-ref" class="input mono" name="reference" maxlength="80" value="${esc(s.reference || '')}" placeholder="Bank UTR / NEFT reference"></div>
        </div>
        <div class="panel-note warn mt-16" data-paid-note hidden>${icon('lock')}<div>Marking as <b>paid</b> needs the payout reference and locks this settlement. The lister is notified.</div></div>`,
      confirm: 'Save status',
      onOpen: (box) => {
        const sync = () => {
          const paid = box.elements.status.value === 'paid';
          $('[data-paid-note]', box).hidden = !paid;
          $('[data-ref-label]', box).className = paid ? 'req' : '';
        };
        box.elements.status.addEventListener('change', sync);
        sync();
      },
      onSubmit: async (f) => {
        const status = f.elements.status.value;
        const reference = f.elements.reference.value.trim();
        if (status === 'paid' && !reference) {
          showFieldError(f, { message: 'Add the payout reference to mark this as paid.', details: { field: 'reference' } });
          throw new Error('Add the payout reference to mark this as paid.');
        }
        return api.post(`/api/admin/settlements/${s.id}/status`, { status, reference });
      },
    });
    if (res) { toast(`Settlement marked ${res.settlement.status.replace('_', ' ')}.`); go(`/revenue?month=${month}`); }
  });
}
