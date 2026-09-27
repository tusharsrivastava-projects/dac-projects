/* Subscription Management: every paid-for plan, with detail, cancel and activate. */
import { api } from '../../api.js';
import { go, pageHead } from '../../shell.js';
import { $, confirmAction, debounce, esc, fmtDate, fmtDateTime, icon, inr, pill, toast } from '../../ui.js';
import { emptyState, periodMeter, statTile, usageMeter } from '../../components.js';
import {
  activationPill, card, copyBtn, dash, filterTabs, kv, loadingRow, money, mono, mount, on, orDash, planLabel, run, searchBox, setQuery, table,
} from './common.js';
import { activateSubscription } from './payments.js';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending_verification', label: 'Pending verification' },
  { key: 'verified', label: 'Verified' },
  { key: 'expired', label: 'Expired' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'rejected', label: 'Rejected' },
];

export async function renderSubscriptions({ view, query }) {
  const tab = TABS.some((t) => t.key === query.get('tab')) ? query.get('tab') : 'all';
  let q = query.get('q') || '';
  const params = () => ({ status: tab === 'all' ? '' : tab, q });
  const first = await api.get('/api/admin/subscriptions', params());
  const counts = first.counts || {};
  counts.all = Object.values(counts).reduce((a, b) => a + b, 0);

  const root = mount(view, `
    ${pageHead('Subscription Management', 'Every subscription past checkout. Open one to see its payment, usage and to cancel or activate it.')}
    ${filterTabs(TABS.map((t) => ({ ...t, count: counts[t.key] || 0 })), tab, '/subscriptions', query)}
    <div class="adm-toolbar">${searchBox(q, 'Search subscription ID, member or service')}</div>
    <div data-list></div>`);

  const listEl = $('[data-list]', root);
  const draw = (rows) => {
    listEl.innerHTML = `<p class="muted small mb-8">${rows.length === 300 ? 'Showing the newest 300 — search to narrow down.' : `${rows.length} subscription${rows.length === 1 ? '' : 's'}`}</p>${table([
      { label: 'ID', render: (s) => `<a class="mono small" href="#/subscriptions/${esc(s.id)}">${esc(s.id)}</a>` },
      { label: 'Member', render: (s) => `<a class="cell-title" href="#/users/${s.user.id}">${esc(s.user.name)}</a><div class="cell-sub adm-ellipsis" title="${esc(s.user.email)}">${esc(s.user.email)}</div>` },
      { label: 'Service · plan', cls: 'wide', render: (s) => `<a href="#/services/${s.service.id}">${esc(s.service.name)}</a><div class="cell-sub">${esc(planLabel(s.months))} plan</div>` },
      { label: 'Status', render: (s) => pill(s.status === 'active' && s.bucket === 'expiring' ? 'expiring' : s.status, s.status === 'pending_verification' ? 'Pending' : null) },
      { label: 'Period', render: (s) => (s.startDate ? `<span class="nowrap">${esc(fmtDate(s.startDate))} –</span><div class="nowrap">${esc(fmtDate(s.endDate))}</div>${s.status === 'active' ? `<div class="cell-sub nowrap"><b class="num soft">${s.remainingDays}</b> days left</div>` : ''}` : dash) },
      { label: 'Payment', render: (s) => (s.payment ? `${pill(s.payment.status, s.payment.status === 'pending' ? 'Pending' : null)}<div class="cell-sub num">${esc(inr(s.payment.finalAmount))}</div>` : dash) },
      { label: 'Usage', render: (s) => (s.usage ? `<div class="adm-meter">${usageMeter(s.usage)}</div>` : dash) },
      {
        label: '',
        cls: 'nowrap',
        render: (s) => (s.status === 'verified' ? `<button type="button" class="btn btn-primary btn-sm" data-activate="${esc(s.id)}">${icon('play', 'sm')} Activate</button>`
          : `<a class="btn btn-ghost btn-sm" href="#/subscriptions/${esc(s.id)}">Open</a>`),
      },
    ], rows, { empty: emptyState({ ic: 'layers', title: 'No subscriptions here', text: q ? 'Nothing matches that search.' : 'Try another status.' }) })}`;
  };
  draw(first.subscriptions);

  const reload = async () => {
    listEl.innerHTML = loadingRow;
    try { draw((await api.get('/api/admin/subscriptions', params())).subscriptions); } catch (err) { toast(err.message, 'bad'); }
  };
  on(root, 'input', '[data-search]', debounce((e) => { q = e.target.value.trim(); setQuery({ q }); reload(); }, 300));
  on(root, 'click', '[data-activate]', async (e, btn) => { if (await activateSubscription(btn.dataset.activate, btn)) reload(); });
}

