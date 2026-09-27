/*
 * Filter panel + service results, shared by AI Smart Search and Explore.
 * State mirrors GET /api/services params (prices in rupees):
 *   { q, category, area, near, distance, minPrice, maxPrice, duration, days[], minSubscribers, offers, type, sort }
 */
import { api } from '../../api.js';
import { getPosition, savedPosition } from '../../ai.js';
import { serviceCard } from '../../components.js';
import { $, $$, DAYS, DAY_SHORT, debounce, esc, icon, plural, toast } from '../../ui.js';
import { getMeta, skeletonGrid } from './common.js';

export const EMPTY = () => ({
  q: '', category: '', area: '', near: false, distance: '', minPrice: '', maxPrice: '', duration: '',
  days: [], minSubscribers: '', offers: false, type: '', sort: '',
});

const PAGE = 24;

/** Maps the assistant's `filters` onto browser state. */
export function fromAssistant(f = {}, base = EMPTY()) {
  const s = { ...base };
  if (f.q !== undefined) s.q = f.q || '';
  if (f.category !== undefined) s.category = f.category || '';
  if (f.area !== undefined) { s.area = f.area || ''; if (f.area) s.near = false; }
  if (f.nearMe) { s.near = true; s.area = ''; }
  if (f.distance != null) s.distance = String(f.distance);
  // The assistant applies a 4 km radius to a named area without saying so; mirror it.
  if (f.area && f.distance == null) s.distance = '4';
  if (f.minPrice != null) s.minPrice = String(f.minPrice);
  if (f.maxPrice != null) s.maxPrice = String(f.maxPrice);
  if (f.duration != null) s.duration = String(f.duration);
  if (Array.isArray(f.days)) s.days = [...f.days];
  if (f.minSubscribers != null) s.minSubscribers = String(f.minSubscribers);
  if (f.offers !== undefined) s.offers = Boolean(f.offers);
  if (f.type !== undefined) s.type = f.type || '';
  if (f.sort !== undefined) s.sort = f.sort || '';
  return s;
}

export function activeCount(s) {
  return ['category', 'area', 'distance', 'minPrice', 'maxPrice', 'duration', 'minSubscribers', 'type', 'sort']
    .filter((k) => s[k]).length + (s.near ? 1 : 0) + (s.offers ? 1 : 0) + (s.days.length ? 1 : 0) + (s.q ? 1 : 0);
}

function toParams(s, offset) {
  const pos = s.near ? savedPosition() : null;
  return {
    q: s.q, category: s.category, area: s.near ? '' : s.area,
    lat: pos?.lat, lng: pos?.lng,
    distance: (s.near || s.area) ? s.distance : '',
    minPrice: s.minPrice, maxPrice: s.maxPrice, duration: s.duration, days: s.days,
    minSubscribers: s.minSubscribers, offers: s.offers, type: s.type, sort: s.sort,
    limit: PAGE, offset,
  };
}

/**
 * mountBrowser(host, { initial, coupon, showQuery, onChange })
 * Returns { set(state, {reload}), get(), reload(), showSingle(service) }.
 */
