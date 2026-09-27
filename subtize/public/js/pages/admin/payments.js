/* Payment Verification: the UTR queue (Pending → Verified → Activated, or Rejected). */
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { $, confirmAction, debounce, esc, fmtAgo, fmtDateTime, icon, inr, pill, toast } from '../../ui.js';
import { emptyState } from '../../components.js';
import {
  activationPill, copyBtn, filterTabs, loadingRow, money, mono, mount, on, planLabel, run, scheduleBadgeRefresh, searchBox, setQuery, table,
} from './common.js';

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'awaiting_payment', label: 'Awaiting payment' },
  { key: 'all', label: 'All' },
];

/* ── Shared actions (also used by the dashboard queue) ─────────────────── */

/**
 * Verifies a payment after confirmation. p: { id, amount, upiTxnId, userName, serviceName }.
 * Resolves with the API response, or null if cancelled / failed.
 */
export async function verifyPayment(p, { activate = true } = {}) {
  const ok = await confirmAction({
    title: activate ? 'Verify and activate?' : 'Verify payment only?',
    message: `Confirm that UPI transaction <b class="mono">${esc(p.upiTxnId || '—')}</b> for <b>${esc(inr(p.amount))}</b> has arrived in the official Subtize.ai account.<br><br>
      ${esc(p.userName)} · ${esc(p.serviceName)}<br><br>
      ${activate ? 'The subscription starts today (or the day after a current plan ends) and the member gets their digital card.' : 'The subscription stays <b>verified but not active</b> until you activate it.'}`,
    confirm: activate ? 'Verify & activate' : 'Verify only',
    tone: 'primary',
  });
  if (!ok) return null;
  try {
    const res = await api.post(`/api/admin/payments/${encodeURIComponent(p.id)}/verify`, { activate });
    toast(activate && res.activated ? `Verified and activated · runs ${res.activated.start} to ${res.activated.end}` : 'Payment verified. Activate it when ready.');
    scheduleBadgeRefresh();
    return res;
  } catch (err) { toast(err.message, 'bad'); return null; }
}

export async function rejectPayment(p) {
  const reason = await confirmAction({
    title: 'Reject this payment?',
    message: `The member is told the payment could not be verified, with your reason. UTR <b class="mono">${esc(p.upiTxnId || '—')}</b> · ${esc(inr(p.amount))} · ${esc(p.userName)}.`,
    confirm: 'Reject payment',
    reason: true,
    reasonLabel: 'Reason shown to the member',
  });
  if (reason === null) return null;
  try {
    const res = await api.post(`/api/admin/payments/${encodeURIComponent(p.id)}/reject`, { reason });
    toast('Payment rejected. The member has been notified.');
    scheduleBadgeRefresh();
    return res;
  } catch (err) { toast(err.message, 'bad'); return null; }
}

export async function activateSubscription(subId, btn) {
  const ok = await confirmAction({
    title: 'Activate subscription?',
    message: `The payment is verified. Activating <b class="mono">${esc(subId)}</b> starts the plan and issues the member's digital card.`,
    confirm: 'Activate',
    tone: 'primary',
  });
  if (!ok) return null;
  return run(btn, () => api.post(`/api/admin/subscriptions/${encodeURIComponent(subId)}/activate`),
    (r) => `Activated · runs ${r.activated.start} to ${r.activated.end}`);
}

const ref = (p) => ({ id: p.id, amount: p.finalAmount, upiTxnId: p.upiTxnId, userName: p.user.name, serviceName: p.service.name });

/* ── Screen ────────────────────────────────────────────────────────────── */

