/* "Download App" (install the PWA) and "Share App" (referral link), everywhere. */
import { api } from './api.js';
import { copyText, esc, icon, modal, toast } from './ui.js';

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
window.addEventListener('appinstalled', () => { deferredPrompt = null; toast('Subtize.ai is installed. Find it on your home screen.'); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

export async function downloadApp() {
  if (isStandalone()) { toast('You are already using the Subtize.ai app.', 'info'); return; }
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') toast('Installing Subtize.ai…');
    return;
  }
  const steps = isIos()
    ? `<ol class="stack" style="--gap:8px;padding-left:20px"><li>Tap the <b>Share</b> button in Safari.</li><li>Choose <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Subtize.ai opens full-screen like any app.</li></ol>`
    : `<ol class="stack" style="--gap:8px;padding-left:20px"><li>Open the browser menu (⋮).</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Confirm. Subtize.ai opens full-screen like any app.</li></ol>`;
  modal({
    title: 'Get the Subtize.ai app',
    body: `<p>Subtize.ai installs straight from your browser, with no app store and nothing extra to download. It works on Android, iPhone and desktop.</p>${steps}`,
    confirm: 'Got it', cancel: null,
  });
}

/** Share link carries the member's referral code when signed in. */
export async function shareApp({ title = 'Subtize.ai', text = 'Subscribe to 100+ nearby services for a month and manage or cancel them all in one place.', path = '/' } = {}) {
  let url = new URL(path, location.origin).toString();
  try {
    const { user } = await api.me();
    if (user?.referralCode) { const u = new URL(url); u.searchParams.set('ref', user.referralCode); url = u.toString(); }
  } catch { /* share the plain link */ }
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  modal({
    title: 'Share Subtize.ai',
    body: `<p>${esc(text)}</p>
      <div class="input-group mt-16"><input class="input" id="share-url" readonly value="${esc(url)}" style="padding-right:96px"><button type="button" class="btn btn-primary btn-sm" id="share-copy">${icon('copy', 'sm')} Copy</button></div>
      <div class="row wrap mt-16">
        <a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}">WhatsApp</a>
        <a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}">Telegram</a>
        <a class="btn btn-secondary btn-sm" href="mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n\n${url}`)}">Email</a>
      </div>`,
    confirm: 'Done', cancel: null,
    onOpen: (box) => box.querySelector('#share-copy').addEventListener('click', () => copyText(url, 'Link copied')),
  });
}

/** Any element with data-action="download-app" / "share-app" just works. */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.action === 'download-app') { e.preventDefault(); downloadApp(); }
  if (t.dataset.action === 'share-app') { e.preventDefault(); shareApp({ path: t.dataset.path || '/' }); }
});

// Remember a referral code from the URL for sign-up.
{
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref && /^[A-Za-z0-9]{4,12}$/.test(ref)) { try { localStorage.setItem('subtize.ref', ref.toUpperCase()); } catch { /* private mode */ } }
}
