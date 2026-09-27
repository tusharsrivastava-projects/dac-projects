/* #/search — AI Smart Search: type or speak, the assistant fills the filters. */
import { mountAiBox } from '../../ai.js';
import { serviceCard } from '../../components.js';
import { go, pageHead } from '../../shell.js';
import { $, esc, icon, inr } from '../../ui.js';
import { voiceSupported } from '../../voice.js';
import { EMPTY, fromAssistant, mountBrowser } from './browse.js';
import { dayStrip, mountPage, takeHandoff } from './common.js';

const VOICE_GUIDE = [
  { ic: 'search', title: 'Search', examples: ['Gym near me under ₹1,000', 'Tiffin in Rajpur Road'] },
  { ic: 'filter', title: 'Refine filters', examples: ['Only with offers', 'Under 800', 'Open on weekends', 'Clear filters'] },
  { ic: 'calendar', title: 'Check availability', examples: ['Is Iron Paradise Gym open on Sunday?', 'What days is Sunrise Hatha Yoga open?'] },
  { ic: 'zap', title: 'Subscribe by voice', examples: ['Subscribe me to the cheapest car wash near me', 'Subscribe me to Sunrise Hatha Yoga for 3 months with coupon WELCOME10'] },
  { ic: 'wallet', title: 'Fill checkout (on the payment screens)', plain: true, examples: ['Three months with coupon WELCOME10', 'My transaction ID is 4 1 9 2 0 0 1 2 3 4 5 6'] },
];

export const NAV_TARGETS = { dashboard: '/', subscriptions: '/subscriptions', cards: '/cards', payments: '/payments', usage: '/usage', coupons: '/coupons', profile: '/profile', settings: '/settings' };

/** Checkout URL for a subscribe intent. */
export const subscribeHref = (r) => `/checkout/${r.service.id}?months=${r.fields?.months || ''}&coupon=${encodeURIComponent(r.fields?.couponCode || '')}`;

export async function renderSearch({ view, query, isCurrent }) {
  const page = mountPage(view, `
    ${pageHead('AI Smart Search', 'Describe what you need in your own words — or tap the mic and say it. The assistant sets the filters for you.')}
    <section class="card search-hero">
      <div data-ai></div>
      <div class="row wrap small muted mt-16" style="--gap:14px">
        <span class="row" style="--gap:6px">${icon(voiceSupported ? 'mic' : 'micOff', 'sm')} ${voiceSupported ? 'Voice search is available in this browser.' : 'Voice needs Chrome, Edge or Safari. Typing works everywhere.'}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-guide aria-expanded="false">${icon('info', 'sm')} What can I say?</button>
      </div>
      <div class="voice-guide mt-16" hidden>
        ${VOICE_GUIDE.map((g) => `<div class="vg-item"><div class="row" style="--gap:10px"><div class="icon-tile sm">${icon(g.ic)}</div><b>${esc(g.title)}</b></div>
          <ul>${g.examples.map((e) => (g.plain ? `<li class="soft">“${esc(e)}”</li>` : `<li><button type="button" class="linkish" data-say="${esc(e)}">“${esc(e)}”</button></li>`)).join('')}</ul></div>`).join('')}
      </div>
    </section>
    <div data-answer class="mt-24"></div>
    <div data-browser class="mt-24"></div>`);

  const answer = $('[data-answer]', page);
  const handoff = takeHandoff();
  const initialText = handoff?.text || query.get('q') || '';

  const browser = await mountBrowser($('[data-browser]', page), {
    initial: handoff?.result && handoff.result.intent !== 'clear' ? fromAssistant(handoff.result.filters) : EMPTY(),
    showQuery: true,
  });
  if (!isCurrent()) return;

  const showAnswer = (r) => {
    if (r.intent !== 'availability') { answer.innerHTML = ''; return; }
    const s = r.service;
    answer.innerHTML = `
      <div class="card answer-card">
        <div class="eyebrow">${icon('calendar', 'sm')} Availability answer</div>
        <p class="answer-text">${esc(r.reply)}</p>
        ${s ? `<div class="answer-grid">
            <div>${serviceCard(s, { href: `#/services/${s.id}`, ctaHref: `#/checkout/${s.id}` })}</div>
            <div class="stack">
              <div><div class="label mb-8">Open on</div>${dayStrip(s.availableDays, { size: 'lg' })}</div>
              ${s.hours ? `<div class="kv"><dt>Hours</dt><dd>${esc(s.hours)}</dd></div>` : ''}
              <div class="kv"><dt>Price</dt><dd>${inr(s.monthlyPrice)} / month</dd></div>
              ${s.spotsLeft != null ? `<div class="kv"><dt>Spots left</dt><dd>${s.spotsLeft}</dd></div>` : ''}
              <div class="row wrap"><a class="btn btn-primary" href="#/checkout/${s.id}">Subscribe</a><a class="btn btn-secondary" href="#/services/${s.id}">Full details</a></div>
            </div>
          </div>` : ''}
      </div>`;
  };

  const handle = (r) => {
    switch (r.intent) {
      case 'subscribe':
        if (r.service) { go(subscribeHref(r)); return; }
        break;
      case 'navigate':
        if (r.navigate) { go(NAV_TARGETS[r.navigate] || `/${r.navigate}`); return; }
        break;
      case 'clear':
        answer.innerHTML = '';
        browser.set(EMPTY());
        return;
      case 'filter':
        browser.set(fromAssistant(r.filters, browser.get()));
        showAnswer(r);
        return;
      case 'availability':
        showAnswer(r);
        if (!r.service) browser.set(fromAssistant(r.filters));
        return;
      default: break;
    }
    showAnswer(r);
    browser.set(fromAssistant(r.filters));
  };

  const box = mountAiBox($('[data-ai]', page), {
    context: { page: 'search' },
    initial: initialText,
    onResult: (r) => handle(r),
  });

  if (handoff?.result) {
    box.showReply(handoff.result.reply);
    showAnswer(handoff.result);
  } else if (initialText) {
    box.run(initialText);
  }

  page.addEventListener('click', (e) => {
    const g = e.target.closest('[data-guide]');
    if (g) {
      const panel = $('.voice-guide', page);
      panel.hidden = !panel.hidden;
      g.setAttribute('aria-expanded', String(!panel.hidden));
    }
    const say = e.target.closest('[data-say]');
    if (say) {
      box.input.value = say.dataset.say;
      box.run(say.dataset.say);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}
