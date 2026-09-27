/* #/services/:id — everything public about a service, inside the app. */
import { api } from '../../api.js';
import { savedPosition } from '../../ai.js';
import { serviceCard, serviceTypeLabel } from '../../components.js';
import { go, setPageTitle } from '../../shell.js';
import { $, esc, fmtDate, icon, inr, statusLabel, tonePill } from '../../ui.js';
import { excludeService, mountPage, openTodayPill, planLabel, weekList } from './common.js';

export async function renderService({ view, params, isCurrent }) {
  const pos = savedPosition();
  const { service: s, similar } = await api.get(`/api/services/${encodeURIComponent(params.id)}`, pos ? { lat: pos.lat, lng: pos.lng } : null);
  if (!isCurrent()) return;
  setPageTitle(s.name);

  const mine = s.mySubscription;
  const full = s.spotsLeft === 0;
  const p = s.usagePolicy || {};
  const allowance = p.allowed == null ? `Unlimited ${esc(p.unit || 'uses')} each month` : `${p.allowed} ${esc(p.unit)} per month`;
  const img = s.images?.[0];

  const mineBlock = mine ? `
    <div class="panel-note ${mine.status === 'active' ? 'good' : 'warn'}">${icon(mine.status === 'active' ? 'checkCircle' : 'clock')}
      <div><strong>${mine.status === 'active' ? `You are subscribed${mine.endDate ? ` until ${esc(fmtDate(mine.endDate))}` : ''}.` : `Your subscription is ${esc(statusLabel(mine.status).toLowerCase())}.`}</strong>
        <div class="mt-8"><a href="#/subscriptions/${esc(mine.id)}">View my subscription ${icon('arrowRight', 'sm')}</a></div></div></div>` : '';

  const page = mountPage(view, `
    <a class="back-link" href="#/explore">${icon('back', 'sm')} Explore services</a>
    <div class="split svc-detail mt-16">
      <div class="stack" style="--gap:20px">
        <section class="card">
          <div class="svc-hero">
            ${img ? `<img class="svc-hero-img" src="${esc(img)}" alt="">` : `<div class="icon-tile svc-hero-tile">${icon(s.category.icon)}</div>`}
            <div class="grow">
              <div class="eyebrow accent">${esc(s.category.name)}</div>
              <h1 class="mt-8">${esc(s.name)}</h1>
              <div class="row wrap mt-8 soft small" style="--gap:14px">
                <span class="row" style="--gap:6px">${icon('pin', 'sm')} ${esc(s.area)}, ${esc(s.city)}${s.distanceKm != null ? ` · ${s.distanceKm} km away` : ''}</span>
                <span class="row" style="--gap:6px">${icon(s.serviceType === 'online' ? 'globe' : s.serviceType === 'doorstep' ? 'home' : 'store', 'sm')} ${esc(serviceTypeLabel(s.serviceType))}</span>
              </div>
              <div class="row wrap mt-16" style="--gap:8px">
                ${openTodayPill(s.availableDays)}
                ${s.hasOffer ? `<span class="offer-tag">${icon('tag', 'sm')} ${esc(s.offerLabel)}${s.offerCode ? ` · code ${esc(s.offerCode)}` : ''}</span>` : ''}
                ${full ? tonePill('Full right now', 'bad') : ''}
              </div>
            </div>
          </div>
          ${s.images?.length > 1 ? `<div class="svc-thumbs mt-16">${s.images.slice(1, 5).map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>` : ''}
          <p class="soft mt-16" style="margin-bottom:0">${esc(s.description || s.shortDescription)}</p>
        </section>

        <div class="grid cols-2">
          <section class="card">
            <div class="card-head"><h3>${icon('calendar')} Days available</h3>${openTodayPill(s.availableDays)}</div>
            ${weekList(s.availableDays, s.hours)}
          </section>
          <section class="card">
            <div class="card-head"><h3>${icon('gauge')} Usage policy</h3></div>
            <dl class="kv">
              <dt>Allowance</dt><dd>${allowance}</dd>
              <dt>Resets</dt><dd>Every month of your plan</dd>
              ${s.hours ? `<dt>Hours</dt><dd>${esc(s.hours)}</dd>` : ''}
            </dl>
            <div class="divider"></div>
            <h4 class="mb-8">Restrictions</h4>
            <p class="soft small">${esc(p.restrictions || 'No special restrictions.')}</p>
            <h4 class="mb-8 mt-16">Service rules</h4>
            <p class="soft small" style="margin:0">${esc(p.rules || 'No special rules.')}</p>
          </section>
        </div>

        <section class="card">
          <div class="card-head"><h3>${icon('users')} Who is subscribed</h3></div>
          <p class="soft" style="margin:0">${esc(s.subscriberLabel)}.${s.maxSubscribers != null ? ` Capacity is ${s.maxSubscribers} members — <b>${full ? 'no spots left right now' : `${s.spotsLeft} spots left`}</b>.` : ' No capacity limit.'}</p>
        </section>

        ${similar?.length ? `<section><div class="row between mb-16"><h2>Similar services</h2><a href="#/explore?category=${esc(s.category.slug)}">See all ${icon('arrowRight', 'sm')}</a></div>
          <div class="grid auto" style="--min:250px">${similar.map((x) => serviceCard(x, { href: `#/services/${x.id}`, ctaHref: `#/checkout/${x.id}` })).join('')}</div></section>` : ''}
      </div>

      <aside class="stack sticky-side" style="--gap:16px">
        <section class="card buy-card">
          <div class="price" style="font-size:30px">${inr(s.monthlyPrice)}<small> /month</small></div>
          <p class="muted small mt-8">Pay once for the plan you choose. Manage or cancel any time from your dashboard.</p>
          <div class="label mt-16 mb-8">Choose a plan</div>
          <div class="plan-list" role="radiogroup" aria-label="Plan length">
            ${s.plans.map((m, i) => `<label class="plan-opt"><input type="radio" name="plan" value="${m}" ${i === 0 ? 'checked' : ''}><span><b>${planLabel(m)}</b><span class="num">${inr(s.monthlyPrice * m)}</span></span></label>`).join('')}
          </div>
          ${mineBlock ? `<div class="mt-16">${mineBlock}</div>` : ''}
          <button type="button" class="btn btn-primary btn-lg btn-block mt-16" data-sub ${full ? 'disabled' : ''}>${full ? 'Full right now' : mine?.status === 'active' ? 'Renew / extend' : 'Subscribe'}</button>
          <div class="panel-note mt-16 small">${icon('shield')}<div>You pay only to the official Subtize.ai UPI QR. An admin verifies your payment and activates your plan.</div></div>
        </section>
        <section class="card tight">
          <div class="row between"><div><b>Not for you?</b><div class="muted small">Hide it from search and suggestions.</div></div>
          <button type="button" class="btn btn-danger-outline btn-sm" data-exclude>${icon('ban', 'sm')} Exclude</button></div>
          ${s.excluded ? '<div class="muted small mt-8">This service is currently excluded. Restore it from Settings.</div>' : ''}
        </section>
      </aside>
    </div>`);

  $('[data-sub]', page)?.addEventListener('click', () => {
    const m = $('input[name=plan]:checked', page)?.value || s.plans[0];
    go(`/checkout/${s.id}?months=${m}${s.offerCode ? `&coupon=${encodeURIComponent(s.offerCode)}` : ''}`);
  });
  $('[data-exclude]', page).addEventListener('click', async () => {
    if (await excludeService(s)) go('/explore');
  });
}
