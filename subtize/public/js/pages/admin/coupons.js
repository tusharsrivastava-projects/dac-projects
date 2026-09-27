/* Coupon Management: create, edit, switch on/off and delete discount codes. */
import { api } from '../../api.js';
import { go, pageHead } from '../../shell.js';
import { $, confirmAction, esc, fmtDate, icon, inr, modal, showFieldError, toast, tonePill } from '../../ui.js';
import { emptyState, statTile } from '../../components.js';
import { dash, mount, on, rupeesValue, table } from './common.js';

const FIELD_MAP = {
  'Coupon code': 'code', Description: 'description', 'Discount type': 'discountType', 'Discount %': 'discountValue', 'Discount amount': 'discountValue',
  'Maximum discount': 'maxDiscount', 'Minimum subscription value': 'minValue', 'Start date': 'startsOn', 'Expiry date': 'expiresOn',
  'Usage limit': 'usageLimit', 'Per-user limit': 'perUserLimit', Service: 'serviceId',
};

const isoToday = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const discountLabel = (c) => (c.discountType === 'percent' ? `${c.discountValue}% off` : `${inr(c.discountValue)} off`);

function livePill(c) {
  if (c.live) return tonePill('Live', 'good');
  if (!c.active) return tonePill('Off', 'neutral');
  const t = isoToday();
  if (c.startsOn > t) return tonePill('Scheduled', 'info');
  if (c.expiresOn < t) return tonePill('Expired', 'neutral');
  if (c.usageLimit != null && c.used >= c.usageLimit) return tonePill('Used up', 'warn');
  return tonePill('Not live', 'neutral');
}

