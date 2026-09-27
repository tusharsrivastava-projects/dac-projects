/* #/services, #/services/new, #/services/:id — the lister's own services. */
import { api } from '../../api.js';
import { dayPicker, emptyState, serviceTypeLabel } from '../../components.js';
import { go, pageHead, setPageTitle } from '../../shell.js';
import {
  $, $$, DAYS, DAY_LETTER, DAY_SHORT, busy, confirmAction, esc, fmtAgo, fmtDate, formData, icon, inr, modal,
  showFieldError, toast, tonePill,
} from '../../ui.js';
import {
  CR_STATUS, FIELD_LABEL, crValue, fail, formError, loadMeta, monthsLabel, publishBlocker, setStanding, state, svcPill,
} from './common.js';

const daysStrip = (days) => `<div class="svc-days-mini" aria-label="Open ${esc(days.map((d) => DAY_SHORT[d]).join(', '))}">${DAYS.map((d) => `<span class="${days.includes(d) ? 'on' : ''}" title="${DAY_SHORT[d]}">${DAY_LETTER[d]}</span>`).join('')}</div>`;

const usageText = (u) => (u.allowed == null ? `Unlimited ${esc(u.unit || 'visits')}` : `${u.allowed} ${esc(u.unit || 'visits')} / month`);

/* ── List ───────────────────────────────────────────────────────────────── */

export async function renderServices({ view, query, isCurrent }) {
  const [{ services, standing }, meta] = await Promise.all([api.get('/api/lister/services'), loadMeta().catch(() => null)]);
  if (!isCurrent()) return;
  setStanding(standing);
  const blocker = publishBlocker(standing);
  const icons = Object.fromEntries((meta?.categories || []).map((c) => [c.slug, c.icon]));
  const filter = query.get('status') || 'all';
  const counts = { all: services.length, active: 0, pending_review: 0, draft: 0, inactive: 0 };
  services.forEach((s) => { counts[s.status] = (counts[s.status] || 0) + 1; });
  const shown = filter === 'all' ? services : services.filter((s) => s.status === filter);
  const pendingCount = services.reduce((n, s) => n + s.pendingChanges.length, 0);

  const addBtn = blocker
    ? `<button class="btn btn-primary" disabled title="${esc(blocker)}">${icon('plus', 'sm')} Add service</button>`
    : `<a class="btn btn-primary" href="#/services/new">${icon('plus', 'sm')} Add service</a>`;

  view.innerHTML = `
    ${pageHead('My Services', `${services.length} service${services.length === 1 ? '' : 's'} · ${counts.active} live${pendingCount ? ` · ${pendingCount} change request${pendingCount === 1 ? '' : 's'} pending` : ''}`, addBtn)}
    ${blocker ? `<div class="panel-note warn mb-16">${icon('lock')}<div><strong>Adding services is locked.</strong> ${esc(blocker)} ${standing.nextStep === 'sign_agreement' ? '<a href="#/agreement">Sign the agreement</a>' : ''}</div></div>` : ''}
    <div class="panel-note mb-16">${icon('info')}<div>You can edit descriptions, photos, availability and usage rules any time. <strong>Price, plans and the official payment QR are set by Subtize.ai</strong>; ask for a change from a service's page.</div></div>
    ${services.length ? `<div class="chips mb-16" role="tablist" aria-label="Filter by status">
      ${[['all', 'All'], ['active', 'Active'], ['pending_review', 'In review'], ['draft', 'Draft'], ['inactive', 'Inactive']]
        .filter(([k]) => k === 'all' || counts[k])
        .map(([k, label]) => `<a class="chip ${filter === k ? 'active' : ''}" href="#/services${k === 'all' ? '' : `?status=${k}`}" role="tab" aria-selected="${filter === k}">${label} <span class="muted">${counts[k] || 0}</span></a>`).join('')}
    </div>` : ''}
    ${shown.length ? `<div class="grid auto lister-svc-grid" style="--min:300px">${shown.map((s) => `
      <article class="card lister-svc">
        <a class="lister-svc-media" href="#/services/${s.id}" tabindex="-1" aria-hidden="true">
          ${s.images[0] ? `<img src="${esc(s.images[0].url)}" alt="" loading="lazy">` : `<div class="icon-tile">${icon(icons[s.category.slug] || 'layers')}</div>`}
        </a>
        <div class="lister-svc-body">
          <div class="row between top">
            <div class="grow">
              <div class="svc-cat-label">${esc(s.category.name)}</div>
              <h3><a href="#/services/${s.id}">${esc(s.name)}</a></h3>
            </div>
            ${svcPill(s.status)}
          </div>
          <div class="lister-svc-meta">
            <span>${icon('pin', 'sm')} ${esc(s.area)}</span>
            <span>${icon('users', 'sm')} ${s.subscriberCount} subscriber${s.subscriberCount === 1 ? '' : 's'}</span>
            <span>${icon('clock', 'sm')} ${esc(s.hours || 'Hours not set')}</span>
          </div>
          ${daysStrip(s.availableDays)}
          <div class="lister-svc-foot">
            <div>
              <div class="price">${inr(s.monthlyPrice)}<small> /month</small></div>
              <div class="small muted row" style="--gap:4px">${icon('lock', 'sm')} Set by Subtize.ai</div>
            </div>
            <div class="row" style="--gap:8px">
              ${s.pendingChanges.length ? `<span class="pill tone-warn" title="Change requests waiting for Subtize.ai">${s.pendingChanges.length} pending</span>` : ''}
              <a class="btn btn-secondary btn-sm" href="#/services/${s.id}">${icon('edit', 'sm')} Manage</a>
            </div>
          </div>
        </div>
      </article>`).join('')}</div>`
      : emptyState({
        ic: 'layers',
        title: services.length ? 'Nothing here' : 'No services yet',
        text: services.length ? 'No services match this filter.' : blocker ? esc(blocker) : 'Add your first service. Subtize.ai reviews it, sets the price and official payment QR, then publishes it.',
        action: services.length ? '<a class="btn btn-secondary" href="#/services">Show all</a>' : blocker ? '' : '<a class="btn btn-primary" href="#/services/new">Add a service</a>',
      })}`;
}

