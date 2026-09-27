/* Service detail: everything someone needs to decide before subscribing. Public data only. */
import { api } from '../api.js';
import { savedPosition } from '../ai.js';
import { emptyState, serviceGrid, serviceTypeLabel } from '../components.js';
import { mountSite } from '../site.js';
import { $, $$, DAY_SHORT, DAYS, copyText, esc, fmtDate, icon, inr, setTitle } from '../ui.js';

const root = $('#service-root');
const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
const params = new URLSearchParams(location.search);
const DAY_FULL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const todayKey = DAYS[(new Date().getDay() + 6) % 7];

const userP = mountSite({ active: 'explore' });

(async () => {
  const pos = savedPosition();
  let data;
  try {
    data = await api.get(`/api/services/${encodeURIComponent(slug)}`, pos ? { lat: pos.lat, lng: pos.lng } : null);
  } catch (e) {
    setTitle('Service not found');
    root.innerHTML = e.status === 404
      ? emptyState({ ic: 'compass', title: 'This service is not available', text: 'It may have been paused or removed by Subtize.ai. Similar plans are probably still listed.', action: '<a class="btn btn-primary" href="/explore">Explore services</a>' })
      : `<div class="panel-note danger">${icon('alert')}<div><strong>Could not load this service.</strong> ${esc(e.message)}</div></div>`;
    return;
  }
  const user = await userP;
  render(data.service, data.similar || [], user);
})();