export async function renderSubscriptionDetail({ view, params }) {
  const data = await api.get(`/api/admin/subscriptions/${encodeURIComponent(params.id)}`);
  const s = data.subscription;
  const u = s.usage;
  const ended = ['cancelled', 'expired', 'rejected'].includes(s.status);

  const root = mount(view, `
    <a class="btn btn-ghost btn-sm adm-back" href="#/subscriptions">${icon('back', 'sm')} Subscriptions</a>
    ${pageHead(s.service.name, `<span class="mono">${esc(s.id)}</span> ${copyBtn(s.id, 'Copy subscription ID')} · ${esc(planLabel(s.months))} · ${pill(s.status)}`, `
      ${s.status === 'verified' ? `<button type="button" class="btn btn-primary" data-act="activate">${icon('play')} Activate</button>` : ''}
      ${!ended ? `<button type="button" class="btn btn-danger-outline" data-act="cancel">${icon('ban')} Cancel subscription</button>` : ''}`)}

    <div class="adm-stats">
      ${statTile({ label: 'Status', value: s.status === 'active' ? 'Active' : s.status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), ic: 'layers', hero: s.status === 'active' })}
      ${statTile({ label: 'Days left', value: s.status === 'active' ? String(s.remainingDays) : '—', ic: 'clock', sub: s.endDate ? `ends ${esc(fmtDate(s.endDate))}` : 'not started' })}
      ${statTile({ label: 'Paid', value: s.payment ? inr(s.payment.finalAmount) : '—', ic: 'receipt', sub: s.payment?.couponCode ? `${esc(s.payment.couponCode)} −${esc(inr(s.payment.discount))}` : 'no coupon' })}
      ${statTile({ label: 'Usage this cycle', value: u ? (u.allowed == null ? `${u.used} · unlimited` : `${u.used} / ${u.allowed}`) : '—', ic: 'gauge', sub: u ? esc(u.unit) : '' })}
    </div>

    <div class="adm-split mt-16">
      <div class="stack">
        ${card('Plan', `${kv([
          ['Member', `<a href="#/users/${s.user.id}">${esc(s.user.name)}</a><div class="cell-sub">${esc(s.user.email)} · <span class="mono">${esc(s.user.publicId)}</span></div>`],
          ['Service', `<a href="#/services/${s.service.id}">${esc(s.service.name)}</a><div class="cell-sub">${esc(s.service.category.name)} · ${esc(s.service.area)}, ${esc(s.service.city)}</div>`],
          ['Plan', esc(planLabel(s.months))],
          ['Start date', s.startDate ? esc(fmtDate(s.startDate)) : null],
          ['End date', s.endDate ? esc(fmtDate(s.endDate)) : null],
          ['Available days', esc(s.service.availableDayNames.join(', '))],
          ['Hours', orDash(s.service.hours)],
          ['Created', esc(fmtDateTime(s.createdAt))],
          ['Activated', s.activatedAt ? esc(fmtDateTime(s.activatedAt)) : null],
          ['Cancelled', s.cancelledAt ? `${esc(fmtDateTime(s.cancelledAt))}<div class="cell-sub">${esc(s.cancelReason || '')}</div>` : null],
          ['Digital card', s.hasCard ? 'Issued' : 'Not issued'],
        ].filter((r) => r[1] !== null))}
        ${s.status === 'active' ? `<div class="mt-16">${periodMeter(s)}</div>` : ''}`, { ic: 'layers' })}
        ${card(`Payments (${data.payments.length})`, table([
          { label: 'Payment', render: (p) => `${mono(p.id)}<div class="cell-sub">${esc(fmtDateTime(p.submittedAt || p.createdAt))}</div>` },
          { label: 'Amount', cls: 'right', render: (p) => money(p.amount) },
          { label: 'Coupon', render: (p) => (p.couponCode ? `<span class="tag mono">${esc(p.couponCode)}</span> <span class="cell-sub">−${esc(inr(p.discount))}</span>` : dash) },
          { label: 'Final', cls: 'right', render: (p) => `<b>${money(p.finalAmount)}</b>` },
          { label: 'UTR', render: (p) => (p.upiTxnId ? `<span class="row adm-utr-sm">${mono(p.upiTxnId)}${copyBtn(p.upiTxnId, 'Copy UTR')}</span>` : dash) },
          { label: 'Payee VPA', render: (p) => mono(p.payeeVpa) },
          { label: 'Status', render: (p) => `${pill(p.status)}${p.rejectionReason ? `<div class="cell-sub">${esc(p.rejectionReason)}</div>` : ''}` },
          { label: 'Verifier', render: (p) => (p.verifiedBy ? `${esc(p.verifiedBy)}<div class="cell-sub">${esc(fmtDateTime(p.verifiedAt))}</div>` : dash) },
          { label: 'Activation', render: (p) => activationPill(p.activation) },
        ], data.payments, { empty: '<p class="muted small">No payments.</p>' }), { ic: 'receipt', actions: data.payments.some((p) => p.status === 'pending') ? '<a class="btn btn-primary btn-sm" href="#/payments">Verify in queue</a>' : '' })}
      </div>
      <div class="stack">
        ${card('Usage', u ? `${usageMeter(u, { big: true })}
          <div class="small muted mt-8">${u.cycleStart ? `Cycle ${esc(fmtDate(u.cycleStart))} – ${esc(fmtDate(u.cycleEnd))} · ` : ''}${u.totalUsed} ${esc(u.unit)} used in total</div>
          ${u.log?.length ? `<ol class="adm-timeline mt-16">${u.log.slice(0, 12).map((l) => `<li><div><b>${l.units} ${esc(u.unit)}</b>${l.note ? ` <span class="soft">— ${esc(l.note)}</span>` : ''}</div><div class="small muted">${esc(l.source)} · ${esc(fmtDateTime(l.logged_at))}</div></li>`).join('')}</ol>` : '<p class="muted small mt-16">No usage recorded yet.</p>'}
          ${s.status === 'active' ? '<a class="btn btn-secondary btn-sm mt-16" href="#/usage">Record usage</a>' : ''}` : '<p class="muted small">Usage starts once the plan is active.</p>', { ic: 'gauge' })}
        ${card('Service rules', kv([['Restrictions', orDash(s.service.restrictions)], ['Rules', orDash(s.service.rules)]]), { ic: 'info' })}
      </div>
    </div>`);

  on(root, 'click', '[data-act]', async (e, btn) => {
    if (btn.dataset.act === 'activate') {
      if (await activateSubscription(s.id, btn)) go(`/subscriptions/${s.id}`);
      return;
    }
    const reason = await confirmAction({
      title: 'Cancel this subscription?',
      message: `<b class="mono">${esc(s.id)}</b> — ${esc(s.service.name)} for ${esc(s.user.name)} ends now. Any unverified payment on it is rejected, and the member is notified with your reason.`,
      confirm: 'Cancel subscription',
      reason: true,
      reasonLabel: 'Reason shown to the member',
    });
    if (reason === null) return;
    const ok = await run(btn, () => api.post(`/api/admin/subscriptions/${encodeURIComponent(s.id)}/cancel`, { reason }), 'Subscription cancelled.');
    if (ok) go(`/subscriptions/${s.id}`);
  });
}