/* ── Add ────────────────────────────────────────────────────────────────── */

export async function renderNewService({ view, isCurrent }) {
  const [meta, { standing }] = await Promise.all([loadMeta(), api.get('/api/lister/services')]);
  if (!isCurrent()) return;
  setStanding(standing);
  const blocker = publishBlocker(standing);
  if (blocker) {
    view.innerHTML = `${pageHead('Add a service', '', `<a class="btn btn-ghost" href="#/services">${icon('back', 'sm')} My services</a>`)}
      ${emptyState({ ic: 'lock', title: 'Adding services is locked', text: esc(blocker), action: standing.nextStep === 'sign_agreement' ? '<a class="btn btn-primary" href="#/agreement">Review &amp; sign agreement</a>' : '' })}`;
    return;
  }
  const byCity = new Map();
  for (const l of meta.locations) { if (!byCity.has(l.city)) byCity.set(l.city, []); byCity.get(l.city).push(l); }

  view.innerHTML = `
    <a class="back-link" href="#/services">${icon('back', 'sm')} My services</a>
    ${pageHead('Add a service', 'Tell members what you offer. Subtize.ai reviews every new service before it goes live.')}
    <div class="split">
      <form class="card stack" id="new-svc" novalidate style="--gap:20px">
        <fieldset>
          <legend>Basics</legend>
          <div class="form-grid">
            <div class="field full"><label class="req" for="ns-name">Service name</label><input class="input" id="ns-name" name="name" required minlength="3" maxlength="100" placeholder="e.g. Iron Paradise Gym, Rajpur Road"></div>
            <div class="field"><label class="req" for="ns-cat">Category</label>
              <select class="select" id="ns-cat" name="category" required><option value="">Choose a category</option>
                ${meta.categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('')}</select></div>
            <div class="field"><label class="req" for="ns-type">Service type</label>
              <select class="select" id="ns-type" name="serviceType">
                ${['in_person', 'doorstep', 'online'].map((t) => `<option value="${t}">${esc(serviceTypeLabel(t))}</option>`).join('')}</select></div>
            <div class="field"><label class="req" for="ns-area">Area</label>
              <select class="select" id="ns-area" name="area" required><option value="">Choose an area</option>
                ${[...byCity].map(([city, list]) => `<optgroup label="${esc(city)}">${list.map((l) => `<option value="${esc(l.area)}" data-city="${esc(l.city)}">${esc(l.area)}</option>`).join('')}</optgroup>`).join('')}</select></div>
            <div class="field"><label class="req" for="ns-city">City</label><input class="input" id="ns-city" name="city" required maxlength="80" value="${esc(meta.platform?.defaultCity || '')}"></div>
            <div class="field full"><label class="req" for="ns-short">Short description</label>
              <input class="input" id="ns-short" name="shortDescription" required minlength="10" maxlength="160" placeholder="One line members see on the service card">
              <div class="hint"><span data-count="ns-short">0</span>/160 · at least 10 characters</div></div>
            <div class="field full"><label class="req" for="ns-desc">Full description</label>
              <textarea class="textarea" id="ns-desc" name="description" required minlength="30" maxlength="4000" rows="5" placeholder="Facilities, batches, what is included, who it suits…"></textarea>
              <div class="hint"><span data-count="ns-desc">0</span>/4000 · at least 30 characters</div></div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Availability</legend>
          <div class="stack">
            <div class="field"><span class="label req">Available days</span>${dayPicker('availableDays', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'])}</div>
            <div class="field"><label for="ns-hours">Hours</label><input class="input" id="ns-hours" name="hours" maxlength="120" placeholder="e.g. 6 – 10 am, 5 – 9 pm"></div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Usage policy</legend>
          <div class="form-grid">
            <div class="field"><label for="ns-allowed">Allowed per month</label><input class="input" id="ns-allowed" name="usageAllowed" type="number" min="1" max="1000" inputmode="numeric" placeholder="Unlimited"><div class="hint">Leave blank for unlimited.</div></div>
            <div class="field"><label for="ns-unit">Counted in</label><input class="input" id="ns-unit" name="usageUnit" maxlength="30" value="visits" list="unit-list">
              <datalist id="unit-list"><option value="visits"><option value="sessions"><option value="classes"><option value="meals"><option value="pickups"><option value="washes"><option value="hours"></datalist></div>
            <div class="field full"><label for="ns-restr">Restrictions</label><textarea class="textarea" id="ns-restr" name="usageRestrictions" rows="2" maxlength="1000" placeholder="e.g. One visit per day. Not valid on public holidays."></textarea></div>
            <div class="field full"><label for="ns-rules">Service rules</label><textarea class="textarea" id="ns-rules" name="serviceRules" rows="3" maxlength="2000" placeholder="e.g. Carry a towel and indoor shoes. Show your Subtize.ai card at the desk."></textarea></div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Proposed price</legend>
          <div class="field"><label class="req" for="ns-price">Proposed monthly price (₹)</label>
            <div class="input-group"><span class="input-prefix">₹</span><input class="input" id="ns-price" name="proposedPrice" type="number" min="1" max="100000" step="1" inputmode="numeric" required placeholder="1200"></div>
            <div class="hint">A suggestion. Subtize.ai confirms the final price and plans during review.</div></div>
        </fieldset>
        <div class="row end wrap">
          <a class="btn btn-ghost" href="#/services">Cancel</a>
          <button class="btn btn-primary" type="submit">${icon('upload', 'sm')} Submit for review</button>
        </div>
      </form>
      <aside class="stack">
        <div class="card">
          <div class="card-head"><h3>${icon('info')} What happens next</h3></div>
          <ol class="steps-list">
            <li><b>You submit</b><span>The service is saved as <em>In review</em>. Members cannot see it yet.</span></li>
            <li><b>Subtize.ai reviews</b><span>We check the details, set the final monthly price and plans, and attach the official Subtize.ai payment QR.</span></li>
            <li><b>It goes live</b><span>Members subscribe and pay only to the official Subtize.ai QR. You check them in with their digital card.</span></li>
            <li><b>You get paid monthly</b><span>Subtize.ai retains ${state.commission}% of the month's subscription revenue; ${100 - state.commission}% is settled to you.</span></li>
          </ol>
        </div>
        <div class="panel-note">${icon('lock')}<div>Price, plan lengths, the payment QR, commission and settlement settings can only be changed by Subtize.ai. After publishing, request changes from the service's page.</div></div>
      </aside>
    </div>`;

  const form = $('#new-svc', view);
  const area = $('#ns-area', view);
  area.addEventListener('change', () => { const c = area.selectedOptions[0]?.dataset.city; if (c) $('#ns-city', view).value = c; });
  wireCounters(view);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    const body = {
      name: d.name?.trim(), category: d.category, area: d.area, city: d.city?.trim(), serviceType: d.serviceType,
      proposedPrice: d.proposedPrice, availableDays: [].concat(d.availableDays || []), hours: d.hours,
      usageAllowed: d.usageAllowed ?? '', usageUnit: d.usageUnit, usageRestrictions: d.usageRestrictions, serviceRules: d.serviceRules,
      shortDescription: d.shortDescription?.trim(), description: d.description?.trim(),
    };
    const local = validateLocal(form, body);
    if (local) return;
    await busy($('button[type=submit]', form), async () => {
      try {
        const { service } = await api.post('/api/lister/services', body);
        toast('Service submitted. Subtize.ai will review it and set the price and payment QR.');
        go(`/services/${service.id}`);
      } catch (err) {
        formError(form, err, NEW_LABELS);
      }
    });
  });
}

