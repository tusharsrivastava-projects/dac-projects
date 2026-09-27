/* #/subscriptions (tabs) and #/subscriptions/:id (everything about one plan). */
import { api } from '../../api.js';
import { emptyState, periodMeter, usageMeter, usageRing } from '../../components.js';
import { go, pageHead, setPageTitle, tabs } from '../../shell.js';
import { esc, fmtDate, fmtDateTime, icon, inr, pill } from '../../ui.js';
import {
  activationLabel, canRenew, cancelSubscription, catTile, dayStrip, excludeSubscription, fmtLogStamp, isEnded, mountPage, onAct,
  openTodayPill, planLabel, subPill, weekList,
} from './common.js';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'expiring', label: 'Expiring Soon' },
  { key: 'pending', label: 'Pending' },
  { key: 'expired', label: 'Expired' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'excluded', label: 'Excluded' },
];

const EMPTY_TEXT = {
  all: ['No subscriptions yet', 'Find something nearby and subscribe for a month — gyms, tiffin, laundry and more.'],
  active: ['No active subscriptions', 'Plans appear here once an admin verifies your payment.'],
  expiring: ['Nothing expiring soon', 'Plans close to their end date show up here so you can renew in time.'],
  pending: ['Nothing pending', 'Checkouts awaiting payment or verification show up here.'],
  expired: ['No expired plans', 'Plans that reached their end date are kept here.'],
  cancelled: ['No cancelled plans', 'Anything you cancel is kept here for your records.'],
  excluded: ['Nothing excluded', 'Services you exclude from Subtize.ai are listed here.'],
};

/** Quick actions shared by list rows. */
export function subQuickActions(s, { compact = false } = {}) {
  const b = [];
  b.push(`<a class="btn btn-secondary btn-sm" href="#/subscriptions/${esc(s.id)}">${icon('eye', 'sm')} View</a>`);
  if (s.status === 'pending_payment' && s.payment?.id) b.push(`<a class="btn btn-primary btn-sm" href="#/payments/${esc(s.payment.id)}">${icon('qr', 'sm')} Pay now</a>`);
  if (s.hasCard) b.push(`<a class="btn btn-secondary btn-sm" href="#/cards/${esc(s.id)}">${icon('card', 'sm')} Card</a>`);
  if (canRenew(s) && !compact) b.push(`<a class="btn btn-outline btn-sm" href="#/checkout/${s.service.id}">${icon('refresh', 'sm')} Renew</a>`);
  if (!isEnded(s)) b.push(`<button type="button" class="btn btn-danger-outline btn-sm" data-act="cancel" data-id="${esc(s.id)}">${icon('x', 'sm')} Cancel</button>`);
  return b.join('');
}

function subRow(s) {
  const pay = s.payment;
  return `
  <article class="card sub-row">
    <div class="sub-main">
      ${catTile(s.service.category.icon)}
      <div class="grow">
        <div class="row wrap" style="--gap:8px"><a class="sub-title" href="#/subscriptions/${esc(s.id)}">${esc(s.service.name)}</a>${subPill(s)}</div>
        <div class="muted small mt-8 sub-meta">
          <span>${esc(s.service.category.name)}</span>
          <span>${planLabel(s.months)}</span>
          <span>${s.startDate ? `${fmtDate(s.startDate)} → ${fmtDate(s.endDate)}` : `Created ${fmtDate(s.createdAt)}`}</span>
          <span class="mono">${esc(s.id)}</span>
        </div>
      </div>
    </div>
    <div class="sub-facts">
      <div><div class="label">Remaining</div><div class="v">${s.status === 'active' ? `${s.remainingDays} day${s.remainingDays === 1 ? '' : 's'}` : '—'}</div></div>
      <div><div class="label">Payment</div><div class="v">${pay ? pill(pay.status) : '—'}</div></div>
      <div><div class="label">Paid</div><div class="v num">${pay ? inr(pay.finalAmount) : '—'}</div></div>
    </div>
    ${s.usage || s.status === 'active' ? `<div class="sub-usage">${s.usage ? `<div>${usageMeter(s.usage)}</div>` : ''}${s.status === 'active' ? `<div>${periodMeter(s)}</div>` : ''}</div>` : ''}
    ${s.status === 'pending_verification' ? `<div class="panel-note warn small">${icon('clock')}<div>Payment submitted${pay?.upiTxnId ? ` (UTR <span class="mono">${esc(pay.upiTxnId)}</span>)` : ''}. An admin will verify and activate it.</div></div>` : ''}
    ${s.status === 'pending_payment' ? `<div class="panel-note warn small">${icon('qr')}<div>Waiting for your payment. Pay with the official Subtize.ai QR, then submit the transaction ID.</div></div>` : ''}
    ${s.status === 'rejected' && pay?.rejectionReason ? `<div class="panel-note danger small">${icon('alert')}<div>${esc(pay.rejectionReason)}</div></div>` : ''}
    <div class="row wrap sub-actions" style="--gap:8px">${subQuickActions(s)}</div>
  </article>`;
}

