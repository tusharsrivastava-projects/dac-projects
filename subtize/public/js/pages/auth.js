/*
 * /login /signup /otp /forgot in one page. The mode comes from the pathname and
 * changes in place (history.pushState) as someone moves between steps. The email
 * travels between steps in sessionStorage.
 */
import { api, homeFor } from '../api.js';
import '../pwa.js';
import { $, brand, esc, icon, setTitle, showFieldError, toast } from '../ui.js';

const card = $('#auth-card');
const STORE = 'subtize.auth';
const RESEND_AFTER = 30; // seconds
let timer = null;

$('#auth-brand-mark').innerHTML = brand('/');
$('#auth-top-brand').innerHTML = brand('/');
$('#back-home').insertAdjacentHTML('afterbegin', icon('back', 'sm'));
$('#auth-points').innerHTML = [
  ['sparkle', 'Find services near you', 'AI and voice search across gyms, tiffins, laundry, tuition and more in Dehradun.'],
  ['shield', 'Pay only the official Subtize.ai QR', 'Every payment is checked by an admin before your plan starts.'],
  ['gauge', 'Track and cancel in one place', 'Usage, cards, renewals and cancellations for every plan on one dashboard.'],
].map(([ic, t, d]) => `<li><span class="icon-tile">${icon(ic)}</span><span><b>${esc(t)}</b>${esc(d)}</span></li>`).join('');

/* ── Helpers ────────────────────────────────────────────────────────────── */

const readStore = () => { try { return JSON.parse(sessionStorage.getItem(STORE) || '{}'); } catch { return {}; } };
const writeStore = (v) => { try { sessionStorage.setItem(STORE, JSON.stringify({ ...readStore(), ...v })); } catch { /* private mode */ } };
const clearStore = () => { try { sessionStorage.removeItem(STORE); } catch { /* ignore */ } };

const mode = () => {
  const m = location.pathname.replace(/^\/+|\/+$/g, '');
  return ['login', 'signup', 'otp', 'forgot'].includes(m) ? m : 'login';
};

/** ?next= only if it is a same-origin relative path. */
function safeNext() {
  const n = new URLSearchParams(location.search).get('next');
  if (!n || !n.startsWith('/') || n.startsWith('//') || n.startsWith('/\\')) return null;
  try { if (new URL(n, location.origin).origin !== location.origin) return null; } catch { return null; }
  return n;
}
const carry = () => { const n = safeNext(); return n ? `?next=${encodeURIComponent(n)}` : ''; };

function finish(res) {
  clearStore();
  const role = res.user?.role;
  let to = safeNext();
  if (to && role === 'admin' && /^\/(app|lister)\b/.test(to)) to = null; // admins have no member checkout
  location.href = to || res.redirect || homeFor(role);
}

function goMode(m, { replace = false } = {}) {
  const url = `/${m}${carry()}`;
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  render();
}
window.addEventListener('popstate', render);

card.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-mode]');
  if (!a) return;
  e.preventDefault();
  goMode(a.dataset.mode);
});