const NEW_LABELS = {
  'Service name': 'name', Category: 'category', Area: 'area', City: 'city', 'Short description': 'shortDescription', Description: 'description',
  'Proposed monthly price': 'proposedPrice', Hours: 'hours', 'Allowed usage': 'usageAllowed', 'Usage unit': 'usageUnit',
  Restrictions: 'usageRestrictions', 'Service rules': 'serviceRules',
};
const EDIT_LABELS = {
  'Service name': 'name', 'Short description': 'shortDescription', Description: 'description', Hours: 'hours',
  'Allowed usage': 'allowed', 'Usage unit': 'unit', Restrictions: 'restrictions', 'Service rules': 'rules',
};

function validateLocal(form, b) {
  const checks = [
    ['name', !b.name || b.name.length < 3, 'Give the service a name (at least 3 characters).'],
    ['category', !b.category, 'Pick a category.'],
    ['area', !b.area, 'Pick the area where the service runs.'],
    ['city', !b.city, 'Add the city.'],
    ['shortDescription', !b.shortDescription || b.shortDescription.length < 10, 'The short description needs at least 10 characters.'],
    ['description', !b.description || b.description.length < 30, 'The description needs at least 30 characters.'],
    ['availableDays', !b.availableDays.length, 'Choose at least one available day.'],
    ['proposedPrice', !(Number(b.proposedPrice) >= 1), 'Enter a proposed monthly price in rupees.'],
  ];
  const bad = checks.find(([, cond]) => cond);
  if (!bad) return false;
  showFieldError(form, { message: bad[2], details: { field: bad[0] } });
  if (bad[0] === 'availableDays') toast(bad[2], 'bad');
  return true;
}