export async function renderCoupons({ view }) {
  const [data, svc] = await Promise.all([api.get('/api/admin/coupons'), api.get('/api/admin/services')]);
  const coupons = data.coupons;
  const services = svc.services.slice().sort((a, b) => a.name.localeCompare(b.name));

  const root = mount(view, `
    ${pageHead('Coupon Management', 'Discount codes members can apply at checkout. Used coupons are kept for the payment record and can only be switched off.', `
      <button type="button" class="btn btn-primary" data-new>${icon('plus')} Create coupon</button>`)}
    <div class="adm-stats">
      ${statTile({ label: 'Coupons', value: String(coupons.length), ic: 'tag' })}
      ${statTile({ label: 'Live now', value: String(coupons.filter((c) => c.live).length), ic: 'zap', hero: true })}
      ${statTile({ label: 'Times used', value: String(coupons.reduce((n, c) => n + c.used, 0)), ic: 'receipt', sub: 'pending or verified payments' })}
      ${statTile({ label: 'Private codes', value: String(coupons.filter((c) => !c.public).length), ic: 'lock', sub: 'not advertised to members' })}
    </div>
    <div class="mt-16">${table([
      { label: 'Code', render: (c) => `<span class="adm-code">${esc(c.code)}</span>${c.description ? `<div class="cell-sub adm-clamp" title="${esc(c.description)}">${esc(c.description)}</div>` : ''}` },
      { label: 'Applies to', render: (c) => (c.serviceId ? `<a href="#/services/${c.serviceId}">${esc(c.service || `Service #${c.serviceId}`)}</a>` : '<span class="tag">All services</span>') },
      { label: 'Discount', render: (c) => `<b>${esc(discountLabel(c))}</b>` },
      { label: 'Max discount', cls: 'right', render: (c) => (c.maxDiscount != null ? esc(inr(c.maxDiscount)) : dash) },
      { label: 'Min value', cls: 'right', render: (c) => (c.minValue ? esc(inr(c.minValue)) : dash) },
      { label: 'Start', render: (c) => `<span class="nowrap">${esc(fmtDate(c.startsOn))}</span>` },
      { label: 'Expiry', render: (c) => `<span class="nowrap">${esc(fmtDate(c.expiresOn))}</span>` },
      { label: 'Used / limit', cls: 'right', render: (c) => `<span class="num">${c.used}</span><span class="muted"> / ${c.usageLimit ?? '∞'}</span>` },
      { label: 'Per user', cls: 'right', render: (c) => `<span class="num">${c.perUserLimit}</span>` },
      { label: 'Visibility', render: (c) => (c.public ? tonePill('Public', 'info') : tonePill('Private', 'neutral')) },
      { label: 'Active', render: (c) => `<label class="switch" title="${c.active ? 'Switch off' : 'Switch on'}"><input type="checkbox" data-toggle ${c.active ? 'checked' : ''} aria-label="Coupon ${esc(c.code)} active"><span></span></label>` },
      { label: 'State', render: livePill },
      {
        label: '',
        cls: 'nowrap',
        render: () => `<div class="row adm-actions"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-edit title="Edit" aria-label="Edit">${icon('edit')}</button>
          <button type="button" class="btn btn-ghost btn-icon btn-sm adm-danger-icon" data-del title="Delete" aria-label="Delete">${icon('trash')}</button></div>`,
      },
    ], coupons, {
      rowAttrs: (c) => `data-id="${c.id}"`,
      empty: emptyState({ ic: 'tag', title: 'No coupons yet', text: 'Create a code to run an offer.', action: '<button type="button" class="btn btn-primary" data-new>Create coupon</button>' }),
    })}</div>`);

  const find = (el) => coupons.find((c) => String(c.id) === el.closest('[data-id]').dataset.id);
  const reload = () => go('/coupons');

  on(root, 'click', '[data-new]', async () => { if (await couponForm(null, services)) reload(); });
  on(root, 'click', '[data-edit]', async (e, btn) => { if (await couponForm(find(btn), services)) reload(); });
  on(root, 'change', '[data-toggle]', async (e, input) => {
    const c = find(input);
    input.disabled = true;
    try {
      const res = await api.post(`/api/admin/coupons/${c.id}/toggle`);
      Object.assign(c, res.coupon);
      toast(`${c.code} is now ${c.active ? 'on' : 'off'}.`);
      const cell = input.closest('tr').querySelector('td[data-label="State"]');
      if (cell) cell.innerHTML = livePill(c);
    } catch (err) { input.checked = !input.checked; toast(err.message, 'bad'); } finally { input.disabled = false; }
  });
  on(root, 'click', '[data-del]', async (e, btn) => {
    const c = find(btn);
    const ok = await confirmAction({
      title: `Delete ${c.code}?`,
      message: c.used ? `<b>${esc(c.code)}</b> has been used ${c.used} time${c.used === 1 ? '' : 's'}, so it will be <b>switched off</b> rather than deleted, to keep the payment records intact.`
        : `<b>${esc(c.code)}</b> has never been used and will be deleted permanently.`,
      confirm: c.used ? 'Switch off' : 'Delete coupon',
    });
    if (!ok) return;
    btn.classList.add('is-loading');
    try {
      const res = await api.del(`/api/admin/coupons/${c.id}`);
      toast(res.deleted ? `${c.code} deleted.` : `${c.code} has been used, so it was switched off instead of deleted.`, res.deleted ? 'good' : 'info');
      reload();
    } catch (err) { toast(err.message, 'bad'); } finally { btn.classList.remove('is-loading'); }
  });
}