const formError = (form, err) => {
  const box = $('.form-error', form);
  if (showFieldError(form, err)) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div class="panel-note danger">${icon('alert')}<div>${esc(err.message)}</div></div>`;
};
const clearErrors = (form) => {
  $('.form-error', form).hidden = true;
  showFieldError(form, null);
};

const pwField = (name, label, { autocomplete = 'current-password', extra = '' } = {}) => `
  <div class="field">
    <div class="row between"><label for="f-${name}">${label}</label>${extra}</div>
    <div class="pw-wrap">
      <input class="input" id="f-${name}" name="${name}" type="password" autocomplete="${autocomplete}" required>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-pw="${name}" aria-label="Show password" aria-pressed="false">${icon('eye')}</button>
    </div>
  </div>`;

card.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pw]');
  if (!b) return;
  const input = card.querySelector(`[name="${b.dataset.pw}"]`);
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  b.innerHTML = icon(show ? 'eyeOff' : 'eye');
  b.setAttribute('aria-pressed', String(show));
  b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

const devNote = (code) => (code ? `
  <div class="dev-note" role="note">${icon('info')}
    <span><strong>Dev mode</strong> — no email configured. Your code is <code>${esc(code)}</code></span>
    <button type="button" class="btn btn-secondary btn-sm" data-fill="${esc(code)}">Fill it in</button>
  </div>` : '');

card.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fill]');
  if (!b) return;
  const input = card.querySelector('input[name=code]');
  if (input) { input.value = b.dataset.fill; input.dispatchEvent(new Event('input', { bubbles: true })); }
});

function passwordRules(input, host) {
  const upd = () => {
    const v = input.value;
    const rules = [[v.length >= 8, '8+ characters'], [/[a-zA-Z]/.test(v), 'A letter'], [/[0-9]/.test(v), 'A number']];
    host.innerHTML = rules.map(([ok, t]) => `<span class="${ok ? 'ok' : ''}">${icon(ok ? 'checkCircle' : 'minus')} ${t}</span>`).join('');
  };
  input.addEventListener('input', upd);
  upd();
}
const passwordOk = (v) => v.length >= 8 && /[a-zA-Z]/.test(v) && /[0-9]/.test(v);

function startCountdown(btn, sentAt) {
  clearInterval(timer);
  const tick = () => {
    const left = Math.max(0, RESEND_AFTER - Math.floor((Date.now() - (sentAt || 0)) / 1000));
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? `Resend code in 0:${String(left).padStart(2, '0')}` : 'Resend code';
    if (!left) clearInterval(timer);
  };
  tick();
  timer = setInterval(tick, 1000);
}

/* ── Views ──────────────────────────────────────────────────────────────── */

function renderLogin() {
  setTitle('Log in');
  const s = readStore();
  card.innerHTML = `
    <h1>Welcome back</h1>
    <p class="sub">Log in to see your subscriptions, cards and payments.</p>
    <form id="login-form" novalidate>
      <div class="form-error" hidden></div>
      <div class="field"><label for="f-email">Email</label>
        <input class="input" id="f-email" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(s.email || '')}"></div>
      ${pwField('password', 'Password', { extra: `<a class="small" href="/forgot${carry()}" data-mode="forgot">Forgot password?</a>` })}
      <button type="submit" class="btn btn-primary btn-lg btn-block">Log in</button>
      <div class="auth-or">or</div>
      <button type="button" class="btn btn-secondary btn-block" id="otp-login">${icon('mail')} Email me a sign-in code instead</button>
    </form>
    <p class="auth-alt">New to Subtize.ai? <a href="/signup${carry()}" data-mode="signup">Create a free account</a></p>`;
  const form = $('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const btn = $('button[type=submit]', form);
    const email = form.elements.email.value.trim();
    btn.classList.add('is-loading');
    try {
      const res = await api.post('/api/auth/login', { email, password: form.elements.password.value });
      if (res.pendingVerification) {
        writeStore({ email: res.sentTo || email, purpose: 'verify', devOtp: res.devOtp || null, minutes: res.expiresInMinutes, sentAt: Date.now() });
        toast('Verify your email to finish signing in. We sent you a code.', 'info');
        goMode('otp');
        return;
      }
      finish(res);
    } catch (err) { formError(form, err); } finally { btn.classList.remove('is-loading'); }
  });
  $('#otp-login').addEventListener('click', async (e) => {
    clearErrors(form);
    const email = form.elements.email.value.trim();
    if (!email) { formError(form, { message: 'Enter your email first, then we will send the code there.', details: { field: 'email' } }); return; }
    const btn = e.currentTarget;
    btn.classList.add('is-loading');
    try {
      const res = await api.post('/api/auth/login-otp', { email });
      writeStore({ email: res.sentTo || email, purpose: 'login', devOtp: res.devOtp || null, minutes: res.expiresInMinutes, sentAt: Date.now() });
      goMode('otp');
    } catch (err) { formError(form, err); } finally { btn.classList.remove('is-loading'); }
  });
  (s.email ? form.elements.password : form.elements.email).focus();
}

function renderSignup() {
  setTitle('Create your account');
  let ref = '';
  try { ref = localStorage.getItem('subtize.ref') || ''; } catch { /* private mode */ }
  const s = readStore();
  card.innerHTML = `
    <h1>Create your account</h1>
    <p class="sub">Free to join. Subscribe to services near you and manage them all in one place.</p>
    <form id="signup-form" novalidate>
      <div class="form-error" hidden></div>
      <div class="field"><label for="f-fullName" class="req">Full name</label>
        <input class="input" id="f-fullName" name="fullName" autocomplete="name" required minlength="2" maxlength="120"></div>
      <div class="field"><label for="f-email" class="req">Email</label>
        <input class="input" id="f-email" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(s.email || '')}">
        <span class="hint">We send a 6-digit code here to verify it.</span></div>
      <div class="field"><label for="f-phone">Phone <span class="muted">(optional)</span></label>
        <input class="input" id="f-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+91 98765 43210"></div>
      ${pwField('password', '<span class="req">Password</span>', { autocomplete: 'new-password' })}
      <div class="pw-rules" id="pw-rules" aria-live="polite"></div>
      <div class="field"><label for="f-referralCode">Referral code <span class="muted">(optional)</span></label>
        <input class="input mono" id="f-referralCode" name="referralCode" maxlength="12" autocomplete="off" value="${esc(ref)}">
        ${ref ? '<span class="hint">Added from the link you were shared.</span>' : ''}</div>
      <button type="submit" class="btn btn-primary btn-lg btn-block">Create account</button>
      <p class="muted small center" style="margin-bottom:0">By creating an account you agree to the <a href="/terms">Terms &amp; Conditions</a> and <a href="/privacy">Privacy Policy</a>.</p>
    </form>
    <p class="auth-alt">Already have an account? <a href="/login${carry()}" data-mode="login">Log in</a></p>`;
  const form = $('#signup-form');
  passwordRules(form.elements.password, $('#pw-rules'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const f = form.elements;
    const body = {
      fullName: f.fullName.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(),
      password: f.password.value, referralCode: f.referralCode.value.trim(),
    };
    if (body.fullName.length < 2) return formError(form, { message: 'Enter your full name.', details: { field: 'fullName' } });
    if (!body.email) return formError(form, { message: 'Email is required.', details: { field: 'email' } });
    if (!passwordOk(body.password)) return formError(form, { message: 'Use at least 8 characters with a letter and a number.', details: { field: 'password' } });
    const btn = $('button[type=submit]', form);
    btn.classList.add('is-loading');
    try {
      const res = await api.post('/api/auth/register', body);
      writeStore({ email: res.sentTo || body.email, purpose: 'verify', devOtp: res.devOtp || null, minutes: res.expiresInMinutes, sentAt: Date.now() });
      goMode('otp');
    } catch (err) { formError(form, err); } finally { btn.classList.remove('is-loading'); }
  });
  form.elements.fullName.focus();
}

function renderOtp() {
  const s = readStore();
  const purpose = s.purpose === 'login' ? 'login' : 'verify';
  setTitle(purpose === 'login' ? 'Enter your sign-in code' : 'Verify your email');
  card.innerHTML = `
    <h1>${purpose === 'login' ? 'Check your email' : 'Verify your email'}</h1>
    <p class="sub">${s.email
      ? `We sent a 6-digit code to <strong style="color:var(--text)">${esc(s.email)}</strong>.${s.minutes ? ` It expires in ${s.minutes} minutes.` : ''}`
      : 'Enter your email and the 6-digit code we sent you.'}</p>
    <form id="otp-form" novalidate>
      <div class="form-error" hidden></div>
      ${devNote(s.devOtp)}
      <div class="field" ${s.email ? 'hidden' : ''}><label for="f-email">Email</label>
        <input class="input" id="f-email" name="email" type="email" autocomplete="email" value="${esc(s.email || '')}"></div>
      <div class="field"><label for="f-code">6-digit code</label>
        <input class="input otp-input" id="f-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="••••••" required></div>
      <button type="submit" class="btn btn-primary btn-lg btn-block">${purpose === 'login' ? 'Sign in' : 'Verify and continue'}</button>
      <div class="row between wrap">
        <button type="button" class="btn btn-ghost btn-sm" id="resend">Resend code</button>
        <a class="small" href="/${purpose === 'login' ? 'login' : 'signup'}${carry()}" data-mode="${purpose === 'login' ? 'login' : 'signup'}">Use a different email</a>
      </div>
    </form>
    <p class="auth-alt">Can't find it? Check spam or promotions, or wait a minute before resending.</p>`;
  const form = $('#otp-form');
  const code = form.elements.code;
  const submit = async () => {
    clearErrors(form);
    const email = form.elements.email.value.trim();
    if (!email) return formError(form, { message: 'Enter the email the code was sent to.', details: { field: 'email' } });
    if (!/^\d{6}$/.test(code.value)) return formError(form, { message: 'Enter all 6 digits.', details: { field: 'code' } });
    const btn = $('button[type=submit]', form);
    btn.classList.add('is-loading');
    try {
      const res = await api.post('/api/auth/verify-otp', { email, code: code.value, purpose });
      toast(purpose === 'verify' ? 'Email verified. Welcome to Subtize.ai!' : 'Signed in.');
      finish(res);
    } catch (err) { formError(form, err); code.select(); } finally { btn.classList.remove('is-loading'); }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  code.addEventListener('input', () => {
    code.value = code.value.replace(/\D/g, '').slice(0, 6);
    if (code.value.length === 6) submit();
  });
  const resend = $('#resend');
  startCountdown(resend, s.sentAt);
  resend.addEventListener('click', async () => {
    const email = form.elements.email.value.trim();
    if (!email) return formError(form, { message: 'Enter your email first.', details: { field: 'email' } });
    resend.classList.add('is-loading');
    try {
      const res = await api.post('/api/auth/resend-otp', { email, purpose });
      writeStore({ email, purpose, devOtp: res.devOtp || null, minutes: res.expiresInMinutes || s.minutes, sentAt: Date.now() });
      toast(`A new code is on its way to ${email}.`, 'info');
      renderOtp();
    } catch (err) { formError(form, err); } finally { resend.classList.remove('is-loading'); }
  });
  (s.email ? code : form.elements.email).focus();
}

