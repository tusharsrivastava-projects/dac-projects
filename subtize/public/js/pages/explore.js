/*
 * Explore services: AI Smart Search on top, filters on the side (a drawer on
 * mobile), results that follow the URL so every search can be shared.
 */
import { api } from '../api.js';
import { getPosition, mountAiBox, savedPosition } from '../ai.js';
import { dayPicker, emptyState, serviceCard, serviceTypeLabel } from '../components.js';
import { mountSite } from '../site.js';
import { $, $$, DAY_SHORT, DAYS, debounce, esc, icon, toast } from '../ui.js';

mountSite({ active: 'explore' });

const PAGE = 24;
const KEYS = ['q', 'category', 'area', 'near', 'distance', 'minPrice', 'maxPrice', 'duration', 'days', 'minSubscribers', 'offers', 'type', 'sort'];
const SORTS = [
  ['', 'Relevance'], ['popular', 'Most popular'], ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'], ['distance', 'Nearest first'], ['newest', 'Newest'],
];
const DISTANCES = ['1', '2', '3', '4', '5', '10', '15', '25'];
const DURATIONS = [['', 'Any'], ['1', '1 month'], ['3', '3 months'], ['6', '6 months'], ['12', '12 months']];
const TYPES = [['', 'Any'], ['in_person', 'At the venue'], ['doorstep', 'Comes to you'], ['online', 'Online']];

let meta = { categories: [], locations: [] };
let F = readUrl();
let offset = 0;
let total = 0;
let seq = 0;
let pendingHighlight = null;

/* ── URL <-> filters ────────────────────────────────────────────────────── */

function readUrl() {
  const p = new URLSearchParams(location.search);
  const f = {};
  for (const k of KEYS) {
    const v = p.get(k);
    if (v == null || v === '') continue;
    f[k] = k === 'days' ? v.split(',').filter((d) => DAYS.includes(d)) : v;
  }
  if (f.days && !f.days.length) delete f.days;
  return f;
}

function writeUrl() {
  const p = new URLSearchParams();
  for (const k of KEYS) {
    const v = F[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : v);
  }
  const s = p.toString();
  history.replaceState(null, '', `/explore${s ? `?${s}` : ''}`);
}

const hasOrigin = () => Boolean((F.near && savedPosition()) || F.area);
const clean = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));

/* ── Filter panel ───────────────────────────────────────────────────────── */

const form = $('#filter-form');