function couponForm(c, services) {
  const v = (x) => esc(x ?? '');
  const type = c?.discountType || 'percent';
  const body = `
    <div class="form-grid">
      <div class="field"><label class="req" for="c-code">Code</label><input id="c-code" class="input mono adm-upper" name="code" maxlength="20" value="${v(c?.code)}" placeholder="MONSOON15" autocomplete="off">
        <span class="hint">3–20 letters or digits. Saved in capitals.</span></div>
      <div class="field"><label for="c-svc">Applies to</label><select id="c-svc" class="select" name="serviceId">
        <option value="">All services</option>${services.map((s) => `<option value="${s.id}" ${c?.serviceId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field full"><label for="c-desc">Description <span class="muted">(optional)</span></label><input id="c-desc" class="input" name="description" maxlength="200" value="${v(c?.description)}" placeholder="Shown with the offer, e.g. 15% off your first month"></div>
      <div class="field"><label for="c-type">Discount type</label><select id="c-type" class="select" name="discountType">
        <option value="percent" ${type === 'percent' ? 'selected' : ''}>Percentage (%)</option><option value="fixed" ${type === 'fixed' ? 'selected' : ''}>Fixed amount (₹)</option></select></div>
      <div class="field"><label class="req" for="c-val" data-val-label>${type === 'percent' ? 'Discount (%)' : 'Discount (₹)'}</label>
        <input id="c-val" class="input" name="discountValue" inputmode="decimal" value="${v(c ? (c.discountType === 'fixed' ? rupeesValue(c.discountValue) : c.discountValue) : '')}" placeholder="${type === 'percent' ? '15' : '100'}">
        <span class="hint" data-val-hint>${type === 'percent' ? 'Whole number, 1–90.' : 'Rupees off the order.'}</span></div>
      <div class="field" data-max><label for="c-max">Maximum discount (₹)</label><input id="c-max" class="input" name="maxDiscount" inputmode="decimal" value="${v(rupeesValue(c?.maxDiscount))}" placeholder="No cap"><span class="hint">Caps a percentage discount.</span></div>
      <div class="field"><label for="c-min">Minimum subscription value (₹)</label><input id="c-min" class="input" name="minValue" inputmode="decimal" value="${v(c?.minValue ? rupeesValue(c.minValue) : '')}" placeholder="0"></div>
      <div class="field"><label class="req" for="c-start">Start date</label><input id="c-start" class="input" type="date" name="startsOn" value="${v(c?.startsOn || isoToday())}"></div>
      <div class="field"><label class="req" for="c-end">Expiry date</label><input id="c-end" class="input" type="date" name="expiresOn" value="${v(c?.expiresOn || isoToday(30))}"></div>
      <div class="field"><label for="c-limit">Total usage limit</label><input id="c-limit" class="input" name="usageLimit" inputmode="numeric" value="${v(c?.usageLimit)}" placeholder="Unlimited"></div>
      <div class="field"><label for="c-per">Uses per member</label><input id="c-per" class="input" name="perUserLimit" inputmode="numeric" value="${v(c?.perUserLimit ?? 1)}"></div>
      <label class="row adm-switch"><span class="switch"><input type="checkbox" name="public" ${c?.public === false ? '' : 'checked'}><span></span></span> Public — shown to members as an offer</label>
      <label class="row adm-switch"><span class="switch"><input type="checkbox" name="active" ${c?.active === false ? '' : 'checked'}><span></span></span> Active</label>
    </div>`;

  return modal({
    title: c ? `Edit ${c.code}` : 'Create coupon',
    body,
    wide: true,
    confirm: c ? 'Save coupon' : 'Create coupon',
    onOpen: (box) => {
      const sync = () => {
        const pct = box.elements.discountType.value === 'percent';
        $('[data-val-label]', box).textContent = pct ? 'Discount (%)' : 'Discount (₹)';
        $('[data-val-hint]', box).textContent = pct ? 'Whole number, 1–90.' : 'Rupees off the order.';
        box.elements.discountValue.placeholder = pct ? '15' : '100';
        $('[data-max]', box).hidden = !pct;
      };
      box.elements.discountType.addEventListener('change', sync);
      sync();
    },
    onSubmit: async (f) => {
      const g = (k) => f.elements[k].value.trim();
      const payload = {
        code: g('code'), description: g('description'), serviceId: g('serviceId'), discountType: g('discountType'), discountValue: g('discountValue'),
        maxDiscount: g('discountType') === 'percent' ? g('maxDiscount') : '', minValue: g('minValue'), startsOn: g('startsOn'), expiresOn: g('expiresOn'),
        usageLimit: g('usageLimit'), perUserLimit: g('perUserLimit'), public: f.elements.public.checked, active: f.elements.active.checked,
      };
      try {
        const res = c ? await api.put(`/api/admin/coupons/${c.id}`, payload) : await api.post('/api/admin/coupons', payload);
        toast(c ? `${res.coupon.code} saved.` : `${res.coupon.code} created${res.coupon.live ? ' and live' : ''}.`);
        return res;
      } catch (err) {
        const name = FIELD_MAP[err.details?.field] || err.details?.field;
        if (name) showFieldError(f, { ...err, details: { field: name } });
        throw err;
      }
    },
  });
}