function renderForgot() {
  setTitle('Reset your password');
  const s = readStore();
  const step2 = s.purpose === 'reset' && s.email;
  if (!step2) {
    card.innerHTML = `
      <h1>Reset your password</h1>
      <p class="sub">Enter your account email and we'll send a 6-digit code to set a new password.</p>
      <form id="forgot-form" novalidate>
        <div class="form-error" hidden></div>
        <div class="field"><label for="f-email">Email</label>
          <input class="input" id="f-email" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(s.email || '')}"></div>
        <button type="submit" class="btn btn-primary btn-lg btn-block">Send reset code</button>
      </form>
      <p class="auth-alt">Remembered it? <a href="/login${carry()}" data-mode="login">Back to log in</a></p>`;
    const form = $('#forgot-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      const email = form.elements.email.value.trim();
      if (!email) return formError(form, { message: 'Enter your email.', details: { field: 'email' } });
      const btn = $('button[type=submit]', form);
      btn.classList.add('is-loading');
      try {
        const res = await api.post('/api/auth/forgot', { email });
        writeStore({ email: res.sentTo || email, purpose: 'reset', devOtp: res.devOtp || null, minutes: res.expiresInMinutes, sentAt: Date.now() });
        renderForgot();
      } catch (err) { formError(form, err); } finally { btn.classList.remove('is-loading'); }
    });
    form.elements.email.focus();
    return;
  }

  card.innerHTML = `
    <h1>Set a new password</h1>
    <p class="sub">If an account uses <strong style="color:var(--text)">${esc(s.email)}</strong>, a 6-digit code is on its way.${s.minutes ? ` It expires in ${s.minutes} minutes.` : ''}</p>
    <form id="reset-form" novalidate>
      <div class="form-error" hidden></div>
      ${devNote(s.devOtp)}
      <div class="field"><label for="f-code">6-digit code</label>
        <input class="input otp-input" id="f-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" required></div>
      ${pwField('password', 'New password', { autocomplete: 'new-password' })}
      <div class="pw-rules" id="pw-rules" aria-live="polite"></div>
      ${pwField('confirm', 'Confirm new password', { autocomplete: 'new-password' })}
      <button type="submit" class="btn btn-primary btn-lg btn-block">Reset password</button>
      <div class="row between wrap">
        <button type="button" class="btn btn-ghost btn-sm" id="resend">Resend code</button>
        <button type="button" class="btn btn-ghost btn-sm" id="change-email">Use a different email</button>
      </div>
    </form>`;
  const form = $('#reset-form');
  const code = form.elements.code;
  code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); });
  passwordRules(form.elements.password, $('#pw-rules'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const f = form.elements;
    if (!/^\d{6}$/.test(code.value)) return formError(form, { message: 'Enter all 6 digits.', details: { field: 'code' } });
    if (!passwordOk(f.password.value)) return formError(form, { message: 'Use at least 8 characters with a letter and a number.', details: { field: 'password' } });
    if (f.password.value !== f.confirm.value) return formError(form, { message: 'The two passwords do not match.', details: { field: 'confirm' } });
    const btn = $('button[type=submit]', form);
    btn.classList.add('is-loading');
    try {
      const res = await api.post('/api/auth/reset', { email: s.email, code: code.value, password: f.password.value });
      if (res.redirect) { toast('Password updated. You are signed in.'); finish(res); return; }
      clearStore();
      writeStore({ email: s.email });
      toast('Password updated. Log in with your new password.');
      goMode('login');
    } catch (err) { formError(form, err); } finally { btn.classList.remove('is-loading'); }
  });
  const resend = $('#resend');
  startCountdown(resend, s.sentAt);
  resend.addEventListener('click', async () => {
    resend.classList.add('is-loading');
    try {
      const res = await api.post('/api/auth/resend-otp', { email: s.email, purpose: 'reset' });
      writeStore({ devOtp: res.devOtp || null, sentAt: Date.now(), minutes: res.expiresInMinutes || s.minutes });
      toast('A new code is on its way.', 'info');
      renderForgot();
    } catch (err) { formError(form, err); } finally { resend.classList.remove('is-loading'); }
  });
  $('#change-email').addEventListener('click', () => { writeStore({ purpose: null }); renderForgot(); });
  code.focus();
}

function render() {
  clearInterval(timer);
  const m = mode();
  if (m === 'forgot' && readStore().purpose !== 'reset') writeStore({ purpose: null });
  ({ login: renderLogin, signup: renderSignup, otp: renderOtp, forgot: renderForgot })[m]();
}

/* ── Boot: signed-in visitors skip login/signup ─────────────────────────── */

(async () => {
  if (['login', 'signup'].includes(mode())) {
    try {
      const { user } = await api.me();
      if (user) {
        let to = safeNext();
        if (to && user.role === 'admin' && /^\/(app|lister)\b/.test(to)) to = null;
        location.replace(to || homeFor(user.role));
        return;
      }
    } catch { /* offline: show the form anyway */ }
  }
  render();
})();
