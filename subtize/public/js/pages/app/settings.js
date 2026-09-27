/* #/settings — notifications, voice, exclusions, password, sessions. */
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import {
  $, confirmAction, esc, fmtDate, formData, icon, showFieldError, toast,
} from '../../ui.js';
import { applyVoicePreference, markFieldError, mountPage, onAct } from './common.js';

const VOICE_KEY = 'subtize.voiceReplies';
const readAloud = () => { try { return localStorage.getItem(VOICE_KEY) !== 'off'; } catch { return true; } };

const toggle = (name, title, text, on) => `
  <label class="setting-row">
    <div class="grow"><b>${esc(title)}</b><div class="muted small">${esc(text)}</div></div>
    <span class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span></span></span>
  </label>`;

export async function renderSettings({ view, isCurrent }) {
  const [{ profile }, { exclusions }] = await Promise.all([api.get('/api/me/profile'), api.get('/api/me/exclusions')]);
  if (!isCurrent()) return;
  const st = profile.settings;

  const page = mountPage(view, `
    ${pageHead('Settings', 'Notifications, voice, hidden services and security.')}
    <div class="grid cols-2 settings-grid">
      <div class="stack" style="--gap:18px">
        <section class="card">
          <div class="card-head"><h3>${icon('bell')} Notifications</h3></div>
          <form class="settings-form stack" style="--gap:4px">
            ${toggle('notifyEmail', 'Email updates', 'Payment verified, plan activated and account notices by email.', st.notifyEmail)}
            ${toggle('notifyExpiry', 'Expiry reminders', 'A reminder before a subscription runs out, so you can renew in time.', st.notifyExpiry)}
            ${toggle('voiceEnabled', 'Voice input', 'Show the microphone on AI Smart Search and checkout.', st.voiceEnabled)}
          </form>
        </section>
        <section class="card">
          <div class="card-head"><h3>${icon('mic')} AI assistant</h3></div>
          ${toggle('readAloud', 'Read AI replies aloud', 'After a voice search, the assistant speaks its answer. Saved on this device.', readAloud())}
        </section>
        <section class="card">
          <div class="card-head"><h3>${icon('ban')} Excluded services</h3><span class="muted small">${exclusions.length}</span></div>
          <p class="muted small">These are hidden from search, explore and recommendations. Restore one to see it again.</p>
          <div data-excl>${exclusions.length ? `<ul class="excl-list">${exclusions.map((x) => `<li>
              <div class="grow"><b>${esc(x.name)}</b><div class="muted small">${esc(x.category)} · ${esc(x.area)} · excluded ${fmtDate(x.excludedAt)}</div></div>
              <button type="button" class="btn btn-secondary btn-sm" data-act="restore" data-id="${x.serviceId}" data-name="${esc(x.name)}">${icon('refresh', 'sm')} Restore</button></li>`).join('')}</ul>`
    : '<div class="empty small" style="padding:24px">Nothing excluded.</div>'}</div>
        </section>
      </div>
      <div class="stack" style="--gap:18px">
        <section class="card">
          <div class="card-head"><h3>${icon('lock')} Change password</h3></div>
          <form class="pw-form stack" novalidate autocomplete="off">
            <div class="field"><label for="s-cur" class="req">Current password</label><input class="input" id="s-cur" type="password" name="currentPassword" autocomplete="current-password" required></div>
            <div class="field"><label for="s-new" class="req">New password</label><input class="input" id="s-new" type="password" name="newPassword" autocomplete="new-password" minlength="8" required><div class="hint">At least 8 characters, with letters and numbers.</div></div>
            <div class="field"><label for="s-new2" class="req">Confirm new password</label><input class="input" id="s-new2" type="password" name="confirmPassword" autocomplete="new-password" required></div>
            <div class="row end"><button type="submit" class="btn btn-primary">Update password</button></div>
          </form>
        </section>
        <section class="card">
          <div class="card-head"><h3>${icon('shield')} Sessions</h3></div>
          <p class="muted small">Signed in on a shared or lost device? Sign out everywhere, including here.</p>
          <button type="button" class="btn btn-danger-outline" data-act="logoutAll">${icon('logout', 'sm')} Sign out of all devices</button>
        </section>
      </div>
    </div>`);

  const sForm = $('.settings-form', page);
  sForm.addEventListener('change', async (e) => {
    const input = e.target;
    const body = {
      notifyEmail: sForm.elements.notifyEmail.checked,
      notifyExpiry: sForm.elements.notifyExpiry.checked,
      voiceEnabled: sForm.elements.voiceEnabled.checked,
    };
    try {
      const { profile: p } = await api.put('/api/me/settings', body);
      applyVoicePreference(p.settings.voiceEnabled);
      toast('Settings saved.');
    } catch (ex) { input.checked = !input.checked; toast(ex.message, 'bad'); }
  });

  $('input[name=readAloud]', page).addEventListener('change', (e) => {
    try { localStorage.setItem(VOICE_KEY, e.target.checked ? 'on' : 'off'); } catch { /* private mode */ }
    if (!e.target.checked) window.speechSynthesis?.cancel();
    toast(e.target.checked ? 'AI replies will be read aloud.' : 'AI replies will stay silent.');
  });

  const pw = $('.pw-form', page);
  pw.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formData(pw);
    showFieldError(pw, null);
    if (b.newPassword !== b.confirmPassword) {
      showFieldError(pw, { message: 'The two new passwords do not match.', details: { field: 'confirmPassword' } });
      return;
    }
    const btn = $('button[type=submit]', pw);
    btn.classList.add('is-loading');
    try {
      await api.post('/api/auth/change-password', { currentPassword: b.currentPassword, newPassword: b.newPassword });
      pw.reset();
      toast('Password updated.');
    } catch (ex) {
      if (!markFieldError(pw, ex, { 'Current password': 'currentPassword', 'New password': 'newPassword' })) toast(ex.message, 'bad');
    } finally { btn.classList.remove('is-loading'); }
  });

  onAct(page, {
    restore: async (btn) => {
      btn.classList.add('is-loading');
      try {
        await api.del(`/api/me/exclusions/${btn.dataset.id}`);
        toast(`${btn.dataset.name} is visible again.`);
        const li = btn.closest('li');
        const list = li.parentElement;
        li.remove();
        if (!list.children.length) $('[data-excl]', page).innerHTML = '<div class="empty small" style="padding:24px">Nothing excluded.</div>';
      } catch (ex) { btn.classList.remove('is-loading'); toast(ex.message, 'bad'); }
    },
    logoutAll: async () => {
      const ok = await confirmAction({
        title: 'Sign out of all devices?',
        message: 'Every session on every device ends now, including this one. You will need to sign in again.',
        confirm: 'Sign out everywhere',
      });
      if (!ok) return;
      try { await api.post('/api/auth/logout-all'); } catch (ex) { toast(ex.message, 'bad'); return; }
      location.href = '/login';
    },
  });
}
