/* About, Terms, Privacy, Payment information, Contact and Download: one page, routed by pathname. */
import { api } from '../api.js';
import { statTile } from '../components.js';
import { mountSite } from '../site.js';
import { $, $$, icon, setTitle, toast } from '../ui.js';

const PAGES = {
  about: 'About Subtize.ai',
  'payment-info': 'Payment information',
  terms: 'Terms & Conditions',
  privacy: 'Privacy Policy',
  contact: 'Contact',
  download: 'Download the app',
};
const page = location.pathname.replace(/^\/+|\/+$/g, '');
const key = PAGES[page] ? page : 'about';

mountSite({ active: key === 'payment-info' ? 'payment' : '' });
setTitle(PAGES[key]);

$(`article[data-page="${key}"]`).hidden = false;
$$('#info-nav a').forEach((a) => {
  a.insertAdjacentHTML('afterbegin', icon(a.dataset.ic));
  if (a.dataset.page === key) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); a.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }
});
$$('[data-icon]').forEach((n) => { n.outerHTML = n.classList.contains('icon-tile') ? `<div class="${n.className}">${icon(n.dataset.icon)}</div>` : icon(n.dataset.icon); });
$('#dl-install')?.insertAdjacentHTML('afterbegin', icon('download'));
$('#dl-share')?.insertAdjacentHTML('afterbegin', icon('share'));
window.scrollTo(0, 0);

// Terms: on-page contents.
const toc = $('#terms-toc');
if (toc) {
  toc.innerHTML = $$('article[data-page="terms"] h2[id]').map((h) => `<a class="chip" href="#${h.id}">${h.textContent.replace(/^\d+\.\s*/, '')}</a>`).join('');
}

/* ── Live values from /api/meta ─────────────────────────────────────────── */

let support = { email: 'support@subtize.ai', phone: '' };

(async () => {
  let meta;
  try { meta = await api.get('/api/meta'); } catch { meta = null; }
  const p = meta?.platform || {};
  support = { email: p.supportEmail || support.email, phone: p.supportPhone || '' };
  const commission = p.commissionPercent ?? 20;
  $$('[data-commission]').forEach((n) => { n.textContent = commission; });
  $$('[data-payout]').forEach((n) => { n.textContent = 100 - commission; });
  if (p.payee) $$('[data-payee]').forEach((n) => { n.textContent = p.payee; });
  if (p.defaultCity) $$('[data-city]').forEach((n) => { n.textContent = p.defaultCity; });
  $$('[data-support-email]').forEach((n) => { n.textContent = support.email; });
  $$('[data-support-link]').forEach((a) => { a.href = `mailto:${support.email}`; });
  $$('[data-lister-link]').forEach((a) => { a.href = `mailto:${support.email}?subject=${encodeURIComponent('Lister support')}`; });
  if (support.phone) {
    $$('[data-support-phone]').forEach((n) => { n.textContent = support.phone; });
    $$('[data-support-tel]').forEach((a) => { a.href = `tel:${support.phone.replace(/[^\d+]/g, '')}`; });
  } else $('#phone-card')?.remove();

  const stats = $('#about-stats');
  if (stats && meta?.stats) {
    stats.innerHTML = [
      statTile({ label: 'Live services', value: String(meta.stats.services), ic: 'layers', hero: true }),
      statTile({ label: 'Active subscribers', value: String(meta.stats.subscribers), ic: 'users' }),
      statTile({ label: 'Areas covered', value: String(meta.stats.areas), ic: 'pin' }),
      statTile({ label: 'Categories', value: String(meta.categories.length), ic: 'grid' }),
    ].join('');
  } else stats?.remove();
})();

/* ── Contact form → the visitor's email app ─────────────────────────────── */

const form = $('#contact-form');
if (form) {
  api.me().then(({ user }) => {
    if (!user) return;
    if (!form.elements.name.value) form.elements.name.value = user.fullName || '';
    if (!form.elements.email.value) form.elements.email.value = user.email || '';
  }).catch(() => {});

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    $$('.is-invalid', form).forEach((n) => n.classList.remove('is-invalid'));
    const missing = ['name', 'email', 'message'].find((k) => !f[k].value.trim());
    if (missing) { f[missing].classList.add('is-invalid'); f[missing].focus(); toast('Please fill in your name, email and message.', 'bad'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.value.trim())) { f.email.classList.add('is-invalid'); f.email.focus(); toast('That email does not look right.', 'bad'); return; }
    const subject = `[${f.topic.value}] ${f.ref.value.trim() ? `${f.ref.value.trim()} · ` : ''}Message from ${f.name.value.trim()}`;
    const body = `${f.message.value.trim()}\n\n—\nName: ${f.name.value.trim()}\nEmail: ${f.email.value.trim()}${f.ref.value.trim() ? `\nReference: ${f.ref.value.trim()}` : ''}\nSent from ${location.origin}/contact`;
    location.href = `mailto:${support.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast('Your email app should open with the message ready. If it does not, write to us directly.', 'info', 6000);
  });
}
