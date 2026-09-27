/* Landing page: hero with AI Smart Search, live stats, categories, features, how it works, popular services. */
import { api } from '../api.js';
import { mountAiBox } from '../ai.js';
import { serviceGrid, statTile } from '../components.js';
import { mountSite } from '../site.js';
import { $, brand, esc, icon } from '../ui.js';

mountSite();

$('#hero-brand').innerHTML = brand('/');
$('#trust-pay').innerHTML = `${icon('shield')} Pay only the official Subtize.ai QR`;
$('#trust-cancel').innerHTML = `${icon('checkCircle')} Cancel any plan in two taps`;
$('#trust-privacy').innerHTML = `${icon('lock')} Admin-verified payments`;
$('#cta-download').insertAdjacentHTML('afterbegin', icon('download'));
$('#cta-share').insertAdjacentHTML('afterbegin', icon('share'));
$('#cta-explore').insertAdjacentHTML('beforeend', icon('arrowRight'));
$('#band-download').insertAdjacentHTML('afterbegin', icon('download'));
$('#band-share').insertAdjacentHTML('afterbegin', icon('share'));

/* ── AI search: route the answer to the right page ──────────────────────── */

function routeResult(r, text) {
  const svc = r.service;
  if (r.intent === 'subscribe' && svc) {
    const p = new URLSearchParams({ subscribe: '1', months: String(r.fields?.months || svc.plans?.[0] || 1) });
    if (r.fields?.couponCode) p.set('coupon', r.fields.couponCode);
    return go(`/services/${encodeURIComponent(svc.slug)}?${p}`);
  }
  if (r.intent === 'availability' && svc) return go(`/services/${encodeURIComponent(svc.slug)}`);
  return go(`/explore?ai=${encodeURIComponent(text)}`);
}
// A short pause so the spoken/typed reply is visible before the page changes.
const go = (href) => setTimeout(() => { location.href = href; }, 650);

mountAiBox($('#hero-search'), { context: { page: 'search' }, onResult: routeResult });

/* ── Dashboard preview (illustrative, generic, no provider names) ───────── */

const previewRows = [
  { ic: 'dumbbell', name: 'Gym membership', sub: '14 of 26 visits used · 12 days left', pct: 54 },
  { ic: 'utensils', name: 'Tiffin, lunch plan', sub: '18 of 26 meals used · renews 3 Nov', pct: 69 },
  { ic: 'shirt', name: 'Laundry pickup', sub: '3 of 8 pickups used · 21 days left', pct: 38 },
];
$('#hero-preview').innerHTML = `
  <div class="preview-head"><b>My subscriptions</b><span class="pill tone-good">3 active</span></div>
  ${previewRows.map((r) => `
    <div class="preview-row">
      <div class="icon-tile sm">${icon(r.ic)}</div>
      <div style="min-width:0">
        <div class="name">${esc(r.name)}</div>
        <div class="sub">${esc(r.sub)}</div>
        <div class="meter"><span style="width:${r.pct}%"></span></div>
      </div>
      <span class="btn btn-secondary" aria-hidden="true">Manage</span>
    </div>`).join('')}
  <div class="preview-foot">${icon('checkCircle')}<span>Payment verified by Subtize.ai. Your digital card is ready.</span></div>`;

/* ── Features ───────────────────────────────────────────────────────────── */

const FEATURES = [
  ['sparkle', 'AI-powered nearby discovery', 'Describe what you need in plain words, like "yoga on weekends near me under ₹1,500", and get matching services ranked by distance.'],
  ['layers', '100+ subscription services', 'Gyms, tiffins, laundry, car care, tuition, salons, coworking, milk delivery and more, all listed with real monthly prices.'],
  ['calendar', 'Monthly subscription model', 'Subscribe for one month at a time, or pick a 3, 6 or 12-month plan where the service offers it. No long lock-ins.'],
  ['sliders', 'Smart filters', 'Filter by area, distance, price, open days, plan length, service type, offers and how many people already subscribe.'],
  ['mic', 'Voice search', 'Tap the mic and ask. Voice search understands prices in rupees, place names in Dehradun and days of the week.'],
  ['zap', 'Voice-based subscription', 'Say "subscribe me to the cheapest laundry near me" and Subtize.ai opens that plan ready to check out.'],
  ['gauge', 'Usage tracking', 'See visits, meals or pickups used against your monthly allowance, plus days left in every plan.'],
  ['x', 'Easy cancellation', 'Cancel any subscription from your dashboard. No calls, no awkward conversations at the counter.'],
  ['percent', 'Coupon discounts', 'Public offers are shown on each service, and codes apply at checkout with the discount calculated for you.'],
  ['shield', 'Secure payment verification', 'Pay only the official Subtize.ai QR, submit your UPI Transaction ID, and an admin verifies it before activation.'],
  ['qr', 'Digital subscription cards', 'Every active plan gets a card with a QR code. Staff scan it to confirm your plan is valid, with no paper passes needed.'],
  ['grid', 'One dashboard for everything', 'Payments, cards, usage, renewals and cancellations for every provider live in a single place.'],
];
$('#features').innerHTML = FEATURES.map(([ic, title, text]) => `
  <article class="feature"><div class="icon-tile">${icon(ic)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`).join('');

