/* Helpers shared by the member-app screens. */
import { askAssistant } from '../../ai.js';
import { api } from '../../api.js';
import {
  $, DAYS, DAY_LETTER, DAY_SHORT, confirmAction, el, esc, fmtDate, icon, modal, pill, showFieldError, toast, tonePill,
} from '../../ui.js';
import { attachMic, voiceSupported } from '../../voice.js';

/* ── Session-wide state ─────────────────────────────────────────────────── */

let currentUser = null;
export const setUser = (u) => { currentUser = u; };
export const getUser = () => currentUser;

let metaPromise = null;
/** /api/meta rarely changes; fetch it once per page load. */
export function getMeta() {
  if (!metaPromise) metaPromise = api.get('/api/meta').catch((e) => { metaPromise = null; throw e; });
  return metaPromise;
}

/** A one-shot hand-off between screens (e.g. dashboard AI box → search page). */
let handoffValue = null;
export const setHandoff = (v) => { handoffValue = v; };
export const takeHandoff = () => { const v = handoffValue; handoffValue = null; return v; };

export function applyVoicePreference(on) {
  document.body.classList.toggle('voice-off', !on);
}

/* ── Page mounting ──────────────────────────────────────────────────────── */

/**
 * Replaces the view with a fresh container so event listeners never pile up
 * on the persistent #view element between routes.
 */
export function mountPage(view, htmlStr = '', cls = '') {
  const page = el('div', { class: `app-page ${cls}` });
  page.innerHTML = htmlStr;
  view.replaceChildren(page);
  return page;
}

/** data-act="name" click delegation within a page. */
export function onAct(root, handlers) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    const fn = handlers[t.dataset.act];
    if (!fn) return;
    e.preventDefault();
    fn(t, e);
  });
}

/* ── Days & availability ────────────────────────────────────────────────── */

export const todayKey = () => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
export const DAY_FULL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/** Seven compact day chips; available ones are green. */
export function dayStrip(days = [], { size = '' } = {}) {
  const t = todayKey();
  return `<div class="daystrip ${size}" aria-label="Available ${esc(days.map((d) => DAY_FULL[d]).join(', ') || 'no days')}">${DAYS.map((d) => `<span class="${days.includes(d) ? 'on' : ''} ${d === t ? 'today' : ''}" title="${DAY_SHORT[d]} — ${days.includes(d) ? 'available' : 'closed'}${d === t ? ' (today)' : ''}">${DAY_LETTER[d]}</span>`).join('')}</div>`;
}

/** Full week list: Monday · Open · hours / Closed. */
export function weekList(days = [], hours = '') {
  const t = todayKey();
  return `<ul class="week-list">${DAYS.map((d) => {
    const on = days.includes(d);
    return `<li class="${on ? 'on' : 'off'} ${d === t ? 'today' : ''}"><span class="d">${DAY_FULL[d]}${d === t ? ' <span class="muted small">(today)</span>' : ''}</span>
      <span class="h">${on ? `${icon('checkCircle', 'sm')} ${esc(hours || 'Open')}` : `${icon('x', 'sm')} Closed`}</span></li>`;
  }).join('')}</ul>`;
}

export const openTodayPill = (days = []) => (days.includes(todayKey())
  ? tonePill('Open today', 'good') : tonePill('Closed today', 'neutral'));

/* ── Subscription vocabulary ────────────────────────────────────────────── */

export const catTile = (ic, cls = '') => `<div class="icon-tile ${cls}">${icon(ic || 'grid')}</div>`;

/** Status pill that reflects "expiring soon" and "excluded". */
export function subPill(s) {
  const main = s.bucket === 'expiring' ? pill('expiring') : pill(s.status);
  return s.excluded ? `${main} ${tonePill('Excluded', 'neutral')}` : main;
}

export function activationLabel(s) {
  switch (s.status) {
    case 'active': return s.activatedAt ? `Activated ${fmtDate(s.activatedAt)}` : 'Activated';
    case 'pending_payment': return 'Waiting for your payment';
    case 'pending_verification': return 'Waiting for admin verification';
    case 'verified': return 'Verified — activating';
    case 'expired': return 'Ended (expired)';
    case 'cancelled': return 'Cancelled';
    case 'rejected': return 'Payment rejected';
    default: return s.status;
  }
}

export const isEnded = (s) => ['cancelled', 'expired', 'rejected'].includes(s.status);
export const canRenew = (s) => s.bucket === 'expiring' || s.status === 'expired' || (s.excluded && s.status === 'active');

export const planLabel = (m) => (m === 12 ? '12 months' : m === 1 ? '1 month' : `${m} months`);

/* ── Actions ────────────────────────────────────────────────────────────── */

/** Cancel with an optional reason. Resolves with the updated subscription, or null. */
export async function cancelSubscription(s) {
  const pendingPay = ['pending_payment', 'pending_verification', 'verified'].includes(s.status);
  const reason = await confirmAction({
    title: 'Cancel this subscription?',
    message: `<b>${esc(s.service.name)}</b> will be cancelled right away${pendingPay ? ' and the payment waiting on it will be closed' : ' and your card will stop working'}. This cannot be undone.`,
    confirm: 'Cancel subscription',
    reason: true,
    reasonLabel: 'Reason',
    reasonRequired: false,
  });
  if (reason === null) return null;
  try {
    const { subscription } = await api.post(`/api/me/subscriptions/${s.id}/cancel`, { reason: reason || undefined });
    toast('Subscription cancelled.');
    return subscription;
  } catch (e) { toast(e.message, 'bad'); return null; }
}