export async function renderPayments({ view, query }) {
  const tab = TABS.some((t) => t.key === query.get('tab')) ? query.get('tab') : 'pending';
  let q = query.get('q') || '';
  const first = await api.get('/api/admin/payments', { status: tab === 'all' ? '' : tab, q });
  const c = first.counts || {};
  const counts = { pending: c.pending || 0, verified: c.verified || 0, rejected: c.rejected || 0, awaiting_payment: c.awaiting_payment || 0 };
  counts.all = counts.pending + counts.verified + counts.rejected;

  const root = mount(view, `
    ${pageHead('Payment Verification', 'Members pay only to the official Subtize.ai UPI QR and submit their UPI transaction ID (UTR). Match each UTR and amount against the bank statement, then verify.')}
    <div data-tabs>${filterTabs(TABS.map((t) => ({ ...t, count: counts[t.key] })), tab, '/payments', query)}</div>
    <div class="adm-toolbar">
      ${searchBox(q, 'Search payment ID, UTR, member, service or subscription ID')}
      ${tab === 'pending' ? `<span class="muted small hide-xs">${icon('info', 'sm')} Oldest first. Press Enter in the dialog to confirm.</span>` : ''}
    </div>
    <div data-list></div>`);

  const listEl = $('[data-list]', root);
  let rows = first.payments;

  const draw = () => {
    if (tab === 'pending') {
      const pending = [...rows].sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
      listEl.innerHTML = pending.length
        ? `<div class="adm-queue">${pending.map(queueCard).join('')}</div>`
        : emptyState({ ic: 'checkCircle', title: q ? 'No pending payment matches' : 'All caught up', text: q ? 'Try a different search.' : 'There are no payments waiting for verification.' });
      return;
    }
    listEl.innerHTML = table(columns(tab), rows, {
      rowAttrs: (p) => `data-id="${esc(p.id)}"`,
      empty: emptyState({ ic: 'receipt', title: 'No payments here', text: q ? 'Nothing matches that search.' : 'Payments appear here as members check out.' }),
    });
  };
  draw();

  const reload = async () => {
    listEl.innerHTML = loadingRow;
    try {
      rows = (await api.get('/api/admin/payments', { status: tab === 'all' ? '' : tab, q })).payments;
      draw();
    } catch (err) { listEl.innerHTML = ''; toast(err.message, 'bad'); }
  };

  const bumpCount = (key, delta) => {
    counts[key] = Math.max(0, (counts[key] || 0) + delta);
    counts.all = counts.pending + counts.verified + counts.rejected;
    $('[data-tabs]', root).innerHTML = filterTabs(TABS.map((t) => ({ ...t, count: counts[t.key] })), tab, '/payments', query);
  };

  const removeCard = (id) => {
    rows = rows.filter((p) => p.id !== id);
    const card = listEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (card) {
      card.classList.add('adm-leaving');
      setTimeout(draw, 220);
    } else draw();
  };

  on(root, 'input', '[data-search]', debounce((e) => { q = e.target.value.trim(); setQuery({ q }); reload(); }, 300));

  on(root, 'click', '[data-act]', async (e, btn) => {
    const id = btn.closest('[data-id]')?.dataset.id;
    const p = rows.find((x) => x.id === id);
    if (!p) return;
    const act = btn.dataset.act;
    if (act === 'verify' || act === 'verify-only') {
      btn.classList.add('is-loading');
      const res = await verifyPayment(ref(p), { activate: act === 'verify' });
      btn.classList.remove('is-loading');
      if (!res) return;
      bumpCount('pending', -1); bumpCount('verified', 1);
      if (tab === 'pending') removeCard(id); else reload();
    } else if (act === 'reject') {
      const res = await rejectPayment(ref(p));
      if (!res) return;
      bumpCount(p.status, -1); bumpCount('rejected', 1);
      if (tab === 'pending') removeCard(id); else reload();
    } else if (act === 'activate') {
      const res = await activateSubscription(p.subscription.id, btn);
      if (res) reload();
    }
  });
}