export async function mountBrowser(host, { initial = EMPTY(), coupon = '', showQuery = true, onChange = null } = {}) {
  const meta = await getMeta();
  let state = { ...EMPTY(), ...initial };
  let offset = 0;
  let total = 0;
  let loadId = 0;

  host.innerHTML = `
    <div class="browse">
      <aside class="filters card" aria-label="Filters">
        <div class="filters-head">
          <h3>${icon('sliders')} Filters <span class="badge" data-count hidden></span></h3>
          <button type="button" class="btn btn-ghost btn-sm" data-reset>Reset</button>
          <button type="button" class="btn btn-ghost btn-icon btn-sm filters-close" data-close aria-label="Close filters">${icon('close')}</button>
        </div>
        <form class="filters-form" autocomplete="off">
          ${showQuery ? `<div class="field"><label for="f-q">Keywords</label><div class="input-group">${icon('search')}<input class="input" id="f-q" name="q" placeholder="e.g. zumba, maths, spa"></div></div>` : '<input type="hidden" name="q">'}
          <div class="field"><label for="f-cat">Category</label>
            <select class="select" id="f-cat" name="category"><option value="">All categories</option>${meta.categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)} (${c.services})</option>`).join('')}</select></div>
          <div class="field"><label for="f-area">Location / area</label>
            <select class="select" id="f-area" name="area"><option value="">Anywhere in ${esc(meta.platform.defaultCity)}</option>${meta.locations.map((l) => `<option value="${esc(l.area)}">${esc(l.area)}</option>`).join('')}</select>
            <button type="button" class="btn btn-secondary btn-sm mt-8" data-near>${icon('navigation', 'sm')} <span>Use my location</span></button>
            <div class="hint" data-near-note hidden></div></div>
          <div class="field"><label for="f-dist">Distance</label>
            <select class="select" id="f-dist" name="distance"><option value="">Any distance</option>${[1, 2, 3, 4, 5, 10, 15, 25].map((k) => `<option value="${k}">Within ${k} km</option>`).join('')}</select>
            <div class="hint">Measured from your location or the area you pick.</div></div>
          <div class="field"><label>Monthly price (₹)</label>
            <div class="row" style="--gap:8px"><input class="input" name="minPrice" type="number" min="0" step="50" inputmode="numeric" placeholder="Min" aria-label="Minimum price"><span class="muted">–</span><input class="input" name="maxPrice" type="number" min="0" step="50" inputmode="numeric" placeholder="Max" aria-label="Maximum price"></div></div>
          <div class="field"><label for="f-dur">Plan duration</label>
            <select class="select" id="f-dur" name="duration"><option value="">Any plan length</option>${[1, 3, 6, 12].map((m) => `<option value="${m}">${m === 1 ? '1 month' : `${m} months`} plan</option>`).join('')}</select></div>
          <div class="field"><label>Open on</label>
            <div class="days">${DAYS.map((d) => `<label class="day-toggle"><input type="checkbox" name="days" value="${d}"><span>${DAY_SHORT[d]}</span></label>`).join('')}</div></div>
          <div class="field"><label for="f-type">Service type</label>
            <select class="select" id="f-type" name="type"><option value="">Any type</option><option value="in_person">At the venue</option><option value="doorstep">Comes to you</option><option value="online">Online</option></select></div>
          <div class="field"><label for="f-subs">Minimum subscribers</label>
            <input class="input" id="f-subs" name="minSubscribers" type="number" min="0" inputmode="numeric" placeholder="Any"></div>
          <label class="check"><input type="checkbox" name="offers"> <span>Only services with a coupon offer</span></label>
          <div class="field"><label for="f-sort">Sort by</label>
            <select class="select" id="f-sort" name="sort"><option value="">Best match</option><option value="popular">Most popular</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="distance">Nearest first</option><option value="newest">Newest</option></select></div>
        </form>
      </aside>
      <section class="results" aria-live="polite">
        <div class="results-bar">
          <div class="results-count" data-total>Loading…</div>
          <button type="button" class="btn btn-secondary btn-sm filters-open" data-open>${icon('filter', 'sm')} Filters <span class="badge" data-count2 hidden></span></button>
        </div>
        <div class="chips mb-16" data-chips></div>
        <div data-single></div>
        <div data-grid>${skeletonGrid(6)}</div>
        <div class="center mt-24" data-more hidden><button type="button" class="btn btn-secondary">Load more services</button></div>
      </section>
    </div>`;

  const form = $('.filters-form', host);
  const grid = $('[data-grid]', host);
  const more = $('[data-more]', host);
  const single = $('[data-single]', host);

  const cardOpts = (s) => ({
    href: `#/services/${s.id}`,
    ctaHref: `#/checkout/${s.id}${coupon ? `?coupon=${encodeURIComponent(coupon)}` : ''}`,
  });

  const writeForm = () => {
    for (const k of ['q', 'category', 'area', 'distance', 'minPrice', 'maxPrice', 'duration', 'type', 'minSubscribers', 'sort']) {
      if (form.elements[k]) form.elements[k].value = state[k] ?? '';
    }
    if (state.area && !$$('option', form.elements.area).some((o) => o.value === state.area)) form.elements.area.value = '';
    $$('input[name=days]', form).forEach((i) => { i.checked = state.days.includes(i.value); });
    form.elements.offers.checked = Boolean(state.offers);
    const note = $('[data-near-note]', host);
    const nearBtn = $('[data-near]', host);
    nearBtn.classList.toggle('btn-primary', state.near);
    nearBtn.classList.toggle('btn-secondary', !state.near);
    $('span', nearBtn).textContent = state.near ? 'Using my location' : 'Use my location';
    note.hidden = !state.near;
    note.textContent = state.near ? (savedPosition() ? 'Distances are from where you are now.' : 'Location is off, so distances use your saved area.') : '';
    const n = activeCount(state);
    for (const b of [$('[data-count]', host), $('[data-count2]', host)]) { b.hidden = !n; b.textContent = n; }
    renderChips();
  };

  const readForm = () => {
    const f = form.elements;
    state = {
      ...state,
      q: f.q.value.trim(), category: f.category.value, area: f.area.value, distance: f.distance.value,
      minPrice: f.minPrice.value, maxPrice: f.maxPrice.value, duration: f.duration.value, type: f.type.value,
      minSubscribers: f.minSubscribers.value, sort: f.sort.value, offers: f.offers.checked,
      days: $$('input[name=days]:checked', form).map((i) => i.value),
    };
    if (state.area) state.near = false;
  };

  const catName = (slug) => meta.categories.find((c) => c.slug === slug)?.name || slug;
  const TYPE = { in_person: 'At the venue', doorstep: 'Comes to you', online: 'Online' };
  const SORT = { popular: 'Most popular', price_asc: 'Price ↑', price_desc: 'Price ↓', distance: 'Nearest', newest: 'Newest' };

  function renderChips() {
    const c = [];
    const chip = (key, label) => c.push(`<button type="button" class="chip active" data-clear="${key}" aria-label="Remove filter ${esc(label)}">${esc(label)} ${icon('close', 'sm')}</button>`);
    if (state.q) chip('q', `“${state.q}”`);
    if (state.category) chip('category', catName(state.category));
    if (state.near) chip('near', 'Near me');
    if (state.area) chip('area', state.area);
    if (state.distance && (state.near || state.area)) chip('distance', `≤ ${state.distance} km`);
    if (state.minPrice) chip('minPrice', `From ₹${state.minPrice}`);
    if (state.maxPrice) chip('maxPrice', `Up to ₹${state.maxPrice}`);
    if (state.duration) chip('duration', `${state.duration}-month plan`);
    if (state.days.length) chip('days', `Open ${state.days.map((d) => DAY_SHORT[d]).join(', ')}`);
    if (state.type) chip('type', TYPE[state.type]);
    if (state.minSubscribers) chip('minSubscribers', `${state.minSubscribers}+ subscribers`);
    if (state.offers) chip('offers', 'Has offer');
    if (state.sort) chip('sort', SORT[state.sort] || state.sort);
    $('[data-chips]', host).innerHTML = c.join('');
    $('[data-chips]', host).hidden = !c.length;
  }

  async function load({ append = false } = {}) {
    const id = ++loadId;
    if (!append) { offset = 0; grid.innerHTML = skeletonGrid(6); more.hidden = true; }
    $('[data-total]', host).textContent = 'Searching…';
    try {
      const r = await api.get('/api/services', toParams(state, offset));
      if (id !== loadId) return;
      total = r.total;
      const cards = r.services.map((s) => serviceCard(s, cardOpts(s))).join('');
      if (append) $('.grid', grid)?.insertAdjacentHTML('beforeend', cards);
      else if (r.services.length) grid.innerHTML = `<div class="grid auto" style="--min:236px">${cards}</div>`;
      else {
        grid.innerHTML = `<div class="empty"><div class="icon-tile">${icon('search')}</div><h3>No services match</h3>
          <p>Try widening the price or distance, removing a day, or resetting the filters.</p>
          <button type="button" class="btn btn-secondary" data-reset>Reset filters</button></div>`;
      }
      offset += r.services.length;
      more.hidden = offset >= total;
      $('[data-total]', host).innerHTML = `<b>${plural(total, 'service')}</b>${r.origin?.area && (state.area || state.near) ? ` <span class="muted">near ${esc(r.origin.area)}</span>` : ''}${r.origin?.source === 'device' ? ' <span class="muted">near you</span>' : ''}`;
    } catch (e) {
      if (id !== loadId) return;
      grid.innerHTML = `<div class="empty"><div class="icon-tile">${icon('alert')}</div><h3>Services did not load</h3><p>${esc(e.message)}</p><button type="button" class="btn btn-secondary" data-retry>Try again</button></div>`;
      $('[data-total]', host).textContent = '';
    }
  }

  const changed = () => { writeForm(); onChange?.(state); load(); };
  const debounced = debounce(() => { readForm(); changed(); }, 350);

  form.addEventListener('input', (e) => { if (e.target.matches('input[type=number], input[name=q]')) debounced(); });
  form.addEventListener('change', (e) => { if (!e.target.matches('input[type=number], input[name=q]')) { readForm(); changed(); } });
  form.addEventListener('submit', (e) => { e.preventDefault(); readForm(); changed(); });

  host.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-reset]')) { state = EMPTY(); single.innerHTML = ''; changed(); return; }
    if (t.closest('[data-retry]')) { load(); return; }
    if (t.closest('[data-open]')) { host.querySelector('.browse').classList.add('filters-shown'); return; }
    if (t.closest('[data-close]')) { host.querySelector('.browse').classList.remove('filters-shown'); return; }
    if (t.closest('[data-more] button')) {
      const b = t.closest('button');
      b.classList.add('is-loading');
      await load({ append: true });
      b.classList.remove('is-loading');
      return;
    }
    const clr = t.closest('[data-clear]');
    if (clr) {
      const k = clr.dataset.clear;
      if (k === 'days') state.days = [];
      else if (k === 'near' || k === 'offers') state[k] = false;
      else state[k] = '';
      changed();
      return;
    }
    const nearBtn = t.closest('[data-near]');
    if (nearBtn) {
      if (state.near) { state.near = false; changed(); return; }
      nearBtn.classList.add('is-loading');
      const pos = await getPosition();
      nearBtn.classList.remove('is-loading');
      if (!pos) toast('Location is blocked, so "near me" uses the area saved in your profile.', 'info');
      state.near = true;
      state.area = '';
      if (!state.distance) state.distance = '5';
      if (!state.sort) state.sort = 'distance';
      changed();
    }
  });

  writeForm();
  load();

  return {
    get: () => ({ ...state }),
    set(next, { reload = true } = {}) { state = { ...EMPTY(), ...next }; writeForm(); if (reload) load(); },
    reload: () => load(),
    /** Shows one service prominently above the grid (availability answers). */
    showSingle(html) { single.innerHTML = html || ''; },
    get total() { return total; },
  };
}
