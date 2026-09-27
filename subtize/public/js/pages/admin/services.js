/* Service Management: catalogue list, add/edit form, detail, and lister change requests. */
import { api } from '../../api.js';
import { go, pageHead } from '../../shell.js';
import { $, DAY_SHORT, confirmAction, debounce, esc, fmtAgo, fmtDate, fmtDateTime, icon, inr, modal, pill, toast, tonePill } from '../../ui.js';
import { dayPicker, emptyState, serviceTypeLabel, statTile } from '../../components.js';
import {
  SERVICE_STATUSES, agreementPill, appStatusPill, card, changeFieldLabel, changeValue, clearFormError, copyBtn, dash, fieldError, filterTabs,
  formErrorSlot, hrefWith, kv, loadingRow, money, mono, mount, notice, on, orDash, planLabel, run, rupeesValue, scheduleBadgeRefresh, searchBox,
  setQuery, table,
} from './common.js';

/* ── Shared actions ────────────────────────────────────────────────────── */

async function setStatus(s, status, btn) {
  if (status !== 'active') {
    const ok = await confirmAction({
      title: `Mark as ${status === 'inactive' ? 'inactive' : status.replace('_', ' ')}?`,
      message: `<b>${esc(s.name)}</b> will no longer be listed for members. Existing subscriptions keep running until they end.`,
      confirm: status === 'inactive' ? 'Deactivate' : 'Change status',
    });
    if (!ok) return null;
  }
  btn?.classList.add('is-loading');
  try {
    const res = await api.post(`/api/admin/services/${s.id}/status`, { status });
    toast(status === 'active' ? `${s.name} is live` : `${s.name} is now ${status.replace('_', ' ')}`);
    scheduleBadgeRefresh();
    return res.service;
  } catch (err) {
    if (err.status === 400 && status === 'active') notice('This service cannot be activated yet', err.message);
    else toast(err.message, 'bad');
    return null;
  } finally { btn?.classList.remove('is-loading'); }
}

async function deleteService(s) {
  const ok = await confirmAction({
    title: 'Delete this service?',
    message: `<b>${esc(s.name)}</b> (${esc(s.publicId)}) is removed from the catalogue and from these lists. Payment and subscription records are kept.`,
    confirm: 'Delete service',
  });
  if (!ok) return false;
  const url = `/api/admin/services/${s.id}`;
  try {
    await api.del(url);
  } catch (err) {
    if (err.status !== 409) { toast(err.message, 'bad'); return false; }
    const force = await confirmAction({
      title: 'Members still depend on this service',
      message: `${esc(err.message)}<br><br>Deleting anyway does <b>not</b> cancel their subscriptions — cancel or honour them from Subscription Management.`,
      confirm: 'Delete anyway',
      typeToConfirm: 'DELETE',
    });
    if (!force) return false;
    try { await api.del(url, { force: true }); } catch (e2) { toast(e2.message, 'bad'); return false; }
  }
  toast('Service deleted.');
  scheduleBadgeRefresh();
  return true;
}

const listerLabel = (s) => (s.lister
  ? `<span class="cell-title">${esc(s.lister.businessName || s.lister.name)}</span><div class="cell-sub">${esc(s.lister.name)}</div>`
  : '<span class="tag">Subtize.ai Direct</span>');

/* ── List ──────────────────────────────────────────────────────────────── */