export async function renderSubscriptions({ view, query, isCurrent }) {
  const active = TABS.some((t) => t.key === query.get('tab')) ? query.get('tab') : 'all';
  const { subscriptions, counts } = await api.get('/api/me/subscriptions');
  if (!isCurrent()) return;
  const all = subscriptions.length;
  const list = active === 'all' ? subscriptions : subscriptions.filter((s) => s.bucket === active);
  const [et, ex] = EMPTY_TEXT[active];

  const page = mountPage(view, `
    ${pageHead('My Subscriptions', 'Every plan you have taken through Subtize.ai, in one place.',
    `<a class="btn btn-secondary" href="#/manage">${icon('sliders', 'sm')} Manage all</a><a class="btn btn-primary" href="#/explore">${icon('plus', 'sm')} New subscription</a>`)}
    ${tabs(TABS.map((t) => ({ ...t, count: t.key === 'all' ? all : counts[t.key] || 0 })), active, '/subscriptions')}
    ${list.length ? `<div class="stack" style="--gap:14px">${list.map(subRow).join('')}</div>`
    : emptyState({ ic: 'layers', title: et, text: ex, action: '<a class="btn btn-primary" href="#/explore">Explore services</a>' })}`);

  onAct(page, {
    cancel: async (btn) => {
      const s = subscriptions.find((x) => x.id === btn.dataset.id);
      if (s && await cancelSubscription(s)) go(`/subscriptions?tab=${active}`);
    },
  });
}

/* ── Detail ─────────────────────────────────────────────────────────────── */