function wireCounters(root) {
  $$('[data-count]', root).forEach((c) => {
    const input = $(`#${c.dataset.count}`, root);
    const upd = () => { c.textContent = input.value.length; };
    input.addEventListener('input', upd);
    upd();
  });
}

/* ── Detail / edit ──────────────────────────────────────────────────────── */

export async function renderServiceDetail({ view, params, isCurrent }) {
  const [{ service: s }, { requests }] = await Promise.all([
    api.get(`/api/lister/services/${encodeURIComponent(params.id)}`),
    api.get('/api/lister/change-requests').catch(() => ({ requests: [] })),
  ]);
  if (!isCurrent()) return;
  setPageTitle(s.name);
  const mine = requests.filter((r) => r.serviceId === s.id);
  const u = s.usagePolicy;

  view.innerHTML = `
    <a class="back-link" href="#/services">${icon('back', 'sm')} My services</a>
    ${pageHead(s.name, `${esc(s.category.name)} · ${esc(s.area)}, ${esc(s.city)} · <span class="mono">${esc(s.publicId)}</span>`,
      `${svcPill(s.status)}${s.status === 'active' ? `<a class="btn btn-secondary btn-sm" href="/services/${esc(s.slug)}" target="_blank" rel="noopener">${icon('external', 'sm')} View public page</a>` : ''}`)}
    ${s.status === 'pending_review' ? `<div class="panel-note warn mb-16">${icon('clock')}<div><strong>In review.</strong> Subtize.ai is reviewing this service. It goes live once the price and official payment QR are set. You can keep editing the details below.</div></div>` : ''}
    ${s.status === 'inactive' ? `<div class="panel-note mb-16">${icon('pause')}<div><strong>Inactive.</strong> This service is hidden from members. Contact Subtize.ai to reactivate it.</div></div>` : ''}
    <div class="split">
      <div class="stack" style="--gap:20px">
        <form class="card" id="edit-svc" novalidate>
          <div class="card-head"><h3>${icon('edit')} Service details</h3><span class="small muted">Updated ${esc(fmtAgo(s.updatedAt))}</span></div>
          <div class="form-grid">
            <div class="field full"><label class="req" for="es-name">Service name</label><input class="input" id="es-name" name="name" required maxlength="100" value="${esc(s.name)}"></div>
            <div class="field"><label for="es-type">Service type</label>
              <select class="select" id="es-type" name="serviceType">${['in_person', 'doorstep', 'online'].map((t) => `<option value="${t}" ${s.serviceType === t ? 'selected' : ''}>${esc(serviceTypeLabel(t))}</option>`).join('')}</select></div>
            <div class="field"><label for="es-hours">Hours</label><input class="input" id="es-hours" name="hours" maxlength="120" value="${esc(s.hours || '')}" placeholder="e.g. 6 am – 10 pm"></div>
            <div class="field full"><label class="req" for="es-short">Short description</label><input class="input" id="es-short" name="shortDescription" maxlength="160" value="${esc(s.shortDescription)}">
              <div class="hint"><span data-count="es-short">0</span>/160</div></div>
            <div class="field full"><label class="req" for="es-desc">Full description</label><textarea class="textarea" id="es-desc" name="description" rows="6" maxlength="4000">${esc(s.description)}</textarea>
              <div class="hint"><span data-count="es-desc">0</span>/4000</div></div>
            <div class="field full"><span class="label req">Available days</span>${dayPicker('availableDays', s.availableDays)}</div>
          </div>
          <h4 class="form-sub">Usage policy</h4>
          <div class="form-grid">
            <div class="field"><label for="es-allowed">Allowed per month</label><input class="input" id="es-allowed" name="allowed" type="number" min="1" max="1000" inputmode="numeric" value="${u.allowed ?? ''}" placeholder="Unlimited"><div class="hint">Blank = unlimited. Applies to new cycles.</div></div>
            <div class="field"><label for="es-unit">Counted in</label><input class="input" id="es-unit" name="unit" maxlength="30" value="${esc(u.unit || 'visits')}"></div>
            <div class="field full"><label for="es-restr">Restrictions</label><textarea class="textarea" id="es-restr" name="restrictions" rows="2" maxlength="1000">${esc(u.restrictions || '')}</textarea></div>
            <div class="field full"><label for="es-rules">Service rules</label><textarea class="textarea" id="es-rules" name="rules" rows="3" maxlength="2000">${esc(u.rules || '')}</textarea></div>
          </div>
          <div class="row end mt-16"><button class="btn btn-primary" type="submit">${icon('check', 'sm')} Save changes</button></div>
        </form>

        <section class="card" id="gallery"></section>
      </div>

      <aside class="stack" style="--gap:20px">
        <section class="card locked-panel">
          <div class="card-head"><h3>${icon('lock')} Pricing &amp; payments</h3><span class="pill tone-neutral plain">${icon('lock', 'sm')} Locked</span></div>
          <dl class="kv">
            <dt>Monthly price</dt><dd><span class="price">${inr(s.monthlyPrice)}</span></dd>
            <dt>Plans</dt><dd>${s.plans.map((n) => `<span class="tag">${monthsLabel(n)}</span>`).join(' ')}</dd>
            <dt>Payment QR</dt><dd>Official Subtize.ai QR</dd>
            <dt>Commission</dt><dd>${state.commission}% platform · ${100 - state.commission}% to you</dd>
            <dt>Settlement</dt><dd>Monthly, to your verified account</dd>
            ${s.maxSubscribers ? `<dt>Capacity</dt><dd>${s.maxSubscribers} subscribers</dd>` : ''}
          </dl>
          <p class="small muted mt-16">Members pay only to the official Subtize.ai QR. These settings are managed by Subtize.ai; changes need approval.</p>
          <button class="btn btn-outline btn-block" type="button" id="btn-cr">${icon('edit', 'sm')} Request a change</button>
        </section>

        <section class="card">
          <div class="card-head"><h3>${icon('users')} At a glance</h3></div>
          <dl class="kv">
            <dt>Subscribers</dt><dd>${s.subscriberCount}</dd>
            <dt>Type</dt><dd>${esc(serviceTypeLabel(s.serviceType))}</dd>
            <dt>Usage</dt><dd>${usageText(u)}</dd>
            <dt>Days</dt><dd>${daysStrip(s.availableDays)}</dd>
            <dt>Added</dt><dd>${esc(fmtDate(s.createdAt))}</dd>
          </dl>
          <a class="btn btn-secondary btn-sm btn-block mt-16" href="#/subscribers?serviceId=${s.id}">${icon('users', 'sm')} See subscribers</a>
        </section>

        <section class="card">
          <div class="card-head"><h3>${icon('inbox')} Change requests</h3></div>
          ${mine.length ? `<ul class="cr-list">${mine.map((r) => {
            const [label, tone] = CR_STATUS[r.status] || [r.status, 'neutral'];
            return `<li>
              <div class="row between top"><b>${esc(FIELD_LABEL[r.field] || r.field)}</b>${tonePill(label, tone)}</div>
              <div class="small soft">${r.currentValue != null ? `${crValue(r.field, r.currentValue)} → ` : ''}<b>${crValue(r.field, r.proposedValue)}</b></div>
              ${r.note ? `<div class="small muted">“${esc(r.note)}”</div>` : ''}
              ${r.decisionNote ? `<div class="small"><span class="muted">Subtize.ai:</span> ${esc(r.decisionNote)}</div>` : ''}
              <div class="small muted">${esc(fmtAgo(r.createdAt))}${r.decidedAt ? ` · decided ${esc(fmtDate(r.decidedAt))}` : ''}</div>
            </li>`;
          }).join('')}</ul>` : '<p class="muted small mb-0">No change requests for this service.</p>'}
        </section>
      </aside>
    </div>`;

  wireCounters(view);
  const form = $('#edit-svc', view);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    const days = [].concat(d.availableDays || []);
    if (!days.length) { toast('Choose at least one available day.', 'bad'); return; }
    const body = {
      name: d.name.trim(), serviceType: d.serviceType, hours: d.hours, shortDescription: d.shortDescription.trim(),
      description: d.description.trim(), availableDays: days,
      usagePolicy: { allowed: d.allowed ?? '', unit: d.unit?.trim() || 'visits', restrictions: d.restrictions, rules: d.rules },
    };
    await busy($('button[type=submit]', form), async () => {
      try {
        const { service } = await api.put(`/api/lister/services/${s.id}`, body);
        toast('Service details saved.');
        setPageTitle(service.name);
        $('.page-head h1', view).textContent = service.name;
      } catch (err) {
        formError(form, err, EDIT_LABELS);
      }
    });
  });

  $('#btn-cr', view).addEventListener('click', () => requestChange(s, mine));
  renderGallery($('#gallery', view), s);
}