export async function renderServices({ view, query }) {
  const tab = SERVICE_STATUSES.some((t) => t.key === query.get('tab')) ? query.get('tab') : 'all';
  let q = query.get('q') || '';
  const category = query.get('category') || '';
  const params = () => ({ status: tab === 'all' ? '' : tab, q, category });
  const [first, cats, changes] = await Promise.all([
    api.get('/api/admin/services', params()),
    api.get('/api/admin/categories'),
    api.get('/api/admin/change-requests', { status: 'pending' }).catch(() => ({ requests: [] })),
  ]);
  const counts = first.counts || {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const tabItems = [{ key: 'all', label: 'All', count: all }, ...SERVICE_STATUSES.map((t) => ({ ...t, count: counts[t.key] || 0 }))];

  const root = mount(view, `
    ${pageHead('Service Management', 'Every service in the catalogue. Provider details are internal and never shown to members.', `
      <a class="btn btn-secondary" href="#/services/changes">${icon('edit')} Change requests${changes.requests.length ? ` <span class="badge">${changes.requests.length}</span>` : ''}</a>
      <a class="btn btn-primary" href="#/services/new">${icon('plus')} Add service</a>`)}
    ${filterTabs(tabItems, tab, '/services', query)}
    <div class="adm-toolbar">
      ${searchBox(q, 'Search name, area, service ID, lister or provider')}
      <label class="adm-filter"><span class="sr-only">Category</span>
        <select class="select" data-category>
          <option value="">All categories</option>
          ${cats.categories.map((c) => `<option value="${esc(c.slug)}" ${c.slug === category ? 'selected' : ''}>${esc(c.name)} (${c.services})</option>`).join('')}
        </select></label>
    </div>
    <div data-list></div>`);

  const listEl = $('[data-list]', root);
  let rows = first.services;
  const draw = () => {
    listEl.innerHTML = `<p class="muted small mb-8">${rows.length} service${rows.length === 1 ? '' : 's'}</p>${table([
      { label: 'ID', render: (s) => mono(s.publicId) },
      { label: 'Service', cls: 'wide', render: (s) => `<a class="cell-title" href="#/services/${s.id}">${esc(s.name)}</a><div class="cell-sub">${esc(serviceTypeLabel(s.serviceType))}</div>` },
      { label: 'Category', render: (s) => esc(s.category.name) },
      { label: 'Area', render: (s) => `${esc(s.area)}<div class="cell-sub">${esc(s.city)}</div>` },
      { label: 'Price / mo', cls: 'right', render: (s) => money(s.monthlyPrice) },
      { label: 'Status', render: (s) => pill(s.status) },
      { label: 'Subscribers', cls: 'right', render: (s) => `<span class="num">${s.subscriberCount}</span>${s.maxSubscribers ? `<span class="cell-sub"> / ${s.maxSubscribers}</span>` : ''}` },
      { label: 'Lister', cls: 'mid', render: listerLabel },
      {
        label: 'Actions',
        cls: 'nowrap',
        render: (s) => `<div class="row adm-actions">
          <a class="btn btn-ghost btn-icon btn-sm" href="#/services/${s.id}" title="View" aria-label="View ${esc(s.name)}">${icon('eye')}</a>
          <a class="btn btn-ghost btn-icon btn-sm" href="#/services/${s.id}/edit" title="Edit" aria-label="Edit ${esc(s.name)}">${icon('edit')}</a>
          ${s.status === 'active'
            ? `<button type="button" class="btn btn-secondary btn-icon btn-sm" data-act="deactivate" title="Deactivate" aria-label="Deactivate ${esc(s.name)}">${icon('pause')}</button>`
            : `<button type="button" class="btn btn-outline btn-icon btn-sm" data-act="activate" title="Activate" aria-label="Activate ${esc(s.name)}">${icon('play')}</button>`}
          <button type="button" class="btn btn-ghost btn-icon btn-sm adm-danger-icon" data-act="delete" title="Delete" aria-label="Delete ${esc(s.name)}">${icon('trash')}</button>
        </div>`,
      },
    ], rows, {
      rowAttrs: (s) => `data-id="${s.id}"`,
      empty: emptyState({ ic: 'store', title: 'No services match', text: 'Try another status, category or search.', action: '<a class="btn btn-primary" href="#/services/new">Add service</a>' }),
    })}`;
  };
  draw();

  const reload = async () => {
    listEl.innerHTML = loadingRow;
    try { rows = (await api.get('/api/admin/services', params())).services; draw(); } catch (err) { toast(err.message, 'bad'); listEl.innerHTML = ''; }
  };

  on(root, 'input', '[data-search]', debounce((e) => { q = e.target.value.trim(); setQuery({ q }); reload(); }, 300));
  on(root, 'change', '[data-category]', (e) => { location.hash = hrefWith('/services', query, { category: e.target.value, q }).slice(1); });
  on(root, 'click', '[data-act]', async (e, btn) => {
    const s = rows.find((x) => String(x.id) === btn.closest('[data-id]').dataset.id);
    const act = btn.dataset.act;
    if (act === 'delete') { if (await deleteService(s)) reload(); return; }
    const updated = await setStatus(s, act === 'activate' ? 'active' : 'inactive', btn);
    if (updated) reload();
  });
}

/* ── Add / edit form ───────────────────────────────────────────────────── */

const FIELD_MAP = {
  'Service name': 'name', Category: 'category', 'Short description': 'shortDescription', Description: 'description',
  'Location / area': 'area', City: 'city', Latitude: 'lat', Longitude: 'lng', 'Monthly price': 'monthlyPrice',
  'Available days': 'availableDays', Hours: 'hours', 'Allowed usage': 'usageAllowed', 'Usage unit': 'usageUnit',
  Restrictions: 'usageRestrictions', 'Service rules': 'usageRules', 'Maximum subscribers': 'maxSubscribers',
  'Official payment UPI ID': 'paymentUpiId', 'Payee name': 'paymentPayee', 'Lister account': 'listerId',
  'Provider name': 'providerName', 'Provider contact': 'providerContact', 'Internal notes': 'providerNotes', Status: 'status',
};

const canPublish = (l) => l && l.applicationStatus === 'approved' && l.agreementStatus === 'active';
function standingText(l) {
  if (!l) return { tone: 'good', text: 'Run directly by Subtize.ai. It can be activated at any time.' };
  if (l.status !== 'active') return { tone: 'danger', text: `This lister's account is ${l.status}. Their services cannot go live.` };
  if (l.applicationStatus !== 'approved') return { tone: 'warn', text: `Lister not verified (application ${String(l.applicationStatus || 'missing').replace(/_/g, ' ')}). The service can be saved but not activated.` };
  if (l.agreementStatus !== 'active') {
    const why = { pending_lister: 'the lister has not signed the Lister Agreement', pending_admin: 'the agreement is waiting for Subtize.ai to countersign', terminated: 'the agreement was terminated' }[l.agreementStatus] || 'there is no Lister Agreement';
    return { tone: 'warn', text: `Cannot activate yet: ${why}. Save as draft or in review until the agreement is active.` };
  }
  return { tone: 'good', text: `Verified (${l.verificationId}) and under an active agreement. Can publish.` };
}

export async function renderServiceForm({ view, params }) {
  const editing = Boolean(params.id);
  const [meta, cats, listers, settings, detail] = await Promise.all([
    api.get('/api/meta'),
    api.get('/api/admin/categories'),
    api.get('/api/admin/listers'),
    api.get('/api/admin/settings'),
    editing ? api.get(`/api/admin/services/${params.id}`) : Promise.resolve(null),
  ]);
  const s = detail?.service || null;
  const st = settings.settings;
  const val = (x) => esc(x ?? '');
  const selectedDays = s?.availableDays || ['mon', 'wed', 'fri', 'sat'];
  const plans = s?.plans || [1];
  const areas = [...new Set(meta.locations.map((l) => l.area))];
  const listerOpts = listers.listers.map((l) => `<option value="${l.id}" ${s?.lister?.id === l.id ? 'selected' : ''}>${esc(l.businessName || l.fullName)} — ${esc(l.fullName)}${canPublish(l) ? '' : ' (cannot publish yet)'}</option>`).join('');

  const root = mount(view, `
    <a class="btn btn-ghost btn-sm adm-back" href="${editing ? `#/services/${s.id}` : '#/services'}">${icon('back', 'sm')} ${editing ? 'Back to service' : 'Services'}</a>
    ${pageHead(editing ? `Edit ${s.name}` : 'Add service', editing ? `${esc(s.publicId)} · ${pill(s.status)}` : 'Fill in what members see, the official payment details and the internal provider record.')}
    <form class="adm-form stack" novalidate data-form>
      ${card('Basics', `<div class="form-grid">
        <div class="field full"><label class="req" for="f-name">Service name</label><input id="f-name" class="input" name="name" maxlength="100" value="${val(s?.name)}" placeholder="e.g. Iron Paradise Gym, Rajpur Road" required></div>
        <div class="field"><label class="req" for="f-cat">Category</label><select id="f-cat" class="select" name="category" required>
          <option value="">Choose a category</option>${cats.categories.map((c) => `<option value="${esc(c.slug)}" ${s?.category.slug === c.slug ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          <span class="hint">Missing one? Add it in <a href="#/settings">Settings</a>.</span></div>
        <div class="field"><label for="f-type">Service type</label><select id="f-type" class="select" name="serviceType">
          ${['in_person', 'doorstep', 'online'].map((t) => `<option value="${t}" ${(s?.serviceType || 'in_person') === t ? 'selected' : ''}>${esc(serviceTypeLabel(t))}</option>`).join('')}</select></div>
        <div class="field full"><label class="req" for="f-short">Short description</label><input id="f-short" class="input" name="shortDescription" maxlength="160" value="${val(s?.shortDescription)}" placeholder="One line shown on the service card (10–160 characters)"></div>
        <div class="field full"><label class="req" for="f-desc">Description</label><textarea id="f-desc" class="textarea" name="description" rows="5" maxlength="4000" placeholder="What members get, the facility, batches, what to bring… (at least 30 characters)">${val(s?.description)}</textarea></div>
      </div>`, { ic: 'store' })}

      ${card('Location', `<div class="form-grid">
        <div class="field"><label class="req" for="f-area">Location / area</label><input id="f-area" class="input" name="area" list="dl-areas" value="${val(s?.area)}" placeholder="Pick a known area or type one" autocomplete="off">
          <datalist id="dl-areas">${areas.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
          <span class="hint">Known areas fill in the map position automatically.</span></div>
        <div class="field"><label class="req" for="f-city">City</label><input id="f-city" class="input" name="city" value="${val(s?.city || st.defaultCity)}"></div>
        <div class="field"><label for="f-lat">Latitude <span class="muted">(optional)</span></label><input id="f-lat" class="input" name="lat" inputmode="decimal" value="${val(s?.lat)}" placeholder="30.3165"></div>
        <div class="field"><label for="f-lng">Longitude <span class="muted">(optional)</span></label><input id="f-lng" class="input" name="lng" inputmode="decimal" value="${val(s?.lng)}" placeholder="78.0322"></div>
      </div>`, { ic: 'pin' })}

      ${card('Plans, price and availability', `<div class="form-grid">
        <div class="field"><label class="req" for="f-price">Monthly price (₹)</label>
          <div class="adm-prefix"><span>₹</span><input id="f-price" class="input" name="monthlyPrice" inputmode="decimal" value="${val(rupeesValue(s?.monthlyPrice))}" placeholder="1299"></div>
          <span class="hint">In rupees. Multi-month plans cost this × months.</span></div>
        <div class="field"><span class="label">Plans offered</span>
          <div class="chips adm-checks">${[1, 3, 6, 12].map((m) => `<label class="check"><input type="checkbox" name="plans" value="${m}" ${plans.includes(m) ? 'checked' : ''}> ${planLabel(m)}</label>`).join('')}</div></div>
        <div class="field full"><span class="label req">Available days</span>${dayPicker('availableDays', selectedDays)}
          <span class="hint">Tick the days the service runs, e.g. Monday, Wednesday, Friday, Saturday.</span></div>
        <div class="field full"><label for="f-hours">Hours</label><input id="f-hours" class="input" name="hours" maxlength="120" value="${val(s?.hours)}" placeholder="e.g. 6 – 10 am, 5 – 9 pm"></div>
      </div>`, { ic: 'calendar' })}

      ${card('Usage policy and limits', `<div class="form-grid">
        <div class="field"><label for="f-allowed">Allowed per month</label><input id="f-allowed" class="input" name="usageAllowed" inputmode="numeric" value="${val(s?.usagePolicy.allowed)}" placeholder="Blank = unlimited">
          <span class="hint">Leave blank for unlimited use.</span></div>
        <div class="field"><label for="f-unit">Unit</label><input id="f-unit" class="input" name="usageUnit" maxlength="30" value="${val(s?.usagePolicy.unit || 'visits')}" placeholder="visits, sessions, meals, washes…"></div>
        <div class="field full"><label for="f-restr">Restrictions</label><textarea id="f-restr" class="textarea" name="usageRestrictions" rows="2" maxlength="1000" placeholder="e.g. One visit per day. Not transferable.">${val(s?.usagePolicy.restrictions)}</textarea></div>
        <div class="field full"><label for="f-rules">Service rules</label><textarea id="f-rules" class="textarea" name="usageRules" rows="2" maxlength="2000" placeholder="e.g. Carry your digital card. Clean shoes on the gym floor.">${val(s?.usagePolicy.rules)}</textarea></div>
        <div class="field"><label for="f-max">Maximum subscribers</label><input id="f-max" class="input" name="maxSubscribers" inputmode="numeric" value="${val(s?.maxSubscribers)}" placeholder="Blank = no limit"></div>
        <div class="field"><span class="label">Coupons</span><label class="row adm-switch"><span class="switch"><input type="checkbox" name="couponsEnabled" ${s?.couponsEnabled === false ? '' : 'checked'}><span></span></span> Members can apply coupons</label></div>
      </div>`, { ic: 'gauge' })}

      ${card('Official payment', `
        <div class="panel-note mb-16">${icon('info')}<div>Members pay only to the official Subtize.ai account. Leave both fields blank to use the platform default from <a href="#/settings">Settings</a>: <b class="mono">${esc(st.upiId)}</b> · ${esc(st.payee)}.</div></div>
        <div class="form-grid">
          <div class="field"><label for="f-upi">Official UPI ID for this service</label><input id="f-upi" class="input mono" name="paymentUpiId" value="${val(s?.payment.upiId)}" placeholder="${esc(st.upiId)} (default)" autocomplete="off"></div>
          <div class="field"><label for="f-payee">Payee name</label><input id="f-payee" class="input" name="paymentPayee" maxlength="80" value="${val(s?.payment.payee)}" placeholder="${esc(st.payee)} (default)"></div>
        </div>
        <div data-qr class="mt-16">${editing ? '' : '<p class="muted small">Save the service first to attach an official QR image or preview the generated QR.</p>'}</div>`, { ic: 'qr' })}

      ${card('Lister and status', `<div class="form-grid">
        <div class="field"><label for="f-lister">Lister account</label><select id="f-lister" class="select" name="listerId">
          <option value="">None — run by Subtize.ai</option>${listerOpts}</select></div>
        <div class="field"><label for="f-status">Status</label><select id="f-status" class="select" name="status">
          ${SERVICE_STATUSES.map((o) => `<option value="${o.key}" ${(s?.status || 'draft') === o.key ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
          <span class="hint">Only Active services are shown to members.</span></div>
        <div class="full" data-standing></div>
      </div>`, { ic: 'briefcase' })}

      <section class="card adm-internal">
        <div class="card-head"><h3><span class="icon-tile sm adm-lock">${icon('lock')}</span>Internal provider information</h3>${tonePill('Never shown to users', 'warn')}</div>
        <p class="muted small">Who actually delivers this service. Visible only in this console (and to the lister themselves).</p>
        <div class="form-grid">
          <div class="field"><label for="f-pname">Provider name</label><input id="f-pname" class="input" name="providerName" maxlength="160" value="${val(s?.provider.name)}"></div>
          <div class="field"><label for="f-pcontact">Provider contact</label><input id="f-pcontact" class="input" name="providerContact" maxlength="160" value="${val(s?.provider.contact)}" placeholder="Phone or email"></div>
          <div class="field full"><label for="f-pnotes">Internal notes</label><textarea id="f-pnotes" class="textarea" name="providerNotes" rows="3" maxlength="2000">${val(s?.provider.notes)}</textarea></div>
        </div>
      </section>

      ${card('Images', `<div data-images>${editing ? '' : '<p class="muted small">Save the service first, then upload up to 6 images at a time.</p>'}</div>`, { ic: 'upload' })}

      <div class="adm-form-foot">
        ${formErrorSlot}
        <div class="row end wrap">
          <a class="btn btn-secondary" href="${editing ? `#/services/${s.id}` : '#/services'}">Cancel</a>
          <button type="submit" class="btn btn-primary">${icon('check')} ${editing ? 'Save changes' : 'Create service'}</button>
        </div>
      </div>
    </form>`);

  const form = $('[data-form]', root);
  const byId = new Map(listers.listers.map((l) => [String(l.id), l]));

  const drawStanding = () => {
    const l = byId.get(form.elements.listerId.value) || null;
    const { tone, text } = standingText(l);
    const activeBlocked = l && !canPublish(l) && form.elements.status.value === 'active';
    $('[data-standing]', root).innerHTML = `<div class="panel-note ${activeBlocked ? 'danger' : tone}">${icon(tone === 'good' && !activeBlocked ? 'shield' : 'alert')}<div>${esc(text)}${activeBlocked ? ' <b>Saving as Active will be refused.</b>' : ''}</div></div>`;
  };
  drawStanding();
  on(root, 'change', '[name=listerId], [name=status]', drawStanding);

  let current = s;
  if (editing) { drawQr(root, current, (x) => { current = x; }); drawImages(root, current, (x) => { current = x; }); }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError(form);
    const fd = new FormData(form);
    const g = (k) => (fd.get(k) ?? '').toString().trim();
    const body = {
      name: g('name'), category: g('category'), shortDescription: g('shortDescription'), description: g('description'),
      area: g('area'), city: g('city'), lat: g('lat'), lng: g('lng'), serviceType: g('serviceType'),
      monthlyPrice: g('monthlyPrice'), plans: fd.getAll('plans').map(Number), availableDays: fd.getAll('availableDays'), hours: g('hours'),
      usagePolicy: { allowed: g('usageAllowed'), unit: g('usageUnit'), restrictions: g('usageRestrictions'), rules: g('usageRules') },
      maxSubscribers: g('maxSubscribers'), couponsEnabled: form.elements.couponsEnabled.checked,
      paymentUpiId: g('paymentUpiId'), paymentPayee: g('paymentPayee'), listerId: g('listerId'),
      providerName: g('providerName'), providerContact: g('providerContact'), providerNotes: g('providerNotes'), status: g('status'),
    };
    const fail = (err) => fieldError(form, err, FIELD_MAP);
    if (!body.plans.length) return fail({ message: 'Offer at least one plan duration.', details: {} });
    const btn = $('button[type=submit]', form);
    btn.classList.add('is-loading');
    try {
      const res = editing ? await api.put(`/api/admin/services/${s.id}`, body) : await api.post('/api/admin/services', body);
      scheduleBadgeRefresh();
      if (editing) { toast('Service saved.'); go(`/services/${s.id}`); } else {
        toast('Service created. You can now attach the official QR and images.');
        go(`/services/${res.service.id}/edit`);
      }
    } catch (err) { fail(err); } finally { btn.classList.remove('is-loading'); }
  });
}

function drawQr(root, s, set) {
  const host = $('[data-qr]', root);
  const draw = (svc) => {
    host.innerHTML = `
      <div class="adm-qr-row">
        <div class="adm-qr-box">${svc.payment.qrAttached ? `<img src="${esc(svc.payment.qrUrl)}?v=${Date.now()}" alt="Official QR image attached to this service">` : `<div class="muted small center">${icon('qr', 'lg')}No QR image attached</div>`}</div>
        <div class="stack grow" style="--gap:10px">
          <div class="small soft">Payments for this service go to <b class="mono">${esc(svc.payment.effectiveUpiId)}</b> · ${esc(svc.payment.effectivePayee)}${svc.payment.upiId ? '' : ' <span class="muted">(platform default)</span>'}.</div>
          <div class="small muted">${svc.payment.qrAttached ? 'Members see the attached official QR image.' : 'Members see a QR generated from the UPI ID above with the exact amount.'}</div>
          <div class="row wrap">
            <label class="btn btn-secondary btn-sm adm-file">${icon('upload', 'sm')} ${svc.payment.qrAttached ? 'Replace QR image' : 'Attach official QR image'}<input type="file" accept="image/png,image/jpeg,image/webp" data-qr-file hidden></label>
            ${svc.payment.qrAttached ? `<button type="button" class="btn btn-danger-outline btn-sm" data-qr-remove>${icon('trash', 'sm')} Remove</button>` : ''}
            <button type="button" class="btn btn-outline btn-sm" data-qr-preview>${icon('eye', 'sm')} Preview generated QR</button>
          </div>
        </div>
      </div>`;
  };
  draw(s);
  on(host, 'change', '[data-qr-file]', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('qr', file);
    const res = await run(host.querySelector('.adm-file'), () => api.upload(`/api/admin/services/${s.id}/qr`, fd), 'Official QR attached.');
    if (res?.service) { set(res.service); draw(res.service); }
  });
  on(host, 'click', '[data-qr-remove]', async (e, btn) => {
    const ok = await confirmAction({ title: 'Remove the QR image?', message: 'Members will see a QR generated from the service UPI ID instead.', confirm: 'Remove QR' });
    if (!ok) return;
    const res = await run(btn, () => api.del(`/api/admin/services/${s.id}/qr`), 'QR image removed.');
    if (res?.service) { set(res.service); draw(res.service); }
  });
  on(host, 'click', '[data-qr-preview]', (e, btn) => previewQr(s.id, btn));
}

export async function previewQr(serviceId, btn) {
  const res = await run(btn, () => api.get(`/api/admin/services/${serviceId}/qr-preview`));
  if (!res) return;
  modal({
    title: 'Generated payment QR',
    body: `<div class="adm-qr-preview"><img src="${esc(res.image)}" alt="Generated UPI QR for the monthly price"></div>
      <p class="small muted mt-16">Built from the saved UPI ID, payee and monthly price, with a sample reference. Each real checkout gets its own reference.</p>
      <div class="row adm-uri"><span class="mono small grow">${esc(res.upiUri)}</span>${copyBtn(res.upiUri, 'Copy UPI link')}</div>`,
    cancel: 'Close',
    hideConfirm: true,
  });
}

function drawImages(root, s, set) {
  const host = $('[data-images]', root);
  const draw = (svc) => {
    host.innerHTML = `
      ${svc.images.length ? `<div class="adm-thumbs">${svc.images.map((i) => `<figure class="adm-thumb"><img src="${esc(i.url)}" alt="" loading="lazy">
        <button type="button" class="btn btn-danger btn-icon btn-sm" data-img-del="${i.id}" aria-label="Delete image">${icon('trash', 'sm')}</button></figure>`).join('')}</div>` : '<p class="muted small">No images yet. Services without images show their category icon.</p>'}
      <label class="dropzone mt-16 adm-drop">${icon('upload')} <span>Upload images (JPG, PNG or WebP, up to 6 at a time)</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple data-img-file></label>`;
  };
  draw(s);
  on(host, 'change', '[data-img-file]', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const fd = new FormData();
    files.slice(0, 6).forEach((f) => fd.append('images', f));
    host.querySelector('.adm-drop')?.classList.add('drag');
    const res = await run(null, () => api.upload(`/api/admin/services/${s.id}/images`, fd), `${files.length} image${files.length === 1 ? '' : 's'} uploaded.`);
    if (res?.service) { set(res.service); draw(res.service); } else host.querySelector('.adm-drop')?.classList.remove('drag');
  });
  on(host, 'click', '[data-img-del]', async (e, btn) => {
    const ok = await confirmAction({ title: 'Delete this image?', message: 'It is removed from the service straight away.', confirm: 'Delete image' });
    if (!ok) return;
    const res = await run(btn, () => api.del(`/api/admin/services/${s.id}/images/${btn.dataset.imgDel}`), 'Image deleted.');
    if (res?.service) { set(res.service); draw(res.service); }
  });
}

/* ── Detail ────────────────────────────────────────────────────────────── */

export async function renderServiceDetail({ view, params }) {
  const data = await api.get(`/api/admin/services/${params.id}`);
  const s = data.service;
  const standing = s.lister?.standing;
  const u = s.usagePolicy;

  const subCols = [
    { label: 'Subscription', render: (x) => `<a class="mono" href="#/subscriptions/${esc(x.id)}">${esc(x.id)}</a>` },
    { label: 'Member', render: (x) => esc(x.user || x.userName) },
    { label: 'Plan', render: (x) => esc(planLabel(x.months)) },
    { label: 'Status', render: (x) => pill(x.status) },
    { label: 'Period', render: (x) => (x.startDate ? `${esc(fmtDate(x.startDate))} – ${esc(fmtDate(x.endDate))}` : dash) },
    { label: 'Days left', cls: 'right', render: (x) => (x.status === 'active' ? `<span class="num">${x.remainingDays}</span>` : dash) },
    { label: 'Payment', render: (x) => (x.payment ? `${money(x.payment.finalAmount)} ${pill(x.payment.status)}` : dash) },
  ];

  const root = mount(view, `
    <a class="btn btn-ghost btn-sm adm-back" href="#/services">${icon('back', 'sm')} Services</a>
    ${pageHead(s.name, `${mono(s.publicId)} · ${esc(s.category.name)} · ${esc(s.area)}, ${esc(s.city)} · ${pill(s.status)}`, `
      ${s.status === 'active' ? `<a class="btn btn-ghost" href="/services/${esc(s.slug)}" target="_blank" rel="noopener">${icon('external')} Public page</a>` : ''}
      <a class="btn btn-secondary" href="#/services/${s.id}/edit">${icon('edit')} Edit</a>
      ${s.status === 'active'
        ? `<button type="button" class="btn btn-secondary" data-act="deactivate">${icon('pause')} Deactivate</button>`
        : `<button type="button" class="btn btn-primary" data-act="activate">${icon('play')} Activate</button>`}
      <button type="button" class="btn btn-danger-outline" data-act="delete">${icon('trash')} Delete</button>`)}

    <div class="adm-stats">
      ${statTile({ label: 'Active subscribers', value: String(s.subscriberCount), ic: 'users', sub: s.maxSubscribers ? `of ${s.maxSubscribers} maximum` : 'no maximum', hero: true })}
      ${statTile({ label: 'Monthly price', value: inr(s.monthlyPrice), ic: 'tag', sub: esc(s.plans.map(planLabel).join(' · ')) })}
      ${statTile({ label: 'Cancellations', value: String(data.cancellations.length), ic: 'ban', sub: 'all time' })}
      ${statTile({ label: 'Change requests', value: String(data.changeRequests.filter((c) => c.status === 'pending').length), ic: 'edit', sub: 'pending' })}
    </div>

    <div class="adm-split mt-16">
      <div class="stack">
        ${card('Overview', kv([
          ['Short description', esc(s.shortDescription)],
          ['Description', `<span class="adm-pre">${esc(s.description)}</span>`],
          ['Service type', esc(serviceTypeLabel(s.serviceType))],
          ['Location', `${esc(s.area)}, ${esc(s.city)}${s.lat != null ? ` <span class="muted small mono">(${s.lat}, ${s.lng})</span>` : ''}`],
          ['Available days', `<div class="adm-days">${['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => `<span class="${s.availableDays.includes(d) ? 'on' : ''}">${DAY_SHORT[d]}</span>`).join('')}</div><div class="small muted mt-8">${esc(s.availableDayNames.join(', '))}</div>`],
          ['Hours', orDash(s.hours)],
          ['Usage allowed', u.allowed == null ? `Unlimited ${esc(u.unit)}` : `${u.allowed} ${esc(u.unit)} per month`],
          ['Restrictions', orDash(u.restrictions)],
          ['Service rules', orDash(u.rules)],
          ['Coupons', s.couponsEnabled ? tonePill('Enabled', 'good') : tonePill('Disabled', 'neutral')],
          ['Created', esc(fmtDateTime(s.createdAt))],
          ['Updated', esc(fmtDateTime(s.updatedAt))],
        ]), { ic: 'info' })}
        ${card(`Subscriptions (${data.subscriptions.length})`, table(subCols, data.subscriptions, { empty: '<p class="muted small">No subscriptions yet.</p>' }), { ic: 'layers', actions: `<a class="btn btn-ghost btn-sm" href="#/subscriptions?q=${encodeURIComponent(s.name)}">Open in Subscriptions</a>` })}
        ${card(`Cancellation records (${data.cancellations.length})`, table([
          { label: 'Subscription', render: (x) => `<a class="mono" href="#/subscriptions/${esc(x.id)}">${esc(x.id)}</a>` },
          { label: 'Member', render: (x) => esc(x.user || x.userName) },
          { label: 'Cancelled', render: (x) => esc(fmtDateTime(x.cancelledAt)) },
          { label: 'Reason', render: (x) => orDash(x.cancelReason) },
        ], data.cancellations, { empty: '<p class="muted small">No cancellations.</p>' }), { ic: 'ban' })}
        ${card(`Change requests (${data.changeRequests.length})`, table([
          { label: 'Field', render: (c) => esc(changeFieldLabel(c.field)) },
          { label: 'Current → proposed', render: (c) => `${changeValue(c.field, c.currentValue)} → <b>${changeValue(c.field, c.proposedValue)}</b>` },
          { label: 'Note', render: (c) => orDash(c.note) },
          { label: 'Status', render: (c) => `${pill(c.status)}${c.decisionNote ? `<div class="cell-sub">${esc(c.decisionNote)}</div>` : ''}` },
          { label: 'Requested', render: (c) => esc(fmtAgo(c.createdAt)) },
        ], data.changeRequests, { empty: '<p class="muted small">No change requests.</p>' }), { ic: 'edit', actions: data.changeRequests.some((c) => c.status === 'pending') ? '<a class="btn btn-primary btn-sm" href="#/services/changes">Decide</a>' : '' })}
      </div>
      <div class="stack">
        ${card('Lister standing', s.lister ? `${kv([
          ['Business', esc(s.lister.businessName || '—')],
          ['Lister', `<a href="#/users/${s.lister.id}">${esc(s.lister.name)}</a><div class="cell-sub">${esc(s.lister.email)}</div>`],
          ['Verification ID', mono(standing.verificationId)],
          ['Application', appStatusPill(standing.applicationStatus)],
          ['Agreement', `${agreementPill(standing.agreementStatus)}${standing.agreementId ? ` <span class="mono small muted">${esc(standing.agreementId)}</span>` : ''}`],
        ])}
          <div class="panel-note ${standing.canPublish ? 'good' : 'warn'} mt-16">${icon(standing.canPublish ? 'shield' : 'alert')}<div>${standing.canPublish ? 'Verified and under agreement — this lister can publish.' : 'This lister cannot publish yet, so the service cannot be activated.'}</div></div>`
          : '<p class="soft">Run directly by <b>Subtize.ai</b>. All revenue is platform income.</p>', { ic: 'briefcase' })}
        <section class="card adm-internal">
          <div class="card-head"><h3><span class="icon-tile sm adm-lock">${icon('lock')}</span>Internal provider info</h3>${tonePill('Never shown to users', 'warn')}</div>
          ${kv([['Provider', orDash(s.provider.name)], ['Contact', orDash(s.provider.contact)], ['Notes', s.provider.notes ? `<span class="adm-pre">${esc(s.provider.notes)}</span>` : null]])}
        </section>
        ${card('Official payment', `
          <div class="adm-qr-preview sm" data-qr-img><div class="loading">Loading QR…</div></div>
          ${kv([['UPI ID', `${mono(s.payment.effectiveUpiId)}${s.payment.upiId ? '' : ' <span class="muted small">default</span>'}`], ['Payee', `${esc(s.payment.effectivePayee)}${s.payment.payee ? '' : ' <span class="muted small">default</span>'}`], ['QR image', s.payment.qrAttached ? tonePill('Official image attached', 'good') : tonePill('Generated', 'neutral')]])}`, { ic: 'qr' })}
        ${card('Coupons that apply', s.couponsEnabled
          ? (s.coupons.length ? `<div class="chips">${s.coupons.map((c) => `<span class="tag mono ${c.active ? '' : 'adm-off'}">${esc(c.code)}${c.active ? '' : ' · off'}</span>`).join('')}</div>` : '<p class="muted small">No coupons target this service.</p>')
          : '<p class="muted small">Coupons are disabled for this service.</p>', { ic: 'tag', actions: '<a class="btn btn-ghost btn-sm" href="#/coupons">Coupons</a>' })}
        ${card(`Images (${s.images.length})`, s.images.length ? `<div class="adm-thumbs">${s.images.map((i) => `<figure class="adm-thumb"><img src="${esc(i.url)}" alt="" loading="lazy"></figure>`).join('')}</div>` : '<p class="muted small">No images.</p>', { ic: 'upload' })}
      </div>
    </div>`);

  // QR preview: the attached official image if there is one, else the generated one.
  const qrHost = $('[data-qr-img]', root);
  if (s.payment.qrAttached) {
    qrHost.innerHTML = `<img src="${esc(s.payment.qrUrl)}" alt="Official QR image">`;
  } else {
    api.get(`/api/admin/services/${s.id}/qr-preview`).then((r) => {
      qrHost.innerHTML = `<img src="${esc(r.image)}" alt="Generated UPI QR at the monthly price"><div class="small muted center mt-8">Generated at ${esc(inr(s.monthlyPrice))}</div>`;
    }).catch(() => { qrHost.innerHTML = '<p class="muted small">QR preview unavailable.</p>'; });
  }

  on(root, 'click', '[data-act]', async (e, btn) => {
    const act = btn.dataset.act;
    if (act === 'delete') { if (await deleteService(s)) go('/services'); return; }
    const updated = await setStatus(s, act === 'activate' ? 'active' : 'inactive', btn);
    if (updated) go(`/services/${s.id}`);
  });
}

/* ── Change requests ───────────────────────────────────────────────────── */

const CR_TABS = [{ key: 'pending', label: 'Pending' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }, { key: 'all', label: 'All' }];

export async function renderChangeRequests({ view, query }) {
  const tab = CR_TABS.some((t) => t.key === query.get('tab')) ? query.get('tab') : 'pending';
  const all = (await api.get('/api/admin/change-requests')).requests;
  const counts = { all: all.length };
  for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
  const rows = tab === 'all' ? all : all.filter((r) => r.status === tab);

  const root = mount(view, `
    <a class="btn btn-ghost btn-sm adm-back" href="#/services">${icon('back', 'sm')} Services</a>
    ${pageHead('Change requests', 'Listers cannot change prices or plan durations themselves. Approving applies the change to the service immediately.')}
    ${filterTabs(CR_TABS.map((t) => ({ ...t, count: counts[t.key] || 0 })), tab, '/services/changes', query)}
    ${table([
      { label: 'Service', render: (c) => `<a class="cell-title" href="#/services/${c.serviceId}">${esc(c.service)}</a><div class="cell-sub">${esc(c.lister)}</div>` },
      { label: 'Field', render: (c) => esc(changeFieldLabel(c.field)) },
      { label: 'Current', render: (c) => changeValue(c.field, c.currentValue) },
      { label: 'Proposed', render: (c) => `<b>${changeValue(c.field, c.proposedValue)}</b>` },
      { label: 'Lister note', render: (c) => orDash(c.note) },
      { label: 'Requested', render: (c) => `<span title="${esc(fmtDateTime(c.createdAt))}">${esc(fmtAgo(c.createdAt))}</span>` },
      { label: 'Status', render: (c) => `${pill(c.status)}${c.decisionNote ? `<div class="cell-sub">${esc(c.decisionNote)}</div>` : ''}${c.decidedAt ? `<div class="cell-sub">${esc(fmtDate(c.decidedAt))}</div>` : ''}` },
      {
        label: 'Decision',
        cls: 'nowrap',
        render: (c) => (c.status === 'pending' ? `<div class="row adm-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="approve">${icon('check', 'sm')} Approve</button>
          <button type="button" class="btn btn-danger-outline btn-sm" data-act="reject">Reject</button></div>` : dash),
      },
    ], rows, {
      rowAttrs: (c) => `data-id="${c.id}"`,
      empty: emptyState({ ic: 'edit', title: tab === 'pending' ? 'No pending requests' : 'Nothing here', text: 'Listers request price and plan changes from their dashboard.' }),
    })}`);

  on(root, 'click', '[data-act]', async (e, btn) => {
    const c = rows.find((x) => String(x.id) === btn.closest('[data-id]').dataset.id);
    const summary = `<p><b>${esc(c.service)}</b> — ${esc(changeFieldLabel(c.field))}: ${changeValue(c.field, c.currentValue)} → <b>${changeValue(c.field, c.proposedValue)}</b></p>${c.note ? `<p class="muted small">Lister's note: ${esc(c.note)}</p>` : ''}`;
    if (btn.dataset.act === 'approve') {
      const ok = await modal({
        title: 'Approve this change?',
        body: `${summary}<div class="panel-note mt-16">${icon('info')}<div>The new value applies to the service straight away. Existing paid plans keep the price they were bought at.</div></div>
          <div class="field mt-16"><label for="cr-note">Note to the lister <span class="muted">(optional)</span></label><textarea id="cr-note" class="textarea" name="note" rows="2"></textarea></div>`,
        confirm: 'Approve change',
        onSubmit: (f) => api.post(`/api/admin/change-requests/${c.id}/approve`, { note: f.elements.note.value.trim() }),
      });
      if (ok) { toast('Change approved and applied.'); scheduleBadgeRefresh(); go(`/services/changes?tab=${tab}`); }
    } else {
      const note = await confirmAction({ title: 'Reject this change?', message: summary, confirm: 'Reject change', reason: true, reasonLabel: 'Reason for the lister' });
      if (note === null) return;
      const res = await run(btn, () => api.post(`/api/admin/change-requests/${c.id}/reject`, { note }), 'Change request rejected.');
      if (res) { scheduleBadgeRefresh(); go(`/services/changes?tab=${tab}`); }
    }
  });
}

