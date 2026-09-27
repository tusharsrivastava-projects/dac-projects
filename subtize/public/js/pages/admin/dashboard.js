/* Admin dashboard: headline metrics, work queues and the revenue trend. */
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { $, esc, fmtAgo, fmtMonth, icon, inr, inrShort, pill } from '../../ui.js';
import { revenueChart, statTile } from '../../components.js';
import { changeFieldLabel, changeValue, mount, on, refreshBadges } from './common.js';
import { verifyPayment } from './payments.js';

const n = (x) => Number(x || 0).toLocaleString('en-IN');

export async function renderDashboard({ view }) {
  const [dash, agreements, inReview, changes] = await Promise.all([
    api.get('/api/admin/dashboard'),
    api.get('/api/admin/agreements', { status: 'pending_admin' }).catch(() => ({ agreements: [] })),
    api.get('/api/admin/services', { status: 'pending_review' }).catch(() => ({ services: [] })),
    api.get('/api/admin/change-requests', { status: 'pending' }).catch(() => ({ requests: [] })),
  ]);
  const m = dash.metrics;
  refreshBadges(m);
  const pct = m.commissionPercent;
  const month = fmtMonth(dash.month);

  const tile = (href, t) => `<a class="adm-tile" href="${href}">${statTile(t)}</a>`;
  const tiles = [
    tile('#/users', { label: 'Total users', value: n(m.totalUsers), ic: 'users', sub: `${n(m.listers)} listers` }),
    tile('#/users?status=active', { label: 'Active users', value: n(m.activeUsers), ic: 'user', sub: 'with a live subscription' }),
    tile('#/services', { label: 'Total services', value: n(m.totalServices), ic: 'store', sub: `${n(m.servicesInReview)} in review` }),
    tile('#/services?tab=active', { label: 'Active services', value: n(m.activeServices), ic: 'checkCircle', sub: 'live in the catalogue' }),
    tile('#/subscriptions?tab=active', { label: 'Total subscribers', value: n(m.totalSubscribers), ic: 'layers', sub: 'active plans today' }),
    tile('#/subscriptions', { label: 'Monthly subscriptions', value: n(m.monthlySubscriptions), ic: 'calendar', sub: `activated in ${esc(month)}` }),
    tile('#/payments', { label: 'Pending payments', value: n(m.pendingPayments), ic: 'clock', sub: m.pendingPayments ? 'awaiting verification' : 'queue is clear', hero: m.pendingPayments > 0 }),
    tile('#/payments?tab=verified', { label: 'Verified payments', value: n(m.verifiedPayments), ic: 'shield', sub: 'all time' }),
    tile('#/subscriptions?tab=cancelled', { label: 'Cancelled subscriptions', value: n(m.cancelledSubscriptions), ic: 'ban', sub: 'all time' }),
    tile('#/revenue', { label: 'Total platform revenue', value: inrShort(m.totalRevenue), ic: 'trend', sub: `${esc(inr(m.monthRevenue))} in ${esc(month)}` }),
    tile('#/revenue', { label: `Lister payouts · ${month}`, value: inrShort(m.listerPayouts), ic: 'wallet', sub: `${100 - pct}% of lister revenue · ${esc(inrShort(m.payoutsOwed))} owed` }),
    tile('#/revenue', { label: `Subtize.ai commission · ${month}`, value: inrShort(m.commission), ic: 'percent', sub: `${pct}% of lister revenue + Direct services` }),
  ].join('');

  const queue = (title, ic, count, href, body, emptyText) => `
    <section class="card adm-queue-card">
      <div class="card-head"><h3><span class="icon-tile sm">${icon(ic)}</span>${esc(title)}${count ? `<span class="badge">${count}</span>` : ''}</h3>
        <a class="btn btn-ghost btn-sm" href="${href}">View all ${icon('chevron', 'sm')}</a></div>
      ${count ? body : `<p class="muted small adm-queue-empty">${icon('checkCircle', 'sm')} ${esc(emptyText)}</p>`}
    </section>`;

  const payments = dash.pendingPayments.map((p) => `
    <li class="adm-qrow" data-pay="${esc(p.id)}">
      <div class="grow">
        <div class="cell-title">${esc(p.user)} <span class="muted">·</span> <span class="soft">${esc(p.service)}</span></div>
        <div class="small muted">UTR <span class="mono soft">${esc(p.upiTxnId)}</span> · ${esc(fmtAgo(p.submittedAt))}</div>
      </div>
      <b class="num">${esc(inr(p.amount))}</b>
      <button type="button" class="btn btn-primary btn-sm" data-verify>${icon('check', 'sm')} Verify</button>
    </li>`).join('');

  const apps = dash.pendingApplications.map((a) => `
    <li class="adm-qrow"><div class="grow"><a class="cell-title" href="#/applications/${a.id}">${esc(a.businessName)}</a>
      <div class="small muted">${esc(a.publicId)} · ${esc(a.city)} · ${esc(fmtAgo(a.createdAt))}</div></div>${pill(a.status)}
      <a class="btn btn-secondary btn-sm" href="#/applications/${a.id}">Review</a></li>`).join('');

  const agrs = agreements.agreements.slice(0, 6).map((a) => `
    <li class="adm-qrow"><div class="grow"><a class="cell-title" href="#/agreements/${a.id}">${esc(a.business || a.listerName)}</a>
      <div class="small muted">${esc(a.agreementId)} · signed by ${esc(a.listerSignedName || a.listerName)} ${esc(fmtAgo(a.listerSignedAt))}</div></div>
      <a class="btn btn-secondary btn-sm" href="#/agreements/${a.id}">${icon('signature', 'sm')} Countersign</a></li>`).join('');

  const svcs = inReview.services.slice(0, 6).map((s) => `
    <li class="adm-qrow"><div class="grow"><a class="cell-title" href="#/services/${s.id}">${esc(s.name)}</a>
      <div class="small muted">${esc(s.lister?.businessName || s.lister?.name || 'Subtize.ai Direct')} · ${esc(inr(s.monthlyPrice))}/mo · ${esc(fmtAgo(s.createdAt))}</div></div>
      <a class="btn btn-secondary btn-sm" href="#/services/${s.id}">Review</a></li>`).join('');

  const crs = changes.requests.slice(0, 6).map((c) => `
    <li class="adm-qrow"><div class="grow"><a class="cell-title" href="#/services/${c.serviceId}">${esc(c.service)}</a>
      <div class="small muted">${esc(changeFieldLabel(c.field))}: ${changeValue(c.field, c.currentValue)} → <b class="soft">${changeValue(c.field, c.proposedValue)}</b> · ${esc(c.lister)}</div></div>
      <a class="btn btn-secondary btn-sm" href="#/services/changes">Decide</a></li>`).join('');

  const root = mount(view, `
    ${pageHead('Dashboard', `Platform overview for ${esc(month)}. Amounts are verified payments.`, `
      <a class="btn btn-secondary" href="#/services/new">${icon('plus')} Add service</a>
      <a class="btn btn-primary" href="#/payments">${icon('shield')} Verify payments${m.pendingPayments ? ` (${m.pendingPayments})` : ''}</a>`)}
    <div class="adm-stats">${tiles}</div>

    <h2 class="adm-h2">Needs your attention</h2>
    ${queue('Pending payments', 'shield', m.pendingPayments, '#/payments', `<ul class="adm-qlist" data-paylist>${payments}</ul>`, 'No payments waiting.')}
    <div class="grid cols-2 mt-16">
      ${queue('Applications waiting', 'fileCheck', m.pendingApplications, '#/applications?tab=under_review', `<ul class="adm-qlist">${apps}</ul>`, 'No applications waiting.')}
      ${queue('Agreements to countersign', 'signature', m.pendingAgreements, '#/agreements?tab=pending_admin', `<ul class="adm-qlist">${agrs}</ul>`, 'Nothing to countersign.')}
      ${queue('Services in review', 'store', m.servicesInReview, '#/services?tab=pending_review', `<ul class="adm-qlist">${svcs}</ul>`, 'No services waiting for review.')}
      ${queue('Change requests', 'edit', m.pendingChanges, '#/services/changes', `<ul class="adm-qlist">${crs}</ul>`, 'No price or plan changes requested.')}
    </div>

    <h2 class="adm-h2">Revenue</h2>
    <div class="adm-split">
      <section class="card"><div class="card-head"><h3>Last 6 months</h3><a class="btn btn-ghost btn-sm" href="#/revenue">Revenue ${icon('chevron', 'sm')}</a></div><div data-chart></div></section>
      <section class="card"><div class="card-head"><h3>Top services · ${esc(month)}</h3></div>
        ${dash.topServices.length ? `<ol class="adm-top">${dash.topServices.map((s) => `<li><span class="grow">${esc(s.service)}<span class="cell-sub"> · ${s.payments} payment${s.payments === 1 ? '' : 's'}</span></span><b class="num">${esc(inr(s.gross))}</b></li>`).join('')}</ol>`
          : '<p class="muted small">No verified payments yet this month.</p>'}
      </section>
    </div>`);

  revenueChart($('[data-chart]', root), dash.trend);

  const byId = new Map(dash.pendingPayments.map((p) => [p.id, p]));
  on(root, 'click', '[data-verify]', async (e, btn) => {
    const li = btn.closest('[data-pay]');
    const p = byId.get(li.dataset.pay);
    const res = await verifyPayment({ id: p.id, amount: p.amount, upiTxnId: p.upiTxnId, userName: p.user, serviceName: p.service });
    if (res) {
      li.classList.add('adm-leaving');
      setTimeout(() => li.remove(), 220);
    }
  });
}
