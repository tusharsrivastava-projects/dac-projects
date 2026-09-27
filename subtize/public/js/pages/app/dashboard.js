/* #/ — the member's home: stats, live plans, pending, expiring, suggestions. */
import { api } from '../../api.js';
import { mountAiBox } from '../../ai.js';
import { emptyState, periodMeter, serviceGrid, statTile, usageMeter } from '../../components.js';
import { go, setBadge } from '../../shell.js';
import { $, esc, fmtAgo, fmtDate, icon, inr, inrShort, pill } from '../../ui.js';
import {
  catTile, firstName, getUser, greeting, mountPage, planLabel, setHandoff, subPill,
} from './common.js';
import { NAV_TARGETS, subscribeHref } from './search.js';

function liveRow(s) {
  return `
  <div class="dash-sub">
    <div class="row top" style="--gap:12px">
      ${catTile(s.service.category.icon, 'sm')}
      <div class="grow">
        <div class="row between wrap" style="--gap:8px"><a class="sub-title" href="#/subscriptions/${esc(s.id)}">${esc(s.service.name)}</a>${subPill(s)}</div>
        <div class="muted small">${esc(s.service.category.name)} · until ${fmtDate(s.endDate)}</div>
      </div>
    </div>
    <div class="dash-meters">
      <div>${usageMeter(s.usage)}</div>
      <div>${periodMeter(s)}</div>
    </div>
  </div>`;
}