function paragraphs(text) {
  return String(text || '').split(/\n{1,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p class="soft" style="font-size:15.5px;line-height:1.7">${esc(p)}</p>`).join('');
}

function render(s, similar, user) {
  setTitle(s.name);
  document.querySelector('meta[name=description]')?.setAttribute('content', `${s.name}: ${s.shortDescription} ${inr(s.monthlyPrice)} per month on Subtize.ai.`);

  const plans = s.plans?.length ? s.plans : [1];
  const wantMonths = Number(params.get('months'));
  const months0 = plans.includes(wantMonths) ? wantMonths : plans[0];
  const coupon0 = (params.get('coupon') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30);
  const full = s.spotsLeft === 0;
  const unit = s.usagePolicy?.unit || 'uses';
  const allowed = s.usagePolicy?.allowed;
  const mine = s.mySubscription;
  const typeIc = s.serviceType === 'online' ? 'globe' : s.serviceType === 'doorstep' ? 'home' : 'store';

  const gallery = s.images?.length
    ? `<div class="gallery ${s.images.length === 1 ? 'single' : ''}">
        <img src="${esc(s.images[0])}" alt="${esc(s.name)} photo 1">
        ${s.images.length > 1 ? `<div class="side">${s.images.slice(1, 3).map((src, i) => `<img src="${esc(src)}" alt="${esc(s.name)} photo ${i + 2}" loading="lazy">`).join('')}</div>` : ''}
      </div>`
    : '';

  const week = DAYS.map((d) => {
    const on = s.availableDays.includes(d);
    return `<div class="day ${on ? 'on' : ''} ${d === todayKey ? 'today' : ''}"><b>${DAY_SHORT[d]}${d === todayKey ? '<i>Today</i>' : ''}</b><span>${on ? 'Available' : 'Closed'}</span></div>`;
  }).join('');

  root.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="/explore">Explore</a>${icon('chevron')}
      <a href="/explore?category=${encodeURIComponent(s.category.slug)}">${esc(s.category.name)}</a>${icon('chevron')}
      <span aria-current="page">${esc(s.name)}</span>
    </nav>
    <div class="svc-split">
      <div class="stack" style="--gap:18px">
        <section class="card pad-lg">
          <div class="svc-head">
            <div class="icon-tile">${icon(s.category.icon)}</div>
            <div style="min-width:0">
              <div class="eyebrow accent">${esc(s.category.name)}</div>
              <h1>${esc(s.name)}</h1>
              <p class="soft" style="margin:0;font-size:16px">${esc(s.shortDescription)}</p>
            </div>
          </div>
          <div class="svc-facts">
            <span class="tag">${icon('pin')} ${esc(s.area)}, ${esc(s.city)}${s.distanceKm != null ? ` · ${s.distanceKm} km away` : ''}</span>
            <span class="tag">${icon(typeIc)} ${esc(serviceTypeLabel(s.serviceType))}</span>
            ${s.openToday ? '<span class="pill tone-good">Open today</span>' : '<span class="pill tone-neutral">Closed today</span>'}
            <span class="tag">${icon('users')} ${esc(s.subscriberLabel)}</span>
            ${s.spotsLeft != null ? `<span class="pill ${full ? 'tone-bad' : s.spotsLeft <= 5 ? 'tone-warn' : 'tone-info'}">${full ? 'Fully booked' : `${s.spotsLeft} ${s.spotsLeft === 1 ? 'spot' : 'spots'} left`}</span>` : ''}
          </div>
        </section>

        ${gallery}

        <section class="card pad-lg" aria-labelledby="about-h">
          <h2 id="about-h" style="font-size:19px;margin-bottom:12px">About this service</h2>
          ${paragraphs(s.description || s.shortDescription)}
        </section>

        <section class="card pad-lg" aria-labelledby="avail-h">
          <div class="card-head" style="flex-wrap:wrap"><h2 id="avail-h" style="font-size:19px">Available days &amp; hours</h2>
            <span class="muted small">${s.availableDays.length} of 7 days</span></div>
          <div class="week" role="list" aria-label="Weekly availability">${week.replaceAll('<div class="day', '<div role="listitem" class="day')}</div>
          <div class="row wrap mt-16" style="--gap:10px">
            <span class="tag">${icon('clock')} ${s.hours ? esc(s.hours) : 'Hours shared after activation'}</span>
            <span class="muted small">Runs ${esc(s.availableDayNames.join(', '))}. Closed days are not counted against your plan.</span>
          </div>
        </section>

        <section class="card pad-lg" aria-labelledby="policy-h">
          <h2 id="policy-h" style="font-size:19px;margin-bottom:14px">Usage policy</h2>
          <div class="policy-grid">
            <div class="policy-item big"><div class="eyebrow">${icon('gauge')} Allowed usage</div>
              <p><b>${allowed == null ? 'Unlimited' : allowed}</b> ${esc(unit)} ${allowed == null ? '' : 'per month'}</p>
              <small class="muted">${allowed == null ? 'Use it as often as the service runs.' : 'Resets with every plan month. Unused units do not carry over.'}</small></div>
            <div class="policy-item"><div class="eyebrow">${icon(typeIc)} Service type</div>
              <p>${esc(serviceTypeLabel(s.serviceType))}</p>
              <small class="muted">${s.serviceType === 'doorstep' ? 'The provider comes to your address in ' + esc(s.area) + ' and nearby.' : s.serviceType === 'online' ? 'Joined from anywhere with a link shared after activation.' : `Visit the venue in ${esc(s.area)} and show your digital card.`}</small></div>
            <div class="policy-item"><div class="eyebrow">${icon('alert')} Restrictions</div>
              <p>${s.usagePolicy?.restrictions ? esc(s.usagePolicy.restrictions) : 'No extra restrictions.'}</p></div>
            <div class="policy-item"><div class="eyebrow">${icon('list')} Service rules</div>
              <p>${s.usagePolicy?.rules ? esc(s.usagePolicy.rules) : 'Standard Subtize.ai terms apply.'}</p></div>
          </div>
        </section>

        <div class="panel-note">${icon('shield')}<div><strong>Pay only through Subtize.ai.</strong> At checkout you get the official Subtize.ai UPI QR with the amount already filled in. Never pay the provider directly; payments made outside Subtize.ai cannot be verified or refunded. <a href="/payment-info">How payments work</a></div></div>
      </div>

      <aside class="buy-box" aria-label="Subscribe">
        <div class="card pad-lg">
          <div class="row between top wrap">
            <div><div class="price">${inr(s.monthlyPrice)}<small> /month</small></div>
            <div class="muted small mt-8">${esc(s.subscriberLabel)}</div></div>
            ${s.hasOffer ? `<span class="offer-tag">${icon('tag', 'sm')} ${esc(s.offerLabel)}</span>` : ''}
          </div>

          <form id="buy-form" class="mt-24" novalidate>
            <fieldset style="border:0;padding:0">
              <legend class="label" style="padding:0;margin-bottom:8px">Choose your plan</legend>
              <div class="plan-list">
                ${plans.map((m) => `
                  <label class="plan-opt"><input type="radio" name="months" value="${m}" ${m === months0 ? 'checked' : ''}>
                    <span class="plan-inner"><span><b>${m} ${m === 1 ? 'month' : 'months'}</b><small>${inr(s.monthlyPrice)} × ${m}</small></span><span class="plan-total">${inr(s.monthlyPrice * m)}</span></span>
                  </label>`).join('')}
              </div>
            </fieldset>

            <div class="field mt-16">
              <label for="coupon">Coupon code <span class="muted">(optional)</span></label>
              <input class="input mono" id="coupon" name="coupon" value="${esc(coupon0)}" maxlength="30" autocomplete="off" placeholder="Enter a code">
              ${s.offerCode ? `<div class="row wrap mt-8" style="--gap:8px"><span class="small soft">Public offer:</span>
                <span class="copy-code">${esc(s.offerCode)}<button type="button" id="copy-code">${icon('copy')} Copy</button></span>
                <button type="button" class="btn btn-ghost btn-sm" id="use-code">Use it</button></div>` : ''}
              <div class="hint">The discount is checked and applied at checkout.</div>
            </div>

            <div class="buy-total"><span class="soft" id="total-label"></span><b id="total"></b></div>
            <div id="buy-note"></div>
            <div id="cta-slot" class="mt-16"></div>
          </form>
          <button type="button" class="btn btn-ghost btn-block mt-8" data-action="share-app" data-path="/services/${esc(s.slug)}">${icon('share')} Share this service</button>
        </div>
        <p class="muted small mt-16 row top" style="padding:0 4px;--gap:8px">${icon('lock', 'sm')}<span>Subscriptions start only after a Subtize.ai admin verifies your payment. Cancel any time from your dashboard.</span></p>
      </aside>
    </div>

    ${similar.length ? `
      <section class="mt-32" aria-labelledby="similar-h" style="padding-top:24px">
        <div class="row between wrap mb-16"><h2 id="similar-h">Similar services</h2><a class="btn btn-secondary btn-sm" href="/explore?category=${encodeURIComponent(s.category.slug)}">More ${esc(s.category.name)}</a></div>
        ${serviceGrid(similar, (x) => ({ ctaHref: `/services/${x.slug}?subscribe=1` }))}
      </section>` : ''}
    <div class="mobile-buy" role="region" aria-label="Subscribe">
      <div><div class="price">${inr(s.monthlyPrice)}<small> /month</small></div><small class="muted">${esc(plans.map((m) => `${m}`).join(' / '))}-month plans</small></div>
      <button type="button" class="btn btn-primary" id="mobile-buy-btn">${user?.role === 'admin' ? 'View plans' : full ? 'Fully booked' : 'Subscribe'}</button>
    </div>`;

  const form = $('#buy-form');
  const couponIn = $('#coupon');

  const update = () => {
    const m = Number(form.querySelector('input[name=months]:checked')?.value || plans[0]);
    const code = couponIn.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    $('#total-label').textContent = `Total for ${m} ${m === 1 ? 'month' : 'months'}`;
    $('#total').textContent = inr(s.monthlyPrice * m);
    const checkout = `/app#/checkout/${s.id}?months=${m}${code ? `&coupon=${encodeURIComponent(code)}` : ''}`;
    const label = `Subscribe for ${m} ${m === 1 ? 'month' : 'months'}`;
    let cta;
    let note = '';
    if (user?.role === 'admin') {
      cta = `<button type="button" class="btn btn-secondary btn-lg btn-block" disabled>${label}</button>`;
      note = `<div class="panel-note warn mt-16">${icon('info')}<div>Admin accounts can't hold subscriptions. Sign in with a member account to subscribe.</div></div>`;
    } else if (mine && ['pending_verification', 'verified'].includes(mine.status)) {
      cta = `<a class="btn btn-secondary btn-lg btn-block" href="/app#/subscriptions">View my pending plan</a>`;
      note = `<div class="panel-note mt-16">${icon('clock')}<div>Your payment for this service is being verified. You can subscribe again once it is activated.</div></div>`;
    } else if (full && !(mine?.status === 'active')) {
      cta = `<button type="button" class="btn btn-secondary btn-lg btn-block" disabled>Fully booked</button>`;
      note = `<div class="panel-note warn mt-16">${icon('users')}<div>All spots are taken this month. Check back soon, or look at the similar services below.</div></div>`;
    } else {
      const href = user ? checkout : `/login?next=${encodeURIComponent(checkout)}`;
      const text = mine?.status === 'active' ? `Renew for ${m} ${m === 1 ? 'month' : 'months'}` : mine?.status === 'pending_payment' ? 'Continue to checkout' : label;
      cta = `<a class="btn btn-primary btn-lg btn-block" id="subscribe-cta" href="${esc(href)}">${esc(text)} ${icon('arrowRight')}</a>`;
      if (mine?.status === 'active') note = `<div class="panel-note good mt-16">${icon('checkCircle')}<div>You're subscribed until <strong>${esc(fmtDate(mine.endDate))}</strong>. A renewal starts the day after.</div></div>`;
      else if (!user) note = '<p class="muted small center mt-8" style="margin-bottom:0">You\'ll sign in or create a free account first.</p>';
    }
    $('#buy-note').innerHTML = note;
    $('#cta-slot').innerHTML = cta;
  };

  form.addEventListener('change', update);
  couponIn.addEventListener('input', () => {
    const at = couponIn.selectionStart;
    couponIn.value = couponIn.value.toUpperCase();
    couponIn.setSelectionRange(at, at);
    update();
  });
  $('#mobile-buy-btn').addEventListener('click', () => {
    $('.buy-box .card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => ($('#subscribe-cta') || form.querySelector('input[name=months]:checked'))?.focus({ preventScroll: true }), 400);
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); $('#subscribe-cta')?.click(); });
  $('#copy-code')?.addEventListener('click', () => copyText(s.offerCode, `Copied ${s.offerCode}`));
  $('#use-code')?.addEventListener('click', () => { couponIn.value = s.offerCode; update(); });
  update();

  if (params.get('subscribe') === '1') {
    const box = $('.buy-box .card');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.classList.add('flash');
    const cta = $('#subscribe-cta');
    if (cta) { cta.classList.add('cta-focus'); setTimeout(() => cta.focus({ preventScroll: true }), 300); }
  }
  $$('.svc-card img').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
}