/* ── Images ─────────────────────────────────────────────────────────────── */

function renderGallery(host, s) {
  host.innerHTML = `
    <div class="card-head"><h3>${icon('grid')} Photos</h3><span class="small muted">${s.images.length} photo${s.images.length === 1 ? '' : 's'}</span></div>
    ${s.images.length ? `<div class="gallery">${s.images.map((img, i) => `
      <figure class="gallery-item">
        <img src="${esc(img.url)}" alt="Photo ${i + 1} of ${esc(s.name)}" loading="lazy">
        ${i === 0 ? '<span class="gallery-cover">Cover</span>' : ''}
        <button type="button" class="btn btn-danger btn-icon btn-sm" data-del="${img.id}" aria-label="Delete photo ${i + 1}" title="Delete photo">${icon('trash', 'sm')}</button>
      </figure>`).join('')}</div>` : '<p class="muted small">No photos yet. Services with clear photos get more subscribers.</p>'}
    <label class="dropzone mt-16" id="dz">
      <input type="file" accept="image/png,image/jpeg,image/webp" multiple id="img-input">
      ${icon('upload')}
      <div><b class="soft">Add photos</b></div>
      <div class="small">PNG, JPG or WebP · up to 6 at a time · 5 MB each. The first photo is the cover.</div>
    </label>
    <p class="small muted mt-8 mb-0">${icon('info', 'sm')} Photos only, please: no text, prices or phone numbers on images.</p>`;

  const input = $('#img-input', host);
  const dz = $('#dz', host);
  const upload = async (files) => {
    const list = [...files].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (!list.length) { toast('Choose PNG, JPG or WebP images.', 'bad'); return; }
    if (list.length > 6) { toast('Upload up to 6 photos at a time.', 'bad'); return; }
    const big = list.find((f) => f.size > 5 * 1024 * 1024);
    if (big) { toast(`${big.name} is larger than 5 MB.`, 'bad'); return; }
    const fd = new FormData();
    list.forEach((f) => fd.append('images', f));
    dz.classList.add('is-busy');
    dz.setAttribute('aria-busy', 'true');
    try {
      const { service } = await api.upload(`/api/lister/services/${s.id}/images`, fd);
      toast(`${list.length} photo${list.length === 1 ? '' : 's'} added.`);
      renderGallery(host, service);
    } catch (err) { fail(err); dz.classList.remove('is-busy'); }
  };
  input.addEventListener('change', () => { if (input.files.length) upload(input.files); });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files); });

  $$('[data-del]', host).forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmAction({ title: 'Delete this photo?', message: 'Members will no longer see it. This cannot be undone.', confirm: 'Delete photo' });
    if (!ok) return;
    await busy(b, async () => {
      try {
        const { service } = await api.del(`/api/lister/services/${s.id}/images/${b.dataset.del}`);
        toast('Photo deleted.');
        renderGallery(host, service);
      } catch (err) { fail(err); }
    });
  }));
}

