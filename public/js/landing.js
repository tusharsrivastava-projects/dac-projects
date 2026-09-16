import { api, ApiError } from './api.js';
import { $, $$, el, esc, icon, toast, busy } from './ui.js';

const alertBox = $('#auth-alert');

const showAlert = (message, kind = 'error') => {
  alertBox.innerHTML = '';
  alertBox.append(el('div', { class: `alert alert-${kind}`, style: 'margin-bottom:16px' }, [
    el('span', { html: icon(kind === 'error' ? 'alert' : 'info'), style: 'line-height:0' }),
    el('span', { text: message }),
  ]));
};
const clearAlert = () => { alertBox.innerHTML = ''; };

const landingFor = (user) => (user.role === 'admin' ? '/admin' : '/app');

/* ── Tabs ───────────────────────────────────────────────────────────────── */
function showTab(name) {
  clearAlert();
  $$('.auth-tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $('#login-form').classList.toggle('hidden', name !== 'login');
  $('#register-form').classList.toggle('hidden', name !== 'register');
  // Focus synchronously — a deferred focus() would yank the caret out of
  // whatever the visitor started typing in the meantime.
  $(name === 'login' ? '#login-email' : '#reg-name')?.focus();
}

$$('.auth-tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.goto)));

/* ── Already signed in? Go straight through ─────────────────────────────── */
(async () => {
  try {
    const { user } = await api.me();
    if (user) window.location.replace(landingFor(user));
  } catch { /* not signed in — stay put */ }
})();

/* ── Open roles teaser ──────────────────────────────────────────────────── */
(async () => {
  try {
    const { jobs } = await api.get('/api/jobs');
    const host = $('#pitch-roles');
    if (!jobs.length) return;
    host.innerHTML = `<span class="role-chip" style="background:none;border:0;padding-left:0">${
      esc(`${jobs.length} role${jobs.length === 1 ? '' : 's'} open right now`)}</span>`;
    for (const j of jobs.slice(0, 4)) {
      host.append(el('span', {
        class: 'role-chip',
        html: `<b>${esc(j.title)}</b> · ${esc(j.employmentType)}`,
      }));
    }
  } catch { /* teaser is optional */ }
})();

/* ── Sign in ────────────────────────────────────────────────────────────── */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert();
  const form = e.currentTarget;
  const restore = busy(form.querySelector('button[type=submit]'), 'Signing in…');
  try {
    const { user } = await api.login(form.email.value.trim(), form.password.value);
    window.location.href = landingFor(user);
  } catch (err) {
    restore();
    showAlert(err instanceof ApiError ? err.message : 'Could not sign in. Try again.');
    form.password.select();
  }
});

/* ── Register ───────────────────────────────────────────────────────────── */
$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert();
  const form = e.currentTarget;
  const password = form.password.value;

  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    showAlert('Password needs eight characters or more, with at least one letter and one number.');
    form.password.focus();
    return;
  }

  const restore = busy(form.querySelector('button[type=submit]'), 'Creating…');
  try {
    await api.register({
      fullName: form.fullName.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      password,
    });
    toast('Account created. Welcome to DAC.', 'good');
    window.location.href = '/app';
  } catch (err) {
    restore();
    showAlert(err instanceof ApiError ? err.message : 'Could not create your account. Try again.');
    if (err?.details?.field === 'Email' || err?.status === 409) form.email.focus();
  }
});