function queueCard(p) {
  const when = p.submittedAt || p.createdAt;
  return `
  <article class="adm-pay card tight" data-id="${esc(p.id)}">
    <div class="adm-pay-who">
      <a class="cell-title" href="#/users/${p.user.id}">${esc(p.user.name)}</a>
      <div class="muted small">${esc(p.user.email)}</div>
      <div class="adm-pay-svc"><a href="#/services/${p.service.id}">${esc(p.service.name)}</a></div>
      <div class="muted small">${esc(planLabel(p.subscription.months))} · <a class="mono" href="#/subscriptions/${esc(p.subscription.id)}">${esc(p.subscription.id)}</a></div>
    </div>
    <div class="adm-pay-amt">
      <div class="eyebrow">Amount paid</div>
      <div class="adm-pay-final num">${esc(inr(p.finalAmount))}</div>
      ${p.couponCode ? `<div class="small muted"><s class="num">${esc(inr(p.amount))}</s> · <span class="offer-tag">${icon('tag', 'sm')} ${esc(p.couponCode)} −${esc(inr(p.discount))}</span></div>` : '<div class="small muted">No coupon</div>'}
    </div>
    <div class="adm-pay-utr">
      <div class="eyebrow">UPI transaction ID</div>
      <div class="row adm-utr"><span class="mono">${esc(p.upiTxnId || '—')}</span>${copyBtn(p.upiTxnId, 'Copy UTR')}</div>
      <div class="small muted">Paid to <span class="mono">${esc(p.payeeVpa || '—')}</span></div>
      <div class="small muted" title="${esc(fmtDateTime(when))}">Submitted ${esc(fmtAgo(when))} · <span class="mono">${esc(p.id)}</span></div>
    </div>
    <div class="adm-pay-actions">
      <button type="button" class="btn btn-primary btn-sm" data-act="verify">${icon('checkCircle')} Verify &amp; activate</button>
      <button type="button" class="btn btn-secondary btn-sm" data-act="verify-only">Verify only</button>
      <button type="button" class="btn btn-danger-outline btn-sm" data-act="reject">${icon('x')} Reject</button>
    </div>
  </article>`;
}

function columns(tab) {
  return [
    { label: 'Payment', render: (p) => `<div class="mono small">${esc(p.id)}</div><div class="cell-sub nowrap">${esc(fmtDateTime(p.submittedAt || p.createdAt))}</div>` },
    { label: 'Member', cls: 'mid', render: (p) => `<a class="cell-title" href="#/users/${p.user.id}">${esc(p.user.name)}</a><div class="cell-sub adm-ellipsis" title="${esc(p.user.email)}">${esc(p.user.email)}</div>` },
    { label: 'Service', cls: 'wide', render: (p) => `<a href="#/services/${p.service.id}">${esc(p.service.name)}</a><div class="cell-sub">${esc(planLabel(p.subscription.months))} · <a class="mono" href="#/subscriptions/${esc(p.subscription.id)}">${esc(p.subscription.id)}</a></div>` },
    {
      label: 'Amount',
      cls: 'right',
      render: (p) => `<b>${money(p.finalAmount)}</b>${p.couponCode ? `<div class="cell-sub"><s class="num">${esc(inr(p.amount))}</s> · <span class="mono">${esc(p.couponCode)}</span> −${esc(inr(p.discount))}</div>` : '<div class="cell-sub">no coupon</div>'}`,
    },
    { label: 'UPI transaction ID', render: (p) => `${p.upiTxnId ? `<span class="row adm-utr-sm">${mono(p.upiTxnId)}${copyBtn(p.upiTxnId, 'Copy UTR')}</span>` : '<span class="muted small">Not submitted</span>'}<div class="cell-sub">to <span class="mono">${esc(p.payeeVpa || '—')}</span></div>` },
    {
      label: 'Status',
      render: (p) => `<div class="adm-pills">${pill(p.status)}${p.status !== 'awaiting_payment' && p.status !== 'rejected' ? activationPill(p.activation) : ''}</div>
        ${p.rejectionReason ? `<div class="cell-sub adm-clamp" title="${esc(p.rejectionReason)}">${esc(p.rejectionReason)}</div>` : ''}
        ${p.verifiedBy ? `<div class="cell-sub nowrap">by ${esc(p.verifiedBy)} · ${esc(fmtDateTime(p.verifiedAt))}</div>` : ''}`,
    },
    {
      label: 'Actions',
      cls: 'nowrap',
      render: (p) => {
        if (p.status === 'pending') {
          return `<div class="row adm-actions"><button type="button" class="btn btn-primary btn-sm" data-act="verify">Verify &amp; activate</button>
            <button type="button" class="btn btn-secondary btn-sm" data-act="verify-only">Verify only</button>
            <button type="button" class="btn btn-danger-outline btn-sm" data-act="reject">Reject</button></div>`;
        }
        if (p.activation === 'awaiting_activation') return `<button type="button" class="btn btn-primary btn-sm" data-act="activate">${icon('play', 'sm')} Activate</button>`;
        if (p.status === 'awaiting_payment') return `<button type="button" class="btn btn-danger-outline btn-sm" data-act="reject" title="Close this unpaid checkout">Reject</button>`;
        return `<a class="btn btn-ghost btn-sm" href="#/subscriptions/${esc(p.subscription.id)}">View</a>`;
      },
    },
  ];
}