function renderForm() {
  form.innerHTML = `
    <div class="filter-group">
      <label class="label" for="f-loc">Location</label>
      <div class="loc-row">
        <select class="select" id="f-loc" name="loc">
          <option value="">Anywhere in ${esc(meta.platform?.defaultCity || 'Dehradun')}</option>
          <option value="__near">My current location</option>
          <optgroup label="Areas">${meta.locations.map((l) => `<option value="${esc(l.area)}">${esc(l.area)}</option>`).join('')}</optgroup>
        </select>
        <button type="button" class="btn btn-secondary btn-icon" id="use-loc" aria-label="Use my location" title="Use my location">${icon('navigation')}</button>
      </div>
    </div>
    <div class="filter-group">
      <label class="label" for="f-distance">Distance</label>
      <select class="select" id="f-distance" name="distance">
        <option value="">Any distance</option>
        ${DISTANCES.map((d) => `<option value="${d}">Within ${d} km</option>`).join('')}
      </select>
      <div class="hint" id="distance-hint"></div>
    </div>
    <div class="filter-group">
      <span class="label" id="price-label">Monthly price</span>
      <div class="price-pair" role="group" aria-labelledby="price-label">
        <div class="rupee"><input class="input" type="number" inputmode="numeric" min="0" step="50" name="minPrice" placeholder="Min" aria-label="Minimum price in rupees"></div>
        <div class="rupee"><input class="input" type="number" inputmode="numeric" min="0" step="50" name="maxPrice" placeholder="Max" aria-label="Maximum price in rupees"></div>
      </div>
    </div>
    <div class="filter-group">
      <label class="label" for="f-category">Category</label>
      <select class="select" id="f-category" name="category">
        <option value="">All categories</option>
        ${meta.categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)} (${c.services})</option>`).join('')}
      </select>
    </div>
    <div class="filter-group">
      <span class="label" id="dur-label">Subscription duration</span>
      <div class="radio-chips" role="radiogroup" aria-labelledby="dur-label">
        ${DURATIONS.map(([v, l]) => `<label><input type="radio" name="duration" value="${v}"><span>${l}</span></label>`).join('')}
      </div>
    </div>
    <div class="filter-group">
      <span class="label" id="days-label">Open on these days</span>
      <div role="group" aria-labelledby="days-label">${dayPicker('days', [])}</div>
      <div class="hint">Shows services available on every day you pick.</div>
    </div>
    <div class="filter-group">
      <label class="label" for="f-subs">Minimum active subscribers</label>
      <select class="select" id="f-subs" name="minSubscribers">
        <option value="">Any</option>
        ${[1, 3, 5, 10, 20].map((n) => `<option value="${n}">${n}+ subscribers</option>`).join('')}
      </select>
    </div>
    <div class="filter-group">
      <div class="toggle-row">
        <label class="label" for="f-offers">Offers &amp; coupons only</label>
        <label class="switch"><input type="checkbox" id="f-offers" name="offers" value="1"><span></span></label>
      </div>
    </div>
    <div class="filter-group">
      <span class="label" id="type-label">Service type</span>
      <div class="radio-chips" role="radiogroup" aria-labelledby="type-label">
        ${TYPES.map(([v, l]) => `<label><input type="radio" name="type" value="${v}"><span>${l}</span></label>`).join('')}
      </div>
    </div>
    <div class="filter-group">
      <label class="label" for="f-sort">Sort by</label>
      <select class="select" id="f-sort" name="sort">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    </div>`;

  form.addEventListener('change', onFormChange);
  form.addEventListener('input', (e) => { if (e.target.type === 'number') debouncedPrice(); });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#use-loc').addEventListener('click', useMyLocation);
}

function syncForm() {
  const el = form.elements;
  el.loc.value = F.near ? '__near' : (F.area || '');
  if (el.loc.value !== (F.near ? '__near' : (F.area || ''))) el.loc.value = '';
  if (F.distance && ![...el.distance.options].some((o) => o.value === F.distance)) {
    el.distance.add(new Option(`Within ${F.distance} km`, F.distance));
  }
  el.distance.value = F.distance || '';
  el.distance.disabled = !hasOrigin();
  $('#distance-hint').textContent = hasOrigin()
    ? (F.near ? 'Measured from where you are now.' : `Measured from ${F.area}.`)
    : 'Pick an area or use your location to filter by distance.';
  el.minPrice.value = F.minPrice || '';
  el.maxPrice.value = F.maxPrice || '';
  el.category.value = F.category || '';
  $$('input[name=duration]', form).forEach((r) => { r.checked = r.value === (F.duration || ''); });
  $$('input[name=days]', form).forEach((c) => { c.checked = (F.days || []).includes(c.value); });
  el.minSubscribers.value = F.minSubscribers || '';
  el.offers.checked = F.offers === '1';
  $$('input[name=type]', form).forEach((r) => { r.checked = r.value === (F.type || ''); });
  el.sort.value = F.sort || '';
  $('#sort-top').value = F.sort || '';
  $('#use-loc').classList.toggle('btn-primary', Boolean(F.near));
  $('#use-loc').classList.toggle('btn-secondary', !F.near);
  const n = activeCount();
  $('#open-filters').innerHTML = `${icon('sliders', 'sm')} Filters${n ? ` <span class="badge">${n}</span>` : ''}`;
}

function readForm() {
  const el = form.elements;
  const loc = el.loc.value;
  const next = {
    q: F.q,
    near: loc === '__near' ? '1' : '',
    area: loc && loc !== '__near' ? loc : '',
    distance: el.distance.value,
    minPrice: el.minPrice.value,
    maxPrice: el.maxPrice.value,
    category: el.category.value,
    duration: form.querySelector('input[name=duration]:checked')?.value || '',
    days: $$('input[name=days]:checked', form).map((c) => c.value),
    minSubscribers: el.minSubscribers.value,
    offers: el.offers.checked ? '1' : '',
    type: form.querySelector('input[name=type]:checked')?.value || '',
    sort: el.sort.value,
  };
  // Choosing an area measures from its centre; start with a sensible radius.
  if (next.area && next.area !== F.area && !next.distance) next.distance = '4';
  if (!next.area && !next.near) next.distance = '';
  return clean(next);
}

async function onFormChange(e) {
  if (e.target.name === 'minPrice' || e.target.name === 'maxPrice') return; // handled by the debounced input
  if (e.target.name === 'loc' && e.target.value === '__near') { await useMyLocation(); return; }
  F = readForm();
  apply();
}
const debouncedPrice = debounce(() => { F = readForm(); apply(); }, 450);

async function useMyLocation() {
  const btn = $('#use-loc');
  btn.classList.add('is-loading');
  const pos = await getPosition();
  btn.classList.remove('is-loading');
  if (!pos) {
    toast('Location is blocked or unavailable. Pick your area from the list instead.', 'bad');
    F = { ...F, near: undefined };
    syncForm();
    return;
  }
  F = clean({ ...F, near: '1', area: '', distance: F.distance || '5', sort: F.sort || '' });
  apply();
}

/* ── Active filter chips ────────────────────────────────────────────────── */

const inrR = (v) => `₹${Number(v).toLocaleString('en-IN')}`;

function chipList() {
  const out = [];
  if (F.q) out.push(['q', `“${F.q}”`]);
  if (F.category) out.push(['category', meta.categories.find((c) => c.slug === F.category)?.name || F.category]);
  if (F.near) out.push(['near', `Near you${F.distance ? ` · ${F.distance} km` : ''}`]);
  else if (F.area) out.push(['area', `${F.area}${F.distance ? ` · ${F.distance} km` : ''}`]);
  if (F.minPrice && F.maxPrice) out.push(['price', `${inrR(F.minPrice)} to ${inrR(F.maxPrice)}`]);
  else if (F.maxPrice) out.push(['price', `Under ${inrR(F.maxPrice)}`]);
  else if (F.minPrice) out.push(['price', `From ${inrR(F.minPrice)}`]);
  if (F.duration) out.push(['duration', `${F.duration}-month plans`]);
  if (F.days?.length) out.push(['days', `Open ${F.days.map((d) => DAY_SHORT[d]).join(', ')}`]);
  if (F.minSubscribers) out.push(['minSubscribers', `${F.minSubscribers}+ subscribers`]);
  if (F.offers) out.push(['offers', 'With offers']);
  if (F.type) out.push(['type', serviceTypeLabel(F.type)]);
  return out;
}
const activeCount = () => chipList().length;

function renderChips() {
  const chips = chipList();
  $('#active-chips').innerHTML = chips.length
    ? chips.map(([k, label]) => `<button type="button" class="chip active" data-remove="${k}" aria-label="Remove filter: ${esc(label)}">${esc(label)} ${icon('close')}</button>`).join('')
      + '<button type="button" class="chip" data-remove="all">Clear all</button>'
    : '';
}

$('#active-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  removeFilter(b.dataset.remove);
});

function removeFilter(k) {
  const next = { ...F };
  if (k === 'all') { F = F.sort ? { sort: F.sort } : {}; apply(); return; }
  if (k === 'price') { delete next.minPrice; delete next.maxPrice; }
  else if (k === 'near' || k === 'area') { delete next.near; delete next.area; delete next.distance; if (next.sort === 'distance') delete next.sort; }
  else delete next[k];
  F = next;
  apply();
}

/* ── Results ────────────────────────────────────────────────────────────── */

function queryParams(extra = {}) {
  const pos = F.near ? savedPosition() : null;
  return {
    q: F.q, category: F.category, minPrice: F.minPrice, maxPrice: F.maxPrice, duration: F.duration,
    days: F.days, minSubscribers: F.minSubscribers, offers: F.offers === '1', type: F.type, sort: F.sort,
    ...(pos ? { lat: pos.lat, lng: pos.lng } : F.area ? { area: F.area } : {}),
    ...(hasOrigin() && F.distance ? { distance: F.distance } : {}),
    limit: PAGE,
    ...extra,
  };
}

const cardOpts = (s) => ({ ctaHref: `/services/${s.slug}?subscribe=1` });

async function load({ append = false } = {}) {
  const mine = ++seq;
  const host = $('#results');
  if (!append) { offset = 0; host.setAttribute('aria-busy', 'true'); host.style.opacity = '.55'; }
  const btn = $('#load-more-btn');
  if (append) btn.classList.add('is-loading');
  try {
    const r = await api.get('/api/services', queryParams({ offset }));
    if (mine !== seq) return;
    total = r.total;
    if (!append) {
      host.innerHTML = r.services.length
        ? `<div class="grid auto" style="--min:260px" id="grid">${r.services.map((s) => serviceCard(s, cardOpts(s))).join('')}</div>`
        : emptyResults();
    } else {
      $('#grid').insertAdjacentHTML('beforeend', r.services.map((s) => serviceCard(s, cardOpts(s))).join(''));
    }
    offset += r.services.length;
    $('#load-more').hidden = offset >= total;
    const origin = r.origin ? (r.origin.source === 'device' ? ' near you' : r.origin.area ? ` around ${esc(r.origin.area)}` : '') : '';
    $('#results-count').innerHTML = `<b>${total.toLocaleString('en-IN')}</b> ${total === 1 ? 'service' : 'services'}${origin}`;
    $('#apply-filters').textContent = total ? `Show ${total} ${total === 1 ? 'result' : 'results'}` : 'No results — adjust filters';
    if (pendingHighlight) { highlight(pendingHighlight); pendingHighlight = null; }
  } catch (e) {
    if (mine !== seq) return;
    host.innerHTML = `<div class="panel-note danger">${icon('alert')}<div><strong>Could not load services.</strong> ${esc(e.message)}</div></div>`;
    $('#results-count').textContent = 'Something went wrong';
  } finally {
    if (mine === seq) { host.removeAttribute('aria-busy'); host.style.opacity = ''; }
    btn.classList.remove('is-loading');
  }
}

function emptyResults() {
  const tips = [];
  if (F.maxPrice || F.minPrice) tips.push('<button type="button" class="btn btn-secondary btn-sm" data-suggest="price">Remove the price limit</button>');
  if (F.distance && Number(F.distance) < 10) tips.push('<button type="button" class="btn btn-secondary btn-sm" data-suggest="wider">Search within 10 km</button>');
  if (F.days?.length) tips.push('<button type="button" class="btn btn-secondary btn-sm" data-suggest="days">Any day of the week</button>');
  if (F.q) tips.push('<button type="button" class="btn btn-secondary btn-sm" data-suggest="q">Drop the keyword</button>');
  const cats = meta.categories.slice().sort((a, b) => b.services - a.services).slice(0, 4);
  return emptyState({
    ic: 'search',
    title: 'No services match all of that',
    text: 'Try loosening a filter, or start from one of the popular categories below.',
    action: `<div class="suggest">${tips.join('')}<button type="button" class="btn btn-primary btn-sm" data-suggest="all">Clear all filters</button></div>
      <div class="suggest mt-16">${cats.map((c) => `<button type="button" class="chip" data-suggest="cat" data-cat="${esc(c.slug)}">${icon(c.icon)} ${esc(c.name)}</button>`).join('')}</div>`,
  });
}

$('#results').addEventListener('click', (e) => {
  const b = e.target.closest('[data-suggest]');
  if (!b) return;
  const k = b.dataset.suggest;
  if (k === 'price') removeFilter('price');
  else if (k === 'wider') { F = { ...F, distance: '10' }; apply(); }
  else if (k === 'days') removeFilter('days');
  else if (k === 'q') removeFilter('q');
  else if (k === 'all') removeFilter('all');
  else if (k === 'cat') { F = { category: b.dataset.cat }; apply(); }
});

$('#load-more-btn').addEventListener('click', () => load({ append: true }));

function apply() {
  writeUrl();
  syncForm();
  renderChips();
  load();
}

function highlight(serviceId) {
  const card = $(`.svc-card[data-service="${serviceId}"]`);
  if (!card) return false;
  $$('.svc-card.highlight').forEach((c) => c.classList.remove('highlight'));
  card.classList.add('highlight', 'flash');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => card.classList.remove('flash'), 3500);
  return true;
}

/* ── AI / voice results drive the filters ───────────────────────────────── */

function fromAi(f = {}) {
  const out = {};
  if (f.q) out.q = f.q;
  if (f.category) out.category = f.category;
  if (f.minPrice != null) out.minPrice = String(f.minPrice);
  if (f.maxPrice != null) out.maxPrice = String(f.maxPrice);
  if (f.area) { out.area = f.area; out.near = ''; out.distance = String(f.distance || 4); }
  else if (f.nearMe && savedPosition()) { out.near = '1'; out.area = ''; out.distance = String(f.distance || 5); }
  else if (f.distance && hasOrigin()) out.distance = String(f.distance);
  if (f.days?.length) out.days = f.days.filter((d) => DAYS.includes(d));
  if (f.duration) out.duration = String(f.duration);
  if (f.minSubscribers) out.minSubscribers = String(f.minSubscribers);
  if (f.offers) out.offers = '1';
  if (f.type) out.type = f.type;
  if (f.sort) out.sort = f.sort;
  return out;
}

const extra = $('#ai-extra');
const showExtra = (h) => { extra.hidden = !h; extra.innerHTML = h || ''; };

function onAi(r) {
  showExtra('');
  switch (r.intent) {
    case 'clear':
      F = {};
      break;
    case 'filter':
      F = clean({ ...F, ...fromAi(r.filters) });
      break;
    case 'subscribe':
      if (r.service) {
        const p = new URLSearchParams({ subscribe: '1', months: String(r.fields?.months || r.service.plans?.[0] || 1) });
        if (r.fields?.couponCode) p.set('coupon', r.fields.couponCode);
        showExtra(`<div class="panel-note good">${icon('arrowRight')}<div>Opening <strong>${esc(r.service.name)}</strong>…</div></div>`);
        setTimeout(() => { location.href = `/services/${encodeURIComponent(r.service.slug)}?${p}`; }, 700);
        return;
      }
      F = clean(fromAi(r.filters));
      break;
    case 'availability':
      if (r.service) {
        if (!highlight(r.service.id)) {
          showExtra(`<a class="card tight link row between" href="/services/${encodeURIComponent(r.service.slug)}" style="display:flex;color:var(--text)">
            <span class="row" style="min-width:0"><span class="icon-tile sm">${icon(r.service.category.icon)}</span><span style="min-width:0"><b>${esc(r.service.name)}</b><br><small class="muted">${esc(r.service.availableDayNames.join(', '))}${r.service.hours ? ` · ${esc(r.service.hours)}` : ''}</small></span></span>
            <span class="btn btn-secondary btn-sm">View ${icon('arrowRight', 'sm')}</span></a>`);
        }
        return;
      }
      F = clean(fromAi(r.filters));
      break;
    case 'navigate': {
      const to = r.navigate && r.navigate !== 'dashboard' ? `/app#/${r.navigate}` : '/app';
      setTimeout(() => { location.href = to; }, 600);
      return;
    }
    case 'fill':
      return; // checkout-only intent; nothing to do here
    default: // 'search'
      F = clean(fromAi(r.filters));
  }
  apply();
}

