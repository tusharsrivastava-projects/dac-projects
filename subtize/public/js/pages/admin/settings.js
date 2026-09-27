/* Settings: platform payment and commission settings, categories, locations, own password. */
import { api } from '../../api.js';
import { go, pageHead } from '../../shell.js';
import { $, esc, icon, toast } from '../../ui.js';
import { card, clearFormError, fieldError, formErrorSlot, mount, table } from './common.js';

const SETTINGS_MAP = {
  'Official UPI ID': 'upiId', 'Payee name': 'payee', Commission: 'commissionPercent', 'Support email': 'supportEmail',
  'Support phone': 'supportPhone', 'Default city': 'defaultCity', 'Expiring-soon window': 'expiringSoonDays',
};
const CATEGORY_ICONS = ['grid', 'dumbbell', 'lotus', 'utensils', 'shirt', 'car', 'book', 'scissors', 'music', 'guitar', 'waves', 'desk', 'milk', 'trophy', 'paw', 'home', 'store', 'sparkle', 'gift', 'star', 'briefcase', 'smartphone', 'globe'];

export async function renderSettings({ view }) {
  const [{ settings: s }, { categories }, meta] = await Promise.all([
    api.get('/api/admin/settings'), api.get('/api/admin/categories'), api.get('/api/meta'),
  ]);
  const v = (x) => esc(x ?? '');

  const root = mount(view, `
    ${pageHead('Settings', 'Platform-wide payment, commission and catalogue settings.')}
    <div class="adm-split">
      <div class="stack">
        <form class="card" data-settings novalidate>
          <div class="card-head"><h3><span class="icon-tile sm">${icon('qr')}</span>Official payments and commission</h3></div>
          <div class="form-grid">
            <div class="field"><label class="req" for="s-upi">Official UPI ID</label><input id="s-upi" class="input mono" name="upiId" value="${v(s.upiId)}" autocomplete="off">
              <span class="hint">Every checkout QR pays this account unless a service has its own official UPI ID.</span></div>
            <div class="field"><label class="req" for="s-payee">Payee name</label><input id="s-payee" class="input" name="payee" maxlength="80" value="${v(s.payee)}"></div>
            <div class="field"><label class="req" for="s-comm">Platform commission (%)</label><input id="s-comm" class="input" name="commissionPercent" type="number" min="0" max="60" step="1" value="${v(s.commissionPercent)}"></div>
            <div class="field"><label class="req" for="s-exp">"Expiring soon" window (days)</label><input id="s-exp" class="input" name="expiringSoonDays" type="number" min="1" max="30" value="${v(s.expiringSoonDays)}">
              <span class="hint">Plans this close to their end date show as expiring.</span></div>
            <div class="full panel-note warn">${icon('alert')}<div><b>Commission changes apply to new agreements only.</b> Listers who already signed keep the rate in their agreement, and revenue and settlements are calculated with that signed rate.</div></div>
          </div>
          <h4 class="mt-24 mb-16">Support and defaults</h4>
          <div class="form-grid">
            <div class="field"><label class="req" for="s-email">Support email</label><input id="s-email" class="input" type="email" name="supportEmail" value="${v(s.supportEmail)}"></div>
            <div class="field"><label class="req" for="s-phone">Support phone</label><input id="s-phone" class="input" name="supportPhone" maxlength="30" value="${v(s.supportPhone)}"></div>
            <div class="field"><label class="req" for="s-city">Default city</label><input id="s-city" class="input" name="defaultCity" maxlength="60" value="${v(s.defaultCity)}"></div>
          </div>
          ${formErrorSlot}
          <div class="row end mt-16"><button type="submit" class="btn btn-primary">${icon('check')} Save settings</button></div>
        </form>

        <section class="card">
          <div class="card-head"><h3><span class="icon-tile sm">${icon('grid')}</span>Categories (${categories.length})</h3></div>
          ${table([
            { label: '', render: (c) => `<span class="icon-tile sm">${icon(c.icon)}</span>` },
            { label: 'Name', render: (c) => `<span class="cell-title">${esc(c.name)}</span>` },
            { label: 'Slug', render: (c) => `<span class="mono small">${esc(c.slug)}</span>` },
            { label: 'Services', cls: 'right', render: (c) => `<a class="num" href="#/services?category=${encodeURIComponent(c.slug)}">${c.services}</a>` },
          ], categories)}
          <form class="adm-inline-form mt-16" data-category novalidate>
            <div class="field grow"><label for="c-name">New category</label><input id="c-name" class="input" name="name" maxlength="60" placeholder="e.g. Swimming"></div>
            <div class="field"><label for="c-icon">Icon</label><select id="c-icon" class="select" name="icon">${CATEGORY_ICONS.map((i) => `<option value="${i}">${i}</option>`).join('')}</select></div>
            <span class="icon-tile sm adm-icon-preview" data-icon-preview>${icon('grid')}</span>
            <button type="submit" class="btn btn-secondary">${icon('plus')} Add</button>
          </form>
        </section>
      </div>

      <div class="stack">
        <form class="card" data-location novalidate>
          <div class="card-head"><h3><span class="icon-tile sm">${icon('pin')}</span>Add a location</h3></div>
          <p class="small muted">Known areas power "near me" search and fill in map positions on the service form. Adding an existing area updates its position.</p>
          <div class="form-grid">
            <div class="field"><label class="req" for="l-area">Area</label><input id="l-area" class="input" name="area" maxlength="80" placeholder="e.g. Sahastradhara Road"></div>
            <div class="field"><label class="req" for="l-city">City</label><input id="l-city" class="input" name="city" maxlength="60" value="${v(s.defaultCity)}"></div>
            <div class="field"><label class="req" for="l-lat">Latitude</label><input id="l-lat" class="input" name="lat" inputmode="decimal" placeholder="30.3165"></div>
            <div class="field"><label class="req" for="l-lng">Longitude</label><input id="l-lng" class="input" name="lng" inputmode="decimal" placeholder="78.0322"></div>
          </div>
          ${formErrorSlot}
          <div class="row end mt-16"><button type="submit" class="btn btn-secondary">${icon('plus')} Add location</button></div>
          <details class="mt-16"><summary class="small soft">${meta.locations.length} known locations</summary>
            <div class="chips mt-8">${meta.locations.map((l) => `<span class="tag" title="${esc(`${l.lat}, ${l.lng}`)}">${esc(l.area)} · ${esc(l.city)}</span>`).join('')}</div></details>
        </form>

        <form class="card" data-password novalidate>
          <div class="card-head"><h3><span class="icon-tile sm">${icon('lock')}</span>Change your password</h3></div>
          <div class="stack" style="--gap:14px">
            <div class="field"><label for="p-cur">Current password</label><input id="p-cur" class="input" type="password" name="currentPassword" autocomplete="current-password"></div>
            <div class="field"><label for="p-new">New password</label><input id="p-new" class="input" type="password" name="newPassword" autocomplete="new-password" minlength="8">
              <span class="hint">At least 8 characters, with a letter and a number.</span></div>
            <div class="field"><label for="p-conf">Confirm new password</label><input id="p-conf" class="input" type="password" name="confirm" autocomplete="new-password"></div>
          </div>
          ${formErrorSlot}
          <div class="row end mt-16"><button type="submit" class="btn btn-secondary">Change password</button></div>
        </form>
      </div>
    </div>`);

  const submit = (sel, fn, map = {}) => {
    const form = $(sel, root);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFormError(form);
      const btn = $('button[type=submit]', form);
      btn.classList.add('is-loading');
      try { await fn(form); } catch (err) { fieldError(form, err, map); } finally { btn.classList.remove('is-loading'); }
    });
    return form;
  };
  const val = (f, k) => f.elements[k].value.trim();

  submit('[data-settings]', async (f) => {
    const body = Object.fromEntries(['upiId', 'payee', 'commissionPercent', 'supportEmail', 'supportPhone', 'defaultCity', 'expiringSoonDays'].map((k) => [k, val(f, k)]));
    const changedCommission = Number(body.commissionPercent) !== s.commissionPercent;
    const res = await api.put('/api/admin/settings', body);
    Object.assign(s, res.settings);
    toast(changedCommission ? `Settings saved. New agreements will use ${res.settings.commissionPercent}% commission.` : 'Settings saved.');
  }, SETTINGS_MAP);

  const catForm = submit('[data-category]', async (f) => {
    const res = await api.post('/api/admin/categories', { name: val(f, 'name'), icon: val(f, 'icon') });
    toast(`Category "${res.category.name}" added.`);
    go('/settings');
  }, { 'Category name': 'name', Icon: 'icon' });
  catForm.elements.icon.addEventListener('change', (e) => { $('[data-icon-preview]', root).innerHTML = icon(e.target.value); });

  submit('[data-location]', async (f) => {
    const body = { area: val(f, 'area'), city: val(f, 'city'), lat: val(f, 'lat'), lng: val(f, 'lng') };
    await api.post('/api/admin/locations', body);
    toast(`${body.area}, ${body.city} saved.`);
    go('/settings');
  }, { Area: 'area', City: 'city', Latitude: 'lat', Longitude: 'lng' });

  submit('[data-password]', async (f) => {
    if (val(f, 'newPassword') !== f.elements.confirm.value) {
      const err = new Error('The new passwords do not match.');
      err.details = { field: 'confirm' };
      throw err;
    }
    await api.post('/api/auth/change-password', { currentPassword: f.elements.currentPassword.value, newPassword: f.elements.newPassword.value });
    f.reset();
    toast('Password changed.');
  }, { 'Current password': 'currentPassword', 'New password': 'newPassword' });
}