export async function renderSubscription({ view, params, isCurrent }) {
  const { subscription: s, payments } = await api.get(`/api/me/subscriptions/${encodeURIComponent(params.id)}`);
  if (!isCurrent()) return;
  setPageTitle(s.service.name);
  const pay = s.payment;
  const u = s.usage;
  const svc = s.service;

  const banner = {
    pending_payment: `<div class="panel-note warn">${icon('qr')}<div><strong>Waiting for your payment.</strong> Pay with the official Subtize.ai QR and submit your transaction ID.${pay?.id ? ` <a href="#/payments/${esc(pay.id)}">Continue to payment</a>` : ''}</div></div>`,
    pending_verification: `<div class="panel-note warn">${icon('clock')}<div><strong>Pending verification.</strong> You submitted UTR <span class="mono">${esc(pay?.upiTxnId || '')}</span>${pay?.submittedAt ? ` on ${fmtDateTime(pay.submittedAt)}` : ''}. An admin will verify it and activate your plan.</div></div>`,
    verified: `<div class="panel-note">${icon('checkCircle')}<div><strong>Payment verified.</strong> Your plan is being activated.</div></div>`,
    cancelled: `<div class="panel-note danger">${icon('x')}<div><strong>Cancelled${s.cancelledAt ? ` on ${fmtDate(s.cancelledAt)}` : ''}.</strong> ${esc(s.cancelReason || '')}</div></div>`,
    rejected: `<div class="panel-note danger">${icon('alert')}<div><strong>Payment not verified.</strong> ${esc(pay?.rejectionReason || '')}</div></div>`,
    expired: `<div class="panel-note">${icon('calendar')}<div><strong>This plan ended on ${fmtDate(s.endDate)}.</strong> Renew to keep going.</div></div>`,
  }[s.status] || (s.bucket === 'expiring' ? `<div class="panel-note warn">${icon('alert')}<div><strong>Expiring soon — ${s.remainingDays} day${s.remainingDays === 1 ? '' : 's'} left.</strong> Renew now so the service does not stop.</div></div>` : '');

  const actions = [
    s.hasCard ? `<a class="btn btn-secondary" href="#/cards/${esc(s.id)}">${icon('card', 'sm')} View / download card</a>` : '',
    s.status === 'pending_payment' && pay?.id ? `<a class="btn btn-primary" href="#/payments/${esc(pay.id)}">${icon('qr', 'sm')} Pay now</a>` : '',
    canRenew(s) ? `<a class="btn btn-primary" href="#/checkout/${svc.id}?months=${s.months}">${icon('refresh', 'sm')} Renew</a>` : '',
  ].join('');

  const page = mountPage(view, `
    <a class="back-link" href="#/subscriptions">${icon('back', 'sm')} My Subscriptions</a>
    <div class="page-head mt-16">
      <div class="row top" style="--gap:14px">${catTile(svc.category.icon)}
        <div><h1>${esc(svc.name)}</h1><p class="row wrap" style="--gap:8px">${subPill(s)} <span class="mono">${esc(s.id)}</span></p></div></div>
      <div class="row wrap">${actions}</div>
    </div>
    ${banner ? `<div class="mb-24">${banner}</div>` : ''}
    <div class="split">
      <div class="stack" style="--gap:18px">
        <section class="card">
          <div class="card-head"><h3>${icon('gauge')} Usage this cycle</h3>${u?.cycleStart ? `<span class="muted small">${fmtDate(u.cycleStart)} – ${fmtDate(u.cycleEnd)}</span>` : ''}</div>
          ${u && s.startDate ? `
            <div class="usage-top">
              ${usageRing(u, 132)}
              <div class="grow stack" style="--gap:12px">
                <div class="usage-nums">
                  <div><span class="label">Allowed</span><b class="num">${u.allowed == null ? '<span class="unl">Unlimited</span>' : u.allowed}</b><span class="muted small">${esc(u.unit)}</span></div>
                  <div><span class="label">Used</span><b class="num">${u.used}</b><span class="muted small">this cycle</span></div>
                  <div><span class="label">Remaining</span><b class="num">${u.allowed == null ? '∞' : u.remaining}</b><span class="muted small">${esc(u.unit)}</span></div>
                </div>
                ${usageMeter(u, { big: true })}
                ${s.status === 'active' ? periodMeter(s) : ''}
                <div class="muted small">Allowance resets every month. ${u.totalUsed} ${esc(u.unit)} used across the whole plan.</div>
              </div>
            </div>` : `<p class="muted" style="margin:0">Usage tracking starts once your plan is activated.</p>`}
        </section>

        <section class="card">
          <div class="card-head"><h3>${icon('activity')} Usage log</h3><span class="muted small">${u?.log?.length || 0} entries</span></div>
          ${u?.log?.length ? `<div class="table-wrap"><table class="table rtable"><thead><tr><th>Date</th><th>Units</th><th>Recorded by</th><th>Note</th></tr></thead><tbody>
            ${u.log.map((l) => `<tr><td data-label="Date">${fmtLogStamp(l.logged_at)}</td><td data-label="Units" class="num">${l.units}</td><td data-label="Recorded by">${esc(l.source === 'admin' ? 'Subtize.ai' : 'At the service')}</td><td data-label="Note">${esc(l.note || '—')}</td></tr>`).join('')}
            </tbody></table></div>` : '<p class="muted" style="margin:0">No usage recorded yet. Show your subscription card at the counter and each visit is logged here.</p>'}
        </section>

        <section class="card">
          <div class="card-head"><h3>${icon('receipt')} Payment history</h3></div>
          ${payments.length ? `<div class="table-wrap"><table class="table rtable"><thead><tr><th>Payment</th><th>Amount</th><th>Discount</th><th>Paid</th><th>UTR</th><th>Status</th><th>Date</th></tr></thead><tbody>
            ${payments.map((p) => `<tr><td data-label="Payment" class="mono nowrap">${p.status === 'awaiting_payment' ? `<a href="#/payments/${esc(p.id)}">${esc(p.id)}</a>` : esc(p.id)}</td><td data-label="Amount" class="num">${inr(p.amount)}</td><td data-label="Discount" class="num">${p.discount ? `${inr(p.discount)}${p.couponCode ? ` <span class="muted mono">${esc(p.couponCode)}</span>` : ''}` : '—'}</td><td data-label="Paid" class="num"><b>${inr(p.finalAmount)}</b></td><td data-label="UTR" class="mono">${esc(p.upiTxnId || '—')}</td><td data-label="Status">${pill(p.status)}${p.rejectionReason ? `<div class="cell-sub">${esc(p.rejectionReason)}</div>` : ''}</td><td data-label="Date" class="nowrap">${fmtDate(p.verifiedAt || p.submittedAt || p.createdAt)}</td></tr>`).join('')}
            </tbody></table></div>` : '<p class="muted" style="margin:0">No payments yet.</p>'}
        </section>
      </div>

      <aside class="stack" style="--gap:18px">
        <section class="card">
          <div class="card-head"><h3>${icon('file')} Details</h3></div>
          <dl class="kv">
            <dt>Subscription ID</dt><dd class="mono">${esc(s.id)}</dd>
            <dt>Service</dt><dd><a href="#/services/${svc.id}">${esc(svc.name)}</a></dd>
            <dt>Category</dt><dd>${esc(svc.category.name)}</dd>
            <dt>Location</dt><dd>${esc(svc.area)}, ${esc(svc.city)}</dd>
            <dt>Plan</dt><dd>${planLabel(s.months)}</dd>
            <dt>Start date</dt><dd>${fmtDate(s.startDate)}</dd>
            <dt>Expiry date</dt><dd>${fmtDate(s.endDate)}</dd>
            <dt>Remaining days</dt><dd>${s.status === 'active' ? s.remainingDays : '—'}</dd>
            <dt>Amount</dt><dd>${pay ? inr(pay.amount) : '—'}</dd>
            <dt>Discount</dt><dd>${pay?.discount ? `${inr(pay.discount)}${pay.couponCode ? ` (${esc(pay.couponCode)})` : ''}` : '—'}</dd>
            <dt>Amount paid</dt><dd><b>${pay ? inr(pay.finalAmount) : '—'}</b></dd>
            <dt>Payment status</dt><dd>${pay ? pill(pay.status) : '—'}</dd>
            <dt>UPI Transaction ID</dt><dd class="mono">${esc(pay?.upiTxnId || '—')}</dd>
            <dt>Activation</dt><dd>${esc(activationLabel(s))}</dd>
            <dt>Created</dt><dd>${fmtDateTime(s.createdAt)}</dd>
          </dl>
        </section>
        <section class="card">
          <div class="card-head"><h3>${icon('calendar')} Available days</h3>${openTodayPill(svc.availableDays)}</div>
          ${dayStrip(svc.availableDays, { size: 'lg' })}
          <div class="mt-16">${weekList(svc.availableDays, svc.hours)}</div>
        </section>
        <section class="card">
          <div class="card-head"><h3>${icon('shield')} Restrictions &amp; rules</h3></div>
          <h4 class="mb-8">Restrictions</h4><p class="soft small">${esc(svc.restrictions || 'None.')}</p>
          <h4 class="mb-8 mt-16">Service rules</h4><p class="soft small" style="margin:0">${esc(svc.rules || 'None.')}</p>
        </section>
        <section class="card">
          <div class="card-head"><h3>${icon('settings')} Manage</h3></div>
          <div class="stack" style="--gap:10px">
            ${!isEnded(s) ? `<button type="button" class="btn btn-danger-outline btn-block" data-act="cancel">${icon('x', 'sm')} Cancel subscription</button>` : ''}
            ${!s.excluded ? `<button type="button" class="btn btn-secondary btn-block" data-act="exclude">${icon('ban', 'sm')} Exclude from Subtize.ai</button>`
    : `<div class="muted small">This service is excluded. <a href="#/settings">Restore it in Settings</a>.</div>`}
          </div>
        </section>
      </aside>
    </div>`);

  onAct(page, {
    cancel: async () => { if (await cancelSubscription(s)) go(`/subscriptions/${s.id}`); },
    exclude: async () => { if (await excludeSubscription(s)) go(`/subscriptions/${s.id}`); },
  });
}