export async function renderDashboard({ view, isCurrent }) {
  const o = await api.get('/api/me/overview');
  if (!isCurrent()) return;
  const user = getUser();
  const live = o.counts.active + o.counts.expiring;
  setBadge('/subscriptions', o.counts.pending || 0);

  const page = mountPage(view, `
    <section class="dash-hello">
      <div>
        <div class="eyebrow">${esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
        <h1 class="mt-8">${esc(greeting())}, ${esc(firstName(user?.fullName))}</h1>
        <p class="soft" style="margin:6px 0 0">${live ? `You have ${live} active subscription${live === 1 ? '' : 's'}${o.counts.expiring ? `, ${o.counts.expiring} expiring soon` : ''}.` : 'Find something nearby and subscribe for a month.'}</p>
      </div>
      <div class="row wrap"><a class="btn btn-primary" href="#/explore">${icon('plus', 'sm')} New subscription</a><a class="btn btn-secondary" href="#/manage">${icon('sliders', 'sm')} Manage</a></div>
    </section>

    <div class="stats dash-stats mt-24">
      ${statTile({ label: 'Active subscriptions', value: String(live), sub: `<a href="#/subscriptions?tab=active">View active</a>`, ic: 'layers', hero: true })}
      ${statTile({ label: 'Expiring soon', value: String(o.counts.expiring), sub: o.counts.expiring ? '<a href="#/subscriptions?tab=expiring">Renew in time</a>' : 'Nothing due', ic: 'clock' })}
      ${statTile({ label: 'Pending verification', value: String(o.counts.pending), sub: o.counts.pending ? '<a href="#/subscriptions?tab=pending">Track status</a>' : 'All clear', ic: 'shield' })}
      ${statTile({ label: 'Total spent', value: inrShort(o.spend.total), sub: 'Verified payments', ic: 'wallet' })}
      ${statTile({ label: 'Saved via coupons', value: inrShort(o.spend.saved), sub: '<a href="#/coupons">Find more coupons</a>', ic: 'percent' })}
      ${statTile({ label: 'This month', value: inrShort(o.spend.thisMonth), sub: new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }), ic: 'calendar' })}
    </div>

    <div class="split dash-split mt-24">
      <div class="stack" style="--gap:18px">
        <section class="card">
          <div class="card-head"><h3>${icon('activity')} Active subscriptions</h3><a class="small" href="#/usage">Usage ${icon('arrowRight', 'sm')}</a></div>
          ${o.active.length ? `<div class="dash-list">${o.active.map(liveRow).join('')}</div>`
    : emptyState({ ic: 'layers', title: 'No active plans yet', text: 'Once a payment is verified your plan shows up here with its usage.', action: '<a class="btn btn-primary btn-sm" href="#/explore">Explore services</a>' })}
        </section>

        ${o.expiringSoon.length ? `<section class="card attention">
          <div class="card-head"><h3>${icon('alert')} Expiring soon</h3></div>
          <div class="dash-list">${o.expiringSoon.map((s) => `
            <div class="row between wrap dash-line" style="--gap:10px">
              <div class="row" style="--gap:12px">${catTile(s.service.category.icon, 'sm')}<div><a class="sub-title" href="#/subscriptions/${esc(s.id)}">${esc(s.service.name)}</a>
                <div class="muted small">Ends ${fmtDate(s.endDate)} · <b class="accent-warn">${s.remainingDays} day${s.remainingDays === 1 ? '' : 's'} left</b></div></div></div>
              <a class="btn btn-primary btn-sm" href="#/checkout/${s.service.id}?months=${s.months}">${icon('refresh', 'sm')} Renew</a>
            </div>`).join('')}</div>
        </section>` : ''}

        <section class="card">
          <div class="card-head"><h3>${icon('clock')} Pending verification</h3><a class="small" href="#/payments">Payments ${icon('arrowRight', 'sm')}</a></div>
          ${o.pending.length ? `<div class="dash-list">${o.pending.map((s) => `
            <div class="row between wrap dash-line" style="--gap:10px">
              <div class="row" style="--gap:12px">${catTile(s.service.category.icon, 'sm')}<div><a class="sub-title" href="#/subscriptions/${esc(s.id)}">${esc(s.service.name)}</a>
                <div class="muted small">${planLabel(s.months)} · ${s.payment ? inr(s.payment.finalAmount) : ''}${s.payment?.upiTxnId ? ` · UTR <span class="mono">${esc(s.payment.upiTxnId)}</span>` : ''}</div></div></div>
              ${s.status === 'pending_payment' && s.payment ? `<a class="btn btn-primary btn-sm" href="#/payments/${esc(s.payment.id)}">${icon('qr', 'sm')} Pay now</a>` : pill(s.status)}
            </div>`).join('')}</div>
            <p class="muted small mt-16" style="margin-bottom:0">An admin checks each UTR against the payment received and activates your plan.</p>`
    : '<p class="muted" style="margin:0">Nothing waiting. Payments you submit appear here until an admin verifies them.</p>'}
        </section>
      </div>

      <aside class="stack" style="--gap:18px">
        <section class="card">
          <div class="card-head"><h3>${icon('sparkle')} Quick AI search</h3></div>
          <div data-ai></div>
          <a class="small mt-8" href="#/search" style="display:inline-block;margin-top:10px">Open AI Smart Search ${icon('arrowRight', 'sm')}</a>
        </section>
        <section class="card">
          <div class="card-head"><h3>${icon('bell')} Notifications</h3>${o.unread ? `<span class="badge">${o.unread}</span>` : ''}</div>
          ${o.notifications.length ? `<ul class="notif-list">${o.notifications.map((n) => `<li class="${n.read ? '' : 'unread'}">
              <a href="${esc(n.link || '#/')}"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ''}<small>${esc(fmtAgo(n.createdAt))}</small></a></li>`).join('')}</ul>`
    : '<p class="muted" style="margin:0">You are all caught up.</p>'}
        </section>
        <section class="card app-card">
          <div class="row" style="--gap:12px"><div class="icon-tile">${icon('smartphone')}</div><div><h3>Get the app</h3><div class="muted small">Your cards, one tap away at the counter.</div></div></div>
          <div class="row wrap mt-16" style="--gap:8px"><button type="button" class="btn btn-primary btn-sm grow" data-action="download-app">${icon('download', 'sm')} Download App</button><button type="button" class="btn btn-secondary btn-sm grow" data-action="share-app">${icon('share', 'sm')} Share App</button></div>
        </section>
      </aside>
    </div>

    ${o.recommended.length ? `<section class="mt-32">
      <div class="row between wrap mb-16"><div><h2>Recommended for you</h2><p class="muted" style="margin:4px 0 0">Popular near ${esc(user?.preferredArea || 'you')}.</p></div><a href="#/explore">Explore all ${icon('arrowRight', 'sm')}</a></div>
      ${serviceGrid(o.recommended, (s) => ({ href: `#/services/${s.id}`, ctaHref: `#/checkout/${s.id}` }))}
    </section>` : ''}`);

  mountAiBox($('[data-ai]', page), {
    context: { page: 'search' },
    size: 'md',
    examples: false,
    placeholder: 'Try “tiffin under ₹2,500”',
    onResult: (r, text) => {
      if (r.intent === 'subscribe' && r.service) { go(subscribeHref(r)); return; }
      if (r.intent === 'navigate' && r.navigate) { go(NAV_TARGETS[r.navigate] || `/${r.navigate}`); return; }
      setHandoff({ result: r, text });
      go('/search');
    },
  });
}