/** Exclude a subscription's service, optionally cancelling the plan too. */
export async function excludeSubscription(s) {
  const live = !isEnded(s);
  const result = await modal({
    title: 'Exclude from Subtize.ai?',
    tone: 'danger',
    confirm: 'Exclude service',
    body: `<p><b>${esc(s.service.name)}</b> will be hidden from search, explore and recommendations, and this subscription moves to the Excluded tab. You can restore it any time from Settings.</p>
      ${live ? `<label class="check mt-16"><input type="checkbox" name="cancel"> <span>Also cancel this subscription now${s.status === 'active' ? ' (otherwise it stays valid until its end date)' : ''}</span></label>` : ''}`,
    onSubmit: async (form) => {
      const cancel = Boolean(form.elements.cancel?.checked);
      const { subscription } = await api.post(`/api/me/subscriptions/${s.id}/exclude`, { cancel });
      return subscription;
    },
  });
  if (result) toast('Service excluded from Subtize.ai.');
  return result || null;
}

/** Exclude a service straight from its page. */
export async function excludeService(svc) {
  const ok = await confirmAction({
    title: 'Exclude from Subtize.ai?',
    message: `<b>${esc(svc.name)}</b> will be hidden from your search, explore and recommendations. Any subscription you hold for it moves to the Excluded tab. You can restore it from Settings.`,
    confirm: 'Exclude service',
  });
  if (!ok) return false;
  try {
    await api.post('/api/me/exclusions', { serviceId: svc.id });
    toast('Excluded. You will not see this service any more.');
    return true;
  } catch (e) { toast(e.message, 'bad'); return false; }
}

/* ── Cards ──────────────────────────────────────────────────────────────── */

/** Renders the same-origin card SVG to a 2× PNG and downloads it. */
export async function downloadCardPng(svgUrl, id, btn = null) {
  btn?.classList.add('is-loading');
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('The card image did not load.'));
      img.src = `${svgUrl}${svgUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    });
    const w = img.naturalWidth || 1012;
    const h = img.naturalHeight || 638;
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Your browser could not create the image.');
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `subtize-card-${id}.png` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Card downloaded.');
  } catch (e) {
    toast(`${e.message} Try "Download SVG" instead.`, 'bad');
  } finally { btn?.classList.remove('is-loading'); }
}

/* ── Voice fill (checkout) ──────────────────────────────────────────────── */


/**
 * A compact "say it" row: mic + text box. The assistant turns the words into
 * checkout fields (months, couponCode, upiTxnId) and onFields receives them.
 */
export function voiceFill(host, { serviceId, placeholder, onFields }) {
  host.innerHTML = `
    <form class="voice-fill" autocomplete="off">
      <div class="input-group">
        ${icon('sparkle')}
        <input class="input" name="say" placeholder="${esc(placeholder)}" aria-label="Fill by voice or text" style="padding-right:${voiceSupported ? 104 : 64}px">
        <div class="row" style="position:absolute;right:5px;gap:6px">
          ${voiceSupported ? `<button type="button" class="btn btn-secondary btn-icon btn-sm mic-btn" aria-label="Fill by voice" title="Fill by voice">${icon('mic')}</button>` : ''}
          <button type="submit" class="btn btn-outline btn-sm">Fill</button>
        </div>
      </div>
      <div class="voice-bar mt-8" hidden><span class="dot"></span><span data-text>Listening…</span></div>
      <div class="ai-reply mt-8" hidden>${icon('sparkle')}<div data-reply></div></div>
    </form>`;
  const form = $('form', host);
  const input = form.elements.say;
  const reply = $('.ai-reply', form);
  const run = async (text) => {
    text = String(text || '').trim();
    if (!text) { input.focus(); return; }
    const btn = $('button[type=submit]', form);
    btn.classList.add('is-loading');
    try {
      const r = await askAssistant(text, { context: { page: 'checkout', serviceId } });
      const f = r.fields || {};
      const has = f.months || f.couponCode !== undefined || f.upiTxnId;
      reply.hidden = false;
      $('[data-reply]', reply).textContent = has ? r.reply : 'I did not catch a plan length, coupon or transaction ID. Try "three months with coupon WELCOME10".';
      if (has && (r.intent === 'fill' || r.intent === 'subscribe' || has)) onFields(f, r);
    } catch (e) { toast(e.message, 'bad'); } finally { btn.classList.remove('is-loading'); }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); run(input.value); });
  attachMic($('.mic-btn', form), input, run, { status: $('.voice-bar', form) });
}

/* ── Misc ───────────────────────────────────────────────────────────────── */

export const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';

export const skeletonGrid = (n = 6, h = 300) => `<div class="grid auto" style="--min:270px">${Array.from({ length: n }, () => `<div class="skeleton" style="height:${h}px;border-radius:18px"></div>`).join('')}</div>`;

/**
 * Usage-log times are IST wall-clock stamps (server localStamp()), not UTC like
 * other timestamps, so fmtDateTime would shift them. Show them as written.
 */
export function fmtLogStamp(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v || ''));
  if (!m) return '—';
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Most validators put the field's *label* in err.details.field ("Phone",
 * "UPI ID"), not the input name, so showFieldError cannot find the input.
 * Translate through `map` first. Returns true when a field was marked.
 */
export function markFieldError(form, err, map = {}) {
  const f = err?.details?.field;
  const e = f && map[f] ? { ...err, message: err.message, details: { ...err.details, field: map[f] } } : err;
  return showFieldError(form, e);
}