/* ── How it works (exactly seven steps) ─────────────────────────────────── */

const STEPS = [
  ['Search a service', 'Type or speak what you need, or browse categories and filters near you.'],
  ['Select subscription', 'Check the open days, usage policy and price, then choose a 1, 3, 6 or 12-month plan.'],
  ['Pay through official Subtize.ai payment/QR', 'Scan the Subtize.ai QR shown at checkout. The amount and reference are already filled in.'],
  ['Submit UPI Transaction ID', 'Copy the 12-digit UTR from your UPI app and paste it into the payment page.'],
  ['Admin verifies payment', 'A Subtize.ai admin matches your UTR with the payment received, usually within a few working hours.'],
  ['Service gets activated', 'Your plan starts and your digital subscription card appears in the app.'],
  ['Track usage and manage subscription', 'Follow usage, renew, or cancel any plan from the same dashboard.'],
];
$('#steps').innerHTML = STEPS.map(([title, text], i) => `
  <li class="step"><div class="num" aria-hidden="true">${i + 1}</div><div><h3><span class="sr-only">Step ${i + 1}: </span>${esc(title)}</h3><p>${esc(text)}</p></div></li>`).join('')
  + `<li class="step cta" aria-hidden="false"><p><b>Ready to start?</b><br>Explore live plans near you and subscribe in a couple of minutes.</p><a class="btn btn-primary" href="/explore">Explore Services ${icon('arrowRight')}</a></li>`;

$('#lister-points').innerHTML = [
  ['percent', '80% monthly settlement'],
  ['shield', 'Verified, admin-checked payments'],
  ['signature', 'Agreement in English and Hindi'],
].map(([ic, t]) => `<span>${icon(ic)} ${esc(t)}</span>`).join('');

/* ── Live data ──────────────────────────────────────────────────────────── */

const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');

async function loadMeta() {
  try {
    const meta = await api.get('/api/meta');
    const s = meta.stats || {};
    $('#stats').innerHTML = [
      statTile({ label: 'Live services', value: fmtNum(s.services), ic: 'layers', hero: true, sub: `Across ${meta.categories.length} categories` }),
      statTile({ label: 'Active subscribers', value: fmtNum(s.subscribers), ic: 'users', sub: 'Members with a plan running today' }),
      statTile({ label: 'Areas covered', value: fmtNum(s.areas), ic: 'pin', sub: `In and around ${esc(meta.platform?.defaultCity || 'Dehradun')}` }),
      statTile({ label: 'Lister settlement', value: `${100 - (meta.platform?.commissionPercent ?? 20)}%`, ic: 'wallet', sub: 'Of revenue paid to providers monthly' }),
    ].join('');
    $('#categories').innerHTML = meta.categories.map((c) => `
      <a class="cat-tile" href="/explore?category=${encodeURIComponent(c.slug)}">
        <div class="icon-tile sm">${icon(c.icon)}</div>
        <div style="min-width:0"><b>${esc(c.name)}</b><span>${c.services} ${c.services === 1 ? 'service' : 'services'}</span></div>
      </a>`).join('');
  } catch (e) {
    $('#stats').innerHTML = `<div class="panel-note warn">${icon('alert')}<div>Live numbers are unavailable right now. ${esc(e.message)}</div></div>`;
    $('#categories').innerHTML = '';
  }
}

async function loadPopular() {
  const host = $('#popular');
  try {
    const { services } = await api.get('/api/services', { sort: 'popular', limit: 6 });
    host.innerHTML = services.length
      ? serviceGrid(services, (s) => ({ ctaHref: `/services/${s.slug}?subscribe=1` }))
      : '<div class="empty"><h3>No services yet</h3><p>New services are being verified. Check back soon.</p></div>';
  } catch (e) {
    host.innerHTML = `<div class="panel-note warn">${icon('alert')}<div>${esc(e.message)}</div></div>`;
  }
}

loadMeta();
loadPopular();
