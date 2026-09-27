/*
 * The AI Smart Search box: type or speak, the server turns it into filters /
 * an availability answer / a subscription to start / checkout fields, and the
 * caller decides what to do with the result.
 *
 *   mountAiBox(host, { context: { page: 'search' }, onResult: (r) => … })
 */
import { api } from './api.js';
import { $, esc, icon, toast } from './ui.js';
import { attachMic, speak, voiceSupported } from './voice.js';

/* ── Location ───────────────────────────────────────────────────────────── */

const LOC_KEY = 'subtize.loc';

export function savedPosition() {
  try { const v = JSON.parse(sessionStorage.getItem(LOC_KEY) || 'null'); return v && Date.now() - v.at < 30 * 60_000 ? v : null; } catch { return null; }
}

/** Browser location, cached for half an hour. Resolves null if refused. */
export function getPosition({ prompt = true } = {}) {
  const cached = savedPosition();
  if (cached) return Promise.resolve(cached);
  if (!prompt || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const v = { lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), at: Date.now() };
        try { sessionStorage.setItem(LOC_KEY, JSON.stringify(v)); } catch { /* private mode */ }
        resolve(v);
      },
      () => resolve(null),
      { timeout: 8000, maximumAge: 10 * 60_000 },
    );
  });
}

/* ── Box ────────────────────────────────────────────────────────────────── */

export const EXAMPLES = [
  'Gym near me under ₹1,000',
  'Yoga on weekends in Rajpur Road',
  'Cheapest tiffin with a coupon',
  'Is Iron Paradise Gym open on Sunday?',
  'Laundry pickup that comes to my home',
  'Subscribe me to the cheapest car wash near me',
];

export async function askAssistant(text, { context = { page: 'search' }, position = null } = {}) {
  const pos = position || savedPosition();
  return api.post('/api/assistant', { text, context, ...(pos ? { lat: pos.lat, lng: pos.lng } : {}) });
}

/**
 * Renders the search input with a mic and an AI reply line.
 * opts: { context, placeholder, onResult(result, text), examples: true, size: 'lg'|'md', speakReplies: true, voice: true }
 */
export function mountAiBox(host, opts = {}) {
  const narrow = window.matchMedia('(max-width: 520px)').matches;
  const mic = voiceSupported && opts.voice !== false;
  const { context = { page: 'search' }, placeholder = narrow ? 'Gym near me under ₹1,000…' : 'Try "gym near me under ₹1,000" or tap the mic', onResult, examples = true, size = 'lg', speakReplies = true, initial = '' } = opts;
  host.innerHTML = `
    <form class="ai-box" role="search" autocomplete="off">
      <div class="input-group">
        ${icon('sparkle')}
        <input class="input ${size === 'lg' ? 'ai-input-lg' : ''}" name="q" value="${esc(initial)}" placeholder="${esc(placeholder)}" aria-label="Describe what you are looking for" style="padding-right:${mic ? 132 : 92}px">
        <div class="row" style="position:absolute;right:5px;gap:6px">
          ${mic ? `<button type="button" class="btn btn-secondary btn-icon btn-sm mic-btn" aria-label="Search by voice" aria-pressed="false" title="Search by voice">${icon('mic')}</button>` : ''}
          <button type="submit" class="btn btn-primary btn-sm">${icon('search', 'sm')}<span class="hide-xs">Search</span></button>
        </div>
      </div>
      <div class="voice-bar mt-8" hidden><span class="dot"></span><span data-text>Listening…</span></div>
      ${examples ? `<div class="chips scroll mt-16">${EXAMPLES.map((e) => `<button type="button" class="chip" data-example="${esc(e)}">${esc(e)}</button>`).join('')}</div>` : ''}
      <div class="ai-reply mt-16" hidden>${icon('sparkle')}<div data-reply></div></div>
    </form>`;
  const form = $('form', host);
  const input = form.elements.q;
  const replyBox = $('.ai-reply', host);

  const run = async (text) => {
    text = String(text || '').trim();
    if (!text) { input.focus(); return; }
    const btn = $('button[type=submit]', form);
    btn.classList.add('is-loading');
    try {
      let result = await askAssistant(text, { context });
      if (result.needsLocation || (result.filters?.nearMe && !savedPosition())) {
        const pos = await getPosition();
        if (pos) result = await askAssistant(text, { context, position: pos });
        else if (result.filters?.nearMe) toast('Location is off, so "near me" uses your saved area or the whole city.', 'info');
      }
      showReply(result.reply);
      if (speakReplies && opts.spoken) speak(result.reply);
      onResult?.(result, text);
    } catch (e) {
      showReply('');
      toast(e.message, 'bad');
    } finally { btn.classList.remove('is-loading'); opts.spoken = false; }
  };
  const showReply = (t) => { replyBox.hidden = !t; $('[data-reply]', replyBox).textContent = t || ''; };

  form.addEventListener('submit', (e) => { e.preventDefault(); run(input.value); });
  form.addEventListener('click', (e) => {
    const ex = e.target.closest('[data-example]');
    if (ex) { input.value = ex.dataset.example; run(ex.dataset.example); }
  });
  attachMic($('.mic-btn', form), input, (t) => { opts.spoken = true; run(t); }, { status: $('.voice-bar', form) });

  return { run, input, showReply };
}
