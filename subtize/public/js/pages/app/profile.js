/* #/profile — personal details, avatar, location, refund UPI, referral. */
import { api } from '../../api.js';
import { getPosition } from '../../ai.js';
import { shareApp } from '../../pwa.js';
import { pageHead } from '../../shell.js';
import {
  $, copyText, esc, fmtDate, formData, icon, initials, showFieldError, toast,
} from '../../ui.js';
import { getMeta, markFieldError, mountPage } from './common.js';

const FIELDS = { 'Full name': 'fullName', Phone: 'phone', Address: 'address', City: 'city', 'Preferred location': 'preferredArea', 'UPI ID': 'upiId', 'Payment note': 'paymentNote' };

const avatarHtml = (p) => (p.avatarUrl ? `<img src="${esc(p.avatarUrl)}" alt="">` : esc(initials(p.fullName)));

export async function renderProfile({ view, isCurrent }) {
  const [{ profile: p }, meta, ref] = await Promise.all([
    api.get('/api/me/profile'), getMeta(), api.get('/api/me/referral').catch(() => null),
  ]);
  if (!isCurrent()) return;
  const areaKnown = meta.locations.some((l) => l.area === p.preferredArea);

  const page = mountPage(view, `
    ${pageHead('Profile', 'Your details stay private. Service providers never see your contact information.')}
    <div class="split">
      <form class="card profile-form" novalidate autocomplete="on">
        <div class="profile-top">
          <div class="avatar lg" data-avatar>${avatarHtml(p)}</div>
          <div class="grow">
            <h2>${esc(p.fullName)}</h2>
            <div class="muted small">Member since ${fmtDate(p.createdAt)} · Account <span class="mono">${esc(p.publicId)}</span></div>
            <label class="btn btn-secondary btn-sm mt-8 upload-btn">${icon('upload', 'sm')} Change photo<input type="file" name="avatarFile" accept="image/png,image/jpeg,image/webp" hidden></label>
          </div>
        </div>
        <div class="divider"></div>
        <h3 class="mb-16">Personal details</h3>
        <div class="form-grid">
          <div class="field"><label for="p-name" class="req">Full name</label><input class="input" id="p-name" name="fullName" value="${esc(p.fullName)}" autocomplete="name" required></div>
          <div class="field"><label for="p-email">Email</label><input class="input" id="p-email" value="${esc(p.email)}" readonly aria-readonly="true"><div class="hint">${p.emailVerified ? 'Verified. ' : ''}Email cannot be changed here.</div></div>
          <div class="field"><label for="p-phone">Phone</label><input class="input" id="p-phone" name="phone" value="${esc(p.phone || '')}" inputmode="tel" autocomplete="tel" placeholder="10-digit mobile number"></div>
          <div class="field"><label for="p-city">City</label><input class="input" id="p-city" name="city" value="${esc(p.city || '')}" autocomplete="address-level2" placeholder="${esc(meta.platform.defaultCity)}"></div>
          <div class="field full"><label for="p-addr">Address</label><textarea class="textarea" id="p-addr" name="address" rows="2" autocomplete="street-address" placeholder="House, street, locality">${esc(p.address || '')}</textarea><div class="hint">Used for doorstep services such as laundry pickup and tiffin delivery.</div></div>
        </div>

        <div class="divider"></div>
        <h3 class="mb-8">Preferred location</h3>
        <p class="muted small">“Near me” searches use this when your device location is off.</p>
        <div class="form-grid">
          <div class="field"><label for="p-area">Area</label>
            <select class="select" id="p-area" name="preferredArea"><option value="">Not set</option>
              ${!areaKnown && p.preferredArea ? `<option value="${esc(p.preferredArea)}" selected>${esc(p.preferredArea)}</option>` : ''}
              ${meta.locations.map((l) => `<option value="${esc(l.area)}" ${l.area === p.preferredArea ? 'selected' : ''}>${esc(l.area)}, ${esc(l.city)}</option>`).join('')}
            </select></div>
          <div class="field"><label>Exact location</label>
            <button type="button" class="btn btn-secondary" data-locate>${icon('navigation', 'sm')} Use my current location</button>
            <div class="hint" data-loc-note>${p.prefLat != null ? `Saved: ${Number(p.prefLat).toFixed(4)}, ${Number(p.prefLng).toFixed(4)}` : 'Not set'}</div>
            <input type="hidden" name="prefLat" value="${p.prefLat ?? ''}"><input type="hidden" name="prefLng" value="${p.prefLng ?? ''}"></div>
        </div>

        <div class="divider"></div>
        <h3 class="mb-8">Payment receiving details</h3>
        <p class="muted small">Only used to send you a <b>refund</b> if a payment is rejected or a plan is cancelled by Subtize.ai. You never pay to this ID.</p>
        <div class="form-grid">
          <div class="field"><label for="p-upi">Your UPI ID</label><input class="input mono" id="p-upi" name="upiId" value="${esc(p.upiId || '')}" placeholder="name@bank" autocomplete="off"></div>
          <div class="field"><label for="p-note">Note for refunds</label><input class="input" id="p-note" name="paymentNote" value="${esc(p.paymentNote || '')}" maxlength="200" placeholder="e.g. Name on the UPI account"></div>
        </div>
        <div class="row end mt-24"><button type="submit" class="btn btn-primary">${icon('check', 'sm')} Save profile</button></div>
      </form>

      <aside class="stack" style="--gap:16px">
        ${ref ? `<section class="card">
          <div class="card-head"><h3>${icon('gift')} Invite friends</h3>${ref.joined ? `<span class="pill tone-good">${ref.joined} joined</span>` : ''}</div>
          <p class="muted small">Share your link. Friends who join with it are linked to your account.</p>
          <div class="label mb-8">Your referral code</div>
          <div class="ref-code mono">${esc(ref.code)}</div>
          <div class="input-group mt-16"><input class="input small" readonly value="${esc(ref.url)}" aria-label="Referral link" style="padding-left:14px;padding-right:92px"><button type="button" class="btn btn-primary btn-sm" data-copy-ref>${icon('copy', 'sm')} Copy</button></div>
          <button type="button" class="btn btn-secondary btn-block mt-8" data-share-ref>${icon('share', 'sm')} Share link</button>
        </section>` : ''}
        <section class="card">
          <div class="card-head"><h3>${icon('smartphone')} Subtize.ai app</h3></div>
          <p class="muted small">Install the app for one-tap access to your cards at the counter.</p>
          <div class="row wrap" style="--gap:8px"><button type="button" class="btn btn-primary btn-sm" data-action="download-app">${icon('download', 'sm')} Download App</button><button type="button" class="btn btn-secondary btn-sm" data-action="share-app">${icon('share', 'sm')} Share App</button></div>
        </section>
        <section class="card">
          <div class="card-head"><h3>${icon('user')} Account</h3></div>
          <dl class="kv small">
            <dt>Account ID</dt><dd class="mono">${esc(p.publicId)} <button type="button" class="btn btn-ghost btn-sm btn-icon" data-copy-id aria-label="Copy account ID">${icon('copy', 'sm')}</button></dd>
            <dt>Role</dt><dd>${p.role === 'lister' ? 'Lister' : 'Explorer'}</dd>
            <dt>Joined</dt><dd>${fmtDate(p.createdAt)}</dd>
          </dl>
          <a class="btn btn-ghost btn-sm mt-16" href="#/settings">${icon('settings', 'sm')} Settings &amp; password</a>
        </section>
      </aside>
    </div>`);

  const form = $('.profile-form', page);

  form.elements.preferredArea.addEventListener('change', () => {
    // A new area means the server should look up its coordinates.
    form.elements.prefLat.value = '';
    form.elements.prefLng.value = '';
    $('[data-loc-note]', page).textContent = 'Will use the centre of the chosen area.';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    const body = formData(form);
    btn.classList.add('is-loading');
    try {
      const { profile } = await api.put('/api/me/profile', body);
      showFieldError(form, null);
      toast('Profile saved.');
      $('.profile-top h2', page).textContent = profile.fullName;
      const who = document.querySelector('.side-user .who b');
      if (who) who.textContent = profile.fullName;
      $('[data-loc-note]', page).textContent = profile.prefLat != null ? `Saved: ${Number(profile.prefLat).toFixed(4)}, ${Number(profile.prefLng).toFixed(4)}` : 'Not set';
      form.elements.prefLat.value = profile.prefLat ?? '';
      form.elements.prefLng.value = profile.prefLng ?? '';
    } catch (ex) {
      if (!markFieldError(form, ex, FIELDS)) toast(ex.message, 'bad');
    } finally { btn.classList.remove('is-loading'); }
  });

  form.elements.avatarFile.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast('Choose an image under 3 MB.', 'bad'); return; }
    const fd = new FormData();
    fd.append('avatar', file);
    const label = e.target.closest('label');
    label.classList.add('is-loading');
    try {
      const { profile } = await api.upload('/api/me/profile/avatar', fd);
      $('[data-avatar]', page).innerHTML = avatarHtml(profile);
      const side = document.querySelector('.side-user .avatar');
      if (side) side.innerHTML = avatarHtml(profile);
      toast('Photo updated.');
    } catch (ex) { toast(ex.message, 'bad'); } finally { label.classList.remove('is-loading'); e.target.value = ''; }
  });

  page.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-locate]')) {
      const b = t.closest('[data-locate]');
      b.classList.add('is-loading');
      const pos = await getPosition();
      b.classList.remove('is-loading');
      if (!pos) { toast('Location permission is off. Pick your area from the list instead.', 'bad'); return; }
      form.elements.prefLat.value = pos.lat;
      form.elements.prefLng.value = pos.lng;
      $('[data-loc-note]', page).textContent = `Current location: ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)} — save to keep it.`;
      toast('Location captured. Save your profile to keep it.', 'info');
    }
    if (t.closest('[data-copy-ref]')) copyText(ref.url, 'Referral link copied');
    if (t.closest('[data-share-ref]')) shareApp({ text: 'Join me on Subtize.ai — subscribe to nearby gyms, tiffin, laundry and more, and manage everything in one place.' });
    if (t.closest('[data-copy-id]')) copyText(p.publicId, 'Account ID copied');
  });
}
