/* #/profile — personal details, avatar, read-only business info and password. */
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { $, busy, esc, fmtDate, formData, icon, initials, pill, showFieldError, toast } from '../../ui.js';
import { fail, formError, state } from './common.js';

export async function renderProfile({ view, isCurrent }) {
  const [{ profile: p }, agr] = await Promise.all([
    api.get('/api/me/profile'),
    api.get('/api/lister/agreement').catch(() => ({})),
  ]);
  if (!isCurrent()) return;
  const app = agr.application;
  const standing = agr.standing || state.standing || {};

  view.innerHTML = `
    ${pageHead('Profile', 'Your account details. Business and bank details were verified by Subtize.ai and are read-only.')}
    <div class="split">
      <div class="stack" style="--gap:20px">
        <form class="card" id="pf-form" novalidate>
          <div class="card-head"><h3>${icon('user')} Personal details</h3></div>
          <div class="profile-avatar">
            <div class="avatar lg" id="pf-avatar">${avatarInner(p)}</div>
            <div>
              <b>${esc(p.fullName)}</b>
              <div class="small muted">${esc(p.email)} · Lister since ${esc(fmtDate(p.createdAt))}</div>
              <label class="btn btn-secondary btn-sm mt-8" for="pf-avatar-input">${icon('upload', 'sm')} Change photo</label>
              <input type="file" id="pf-avatar-input" accept="image/png,image/jpeg,image/webp" class="sr-only">
            </div>
          </div>
          <div class="form-grid mt-24">
            <div class="field"><label class="req" for="pf-name">Full name</label><input class="input" id="pf-name" name="fullName" maxlength="120" autocomplete="name" value="${esc(p.fullName)}"></div>
            <div class="field"><label for="pf-phone">Phone</label><input class="input" id="pf-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" value="${esc(p.phone || '')}" placeholder="+91 98xxxxxxxx"></div>
            <div class="field full"><label for="pf-address">Address</label><textarea class="textarea" id="pf-address" name="address" rows="2" maxlength="300" autocomplete="street-address">${esc(p.address || '')}</textarea></div>
            <div class="field"><label for="pf-city">City</label><input class="input" id="pf-city" name="city" maxlength="80" autocomplete="address-level2" value="${esc(p.city || '')}"></div>
            <div class="field"><label for="pf-email">Email</label><input class="input" id="pf-email" value="${esc(p.email)}" disabled><div class="hint">Contact support to change your sign-in email.</div></div>
          </div>
          <div class="row end mt-16"><button class="btn btn-primary" type="submit">${icon('check', 'sm')} Save details</button></div>
        </form>

        <form class="card" id="pw-form" novalidate>
          <div class="card-head"><h3>${icon('lock')} Change password</h3></div>
          <div class="form-grid">
            <div class="field full"><label class="req" for="pw-current">Current password</label><input class="input" id="pw-current" name="currentPassword" type="password" autocomplete="current-password"></div>
            <div class="field"><label class="req" for="pw-new">New password</label><input class="input" id="pw-new" name="newPassword" type="password" autocomplete="new-password" minlength="8"><div class="hint">At least 8 characters with a letter and a number.</div></div>
            <div class="field"><label class="req" for="pw-confirm">Confirm new password</label><input class="input" id="pw-confirm" name="confirmPassword" type="password" autocomplete="new-password"></div>
          </div>
          <div class="row end mt-16"><button class="btn btn-secondary" type="submit">${icon('lock', 'sm')} Update password</button></div>
        </form>
      </div>

      <aside class="stack" style="--gap:20px">
        <div class="card">
          <div class="card-head"><h3>${icon('shield')} Verification</h3>${standing.verified ? pill('approved', 'Verified') : pill(standing.applicationStatus || 'pending')}</div>
          <dl class="kv">
            <dt>Verification ID</dt><dd class="mono">${esc(standing.verificationId || '—')}</dd>
            <dt>Agreement</dt><dd>${standing.agreementId ? `<a class="mono" href="#/agreement">${esc(standing.agreementId)}</a>` : '—'}</dd>
            <dt>Agreement status</dt><dd>${standing.agreementStatus ? pill(standing.agreementStatus) : '—'}</dd>
          </dl>
        </div>
        ${app ? `
        <div class="card">
          <div class="card-head"><h3>${icon('briefcase')} Business</h3><span class="pill tone-neutral plain">${icon('lock', 'sm')} Read-only</span></div>
          <dl class="kv">
            <dt>Business name</dt><dd>${esc(app.businessName)}</dd>
            ${app.category ? `<dt>Category</dt><dd>${esc(app.category.name)}</dd>` : ''}
            <dt>Address</dt><dd>${esc(app.businessAddress || '—')}</dd>
            <dt>City</dt><dd>${esc(app.city || '—')}</dd>
            <dt>Business phone</dt><dd>${esc(app.phone || '—')}</dd>
            <dt>Business email</dt><dd>${esc(app.email || '—')}</dd>
            <dt>${esc(app.govIdType || 'Government ID')}</dt><dd class="mono">${esc(app.govIdNumber || '—')}</dd>
            <dt>${esc(app.addressProofType || 'Address proof')}</dt><dd class="mono">${esc(app.addressProofId || '—')}</dd>
          </dl>
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon('wallet')} Payout account</h3><span class="pill tone-neutral plain">${icon('lock', 'sm')} Read-only</span></div>
          <dl class="kv">
            <dt>Account name</dt><dd>${esc(app.bankAccountName || '—')}</dd>
            <dt>Account number</dt><dd class="mono">${esc(app.bankAccountNumber || '—')}</dd>
            <dt>IFSC</dt><dd class="mono">${esc(app.bankIfsc || '—')}</dd>
            <dt>Bank</dt><dd>${esc(app.bankName || '—')}</dd>
            <dt>Settlement UPI</dt><dd class="mono">${esc(app.settlementUpi || '—')}</dd>
          </dl>
          <p class="small muted mt-16 mb-0">Details are masked for your security. Settlement account changes need Subtize.ai approval: use <b>Request a change → Settlement details</b> on any of <a href="#/services">your services</a>.</p>
        </div>` : ''}
      </aside>
    </div>`;

  /* Personal details */
  const form = $('#pf-form', view);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    if (!d.fullName?.trim() || d.fullName.trim().length < 2) { showFieldError(form, { message: 'Enter your full name.', details: { field: 'fullName' } }); return; }
    await busy($('button[type=submit]', form), async () => {
      try {
        // PUT replaces every profile field, so carry over the ones this form does not show.
        const { profile } = await api.put('/api/me/profile', {
          fullName: d.fullName.trim(), phone: d.phone.trim(), address: d.address.trim(), city: d.city.trim(),
          preferredArea: p.preferredArea, prefLat: p.prefLat, prefLng: p.prefLng, upiId: p.upiId, paymentNote: p.paymentNote,
        });
        Object.assign(p, profile);
        syncShellUser(profile);
        toast('Profile saved.');
      } catch (err) {
        formError(form, err, { 'Full name': 'fullName', Phone: 'phone', Address: 'address', City: 'city' });
      }
    });
  });

  /* Avatar */
  const avatarInput = $('#pf-avatar-input', view);
  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Choose a PNG, JPG or WebP image.', 'bad'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('That image is larger than 5 MB.', 'bad'); return; }
    const fd = new FormData();
    fd.append('avatar', file);
    const label = $('label[for="pf-avatar-input"]', view);
    await busy(label, async () => {
      try {
        const { profile } = await api.upload('/api/me/profile/avatar', fd);
        Object.assign(p, profile);
        $('#pf-avatar', view).innerHTML = avatarInner(profile);
        syncShellUser(profile);
        toast('Photo updated.');
      } catch (err) { fail(err); }
    });
    avatarInput.value = '';
  });

  /* Password */
  const pw = $('#pw-form', view);
  pw.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(pw);
    if (!d.currentPassword) { showFieldError(pw, { message: 'Enter your current password.', details: { field: 'currentPassword' } }); return; }
    if (!d.newPassword || d.newPassword.length < 8 || !/[a-z]/i.test(d.newPassword) || !/\d/.test(d.newPassword)) {
      showFieldError(pw, { message: 'Use at least 8 characters with a letter and a number.', details: { field: 'newPassword' } }); return;
    }
    if (d.newPassword !== d.confirmPassword) { showFieldError(pw, { message: 'The two new passwords do not match.', details: { field: 'confirmPassword' } }); return; }
    await busy($('button[type=submit]', pw), async () => {
      try {
        await api.post('/api/auth/change-password', { currentPassword: d.currentPassword, newPassword: d.newPassword });
        pw.reset();
        toast('Password updated.');
      } catch (err) {
        formError(pw, err, { 'Current password': 'currentPassword', 'New password': 'newPassword' });
      }
    });
  });
}

const avatarInner = (p) => (p.avatarUrl ? `<img src="${esc(p.avatarUrl)}" alt="">` : esc(initials(p.fullName)));

/** The sidebar user block is drawn once by mountShell; keep it in step with profile edits. */
function syncShellUser(profile) {
  state.user = { ...state.user, ...profile };
  const who = document.querySelector('.side-user .who b');
  if (who) who.textContent = profile.fullName;
  const av = document.querySelector('.side-user .avatar');
  if (av) av.innerHTML = avatarInner(profile);
}