/* ── Change request ─────────────────────────────────────────────────────── */

async function requestChange(s, existing) {
  const pending = new Set(existing.filter((r) => r.status === 'pending').map((r) => r.field));
  const opts = Object.entries(FIELD_LABEL);
  const body = `
    <p>Pricing, plans, the official payment QR and settlement settings are managed by Subtize.ai. Tell us what you would like changed; it only takes effect once approved.</p>
    <div class="stack mt-16">
      <div class="field"><label for="cr-field">What should change?</label>
        <select class="select" id="cr-field" name="field">${opts.map(([k, l]) => `<option value="${k}" ${pending.has(k) ? 'disabled' : ''}>${esc(l)}${pending.has(k) ? ' (request pending)' : ''}</option>`).join('')}</select></div>
      <div class="field"><label for="cr-value" id="cr-value-label">Proposed value</label>
        <div class="input-group" id="cr-value-wrap"><span class="input-prefix" id="cr-prefix">₹</span><input class="input" id="cr-value" name="proposedValue" autocomplete="off"></div>
        <div class="hint" id="cr-hint"></div></div>
      <div class="field"><label for="cr-note">Note for Subtize.ai <span class="muted">(optional)</span></label><textarea class="textarea" id="cr-note" name="note" rows="3" maxlength="500" placeholder="Why the change is needed"></textarea></div>
    </div>`;
  const HINTS = {
    monthly_price: ['Proposed monthly price (₹)', `Currently ${inr(s.monthlyPrice)} per month. Enter rupees, e.g. 1100.`, true, 'number'],
    plan_months: ['Plan lengths (months)', `Currently ${s.plans.join(', ')}. Enter a comma-separated list, e.g. 1, 3, 6.`, false, 'text'],
    payment_qr: ['What needs to change?', 'Describe the problem with the payment QR shown to members.', false, 'text'],
    settlement: ['What needs to change?', 'e.g. new bank account or settlement UPI. Subtize.ai will re-verify it.', false, 'text'],
    other: ['What needs to change?', 'Anything else that only Subtize.ai can change.', false, 'text'],
  };
  const firstFree = opts.find(([k]) => !pending.has(k))?.[0];
  if (!firstFree) { toast('You already have pending requests for every field on this service.', 'info'); return; }

  const done = await modal({
    title: 'Request a change',
    body,
    confirm: 'Send request',
    onOpen: (box) => {
      const sel = $('#cr-field', box);
      sel.value = firstFree;
      const sync = () => {
        const [label, hint, money, type] = HINTS[sel.value];
        $('#cr-value-label', box).textContent = label;
        $('#cr-hint', box).textContent = hint;
        $('#cr-prefix', box).hidden = !money;
        $('#cr-value-wrap', box).classList.toggle('no-prefix', !money);
        const inp = $('#cr-value', box);
        inp.type = type;
        if (money) { inp.min = '1'; inp.inputMode = 'numeric'; } else { inp.removeAttribute('min'); inp.inputMode = 'text'; }
      };
      sel.addEventListener('change', sync);
      sync();
    },
    onSubmit: async (box) => {
      const d = formData(box);
      if (!d.proposedValue?.trim()) throw new Error('Enter the value you would like.');
      return api.post(`/api/lister/services/${s.id}/change-requests`, { field: d.field, proposedValue: d.proposedValue.trim(), note: d.note });
    },
  });
  if (done) {
    toast('Change request sent to Subtize.ai.');
    go(`/services/${s.id}`);
  }
}