/* ── Mobile drawer ──────────────────────────────────────────────────────── */

const openDrawer = (open) => {
  document.body.classList.toggle('filters-open', open);
  $('#open-filters').setAttribute('aria-expanded', String(open));
  if (open) $('#close-filters').focus();
};
$('#open-filters').addEventListener('click', () => openDrawer(true));
$('#close-filters').addEventListener('click', () => openDrawer(false));
$('#filters-scrim').addEventListener('click', () => openDrawer(false));
$('#apply-filters').addEventListener('click', () => openDrawer(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('filters-open')) openDrawer(false); });
$('#reset-filters').addEventListener('click', () => removeFilter('all'));
$('#reset-filters-2').addEventListener('click', () => removeFilter('all'));
$('#close-filters').innerHTML = icon('close');
$('#filters-title').innerHTML = `${icon('sliders')} Filters`;
$('#sort-top').innerHTML = SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
$('#sort-top').addEventListener('change', (e) => { F = clean({ ...F, sort: e.target.value }); apply(); });

/* ── Boot ───────────────────────────────────────────────────────────────── */

const box = mountAiBox($('#ai-box'), { context: { page: 'search' }, onResult: onAi, size: 'lg', initial: F.q || '' });

(async () => {
  try { meta = await api.get('/api/meta'); } catch (e) { toast(`Filters could not load: ${e.message}`, 'bad'); }
  renderForm();
  if (F.near && !savedPosition()) {
    const pos = await getPosition();
    if (!pos) F = clean({ ...F, near: '' });
  }
  const aiText = new URLSearchParams(location.search).get('ai');
  if (aiText) {
    box.input.value = aiText;
    await box.run(aiText); // onAi applies the filters and rewrites the URL without ?ai
    if (location.search.includes('ai=')) apply();
  } else apply();
})();
