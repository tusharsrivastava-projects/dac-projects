/* #/cards and #/cards/:id — digital subscription cards: preview, download, print, show at counter. */
import { api } from '../../api.js';
import { emptyState } from '../../components.js';
import { pageHead, setPageTitle } from '../../shell.js';
import { $, copyText, el, esc, fmtDate, icon, pill } from '../../ui.js';
import { downloadCardPng, mountPage, onAct } from './common.js';

const cardStatus = (c) => (c.bucket === 'expiring' ? pill('expiring') : pill(c.status));
const usageText = (u) => (u.allowed == null ? `Unlimited ${u.unit} · ${u.used} used this cycle` : `${u.used} of ${u.allowed} ${u.unit} used · ${u.remaining} left`);

export async function renderCards({ view, isCurrent }) {
  const { cards } = await api.get('/api/me/cards');
  if (!isCurrent()) return;
  const page = mountPage(view, `
    ${pageHead('Subscription Cards', 'Show your card at the counter. Staff scan the QR to check you in and log usage.')}
    ${cards.length ? `<div class="grid auto" style="--min:320px">${cards.map((c) => `
      <article class="card card-tile">
        <a class="card-img-link" href="#/cards/${esc(c.subscriptionId)}" aria-label="Open card for ${esc(c.service.name)}"><img class="card-img" src="${esc(c.svgUrl)}" alt="Subscription card for ${esc(c.service.name)}" loading="lazy" width="1012" height="638"></a>
        <div class="row between mt-16" style="--gap:8px"><b class="clip">${esc(c.service.name)}</b>${cardStatus(c)}</div>
        <div class="muted small mt-8">Valid ${fmtDate(c.activatedOn)} – ${fmtDate(c.validTill)} · <span class="mono">${esc(c.subscriptionId)}</span></div>
        <div class="row wrap mt-16" style="--gap:8px">
          <button type="button" class="btn btn-primary btn-sm" data-act="png" data-id="${esc(c.subscriptionId)}" data-url="${esc(c.svgUrl)}">${icon('download', 'sm')} PNG</button>
          <a class="btn btn-secondary btn-sm" href="${esc(c.svgUrl)}?download=1" download>${icon('download', 'sm')} SVG</a>
          <a class="btn btn-secondary btn-sm" href="#/cards/${esc(c.subscriptionId)}">${icon('external', 'sm')} Open</a>
        </div>
      </article>`).join('')}</div>`
    : emptyState({ ic: 'card', title: 'No cards yet', text: 'Your digital subscription card appears here as soon as an admin verifies your payment and activates the plan.', action: '<a class="btn btn-primary" href="#/subscriptions?tab=pending">See pending subscriptions</a>' })}`);
  onAct(page, { png: (b) => downloadCardPng(b.dataset.url, b.dataset.id, b) });
}

export async function renderCard({ view, params, isCurrent }) {
  const { card: c } = await api.get(`/api/me/cards/${encodeURIComponent(params.id)}`);
  if (!isCurrent()) return;
  setPageTitle(`Card · ${c.service.name}`);
  const page = mountPage(view, `
    <a class="back-link no-print" href="#/cards">${icon('back', 'sm')} Subscription Cards</a>
    <div class="page-head mt-16 no-print"><div><h1>${esc(c.service.name)}</h1><p class="row wrap" style="--gap:8px">${cardStatus(c)} <span class="mono">${esc(c.subscriptionId)}</span></p></div>
      <div class="row wrap">
        <button type="button" class="btn btn-primary" data-act="counter">${icon('smartphone', 'sm')} Show at counter</button>
      </div></div>
    <div class="split card-detail">
      <div class="stack" style="--gap:16px">
        <div class="card-stage print-area"><img class="card-img big" src="${esc(c.svgUrl)}" alt="Subscription card for ${esc(c.service.name)}" width="1012" height="638"></div>
        <div class="row wrap no-print" style="--gap:10px">
          <button type="button" class="btn btn-primary" data-act="png">${icon('download', 'sm')} Download Subscription Card</button>
          <a class="btn btn-secondary" href="${esc(c.svgUrl)}?download=1" download>${icon('file', 'sm')} Download SVG</a>
          <button type="button" class="btn btn-secondary" data-act="print">${icon('receipt', 'sm')} Print</button>
        </div>
      </div>
      <aside class="card no-print">
        <div class="card-head"><h3>${icon('card')} Card details</h3></div>
        <dl class="kv">
          <dt>Card holder</dt><dd>${esc(c.holder)}</dd>
          <dt>Service</dt><dd>${esc(c.service.name)}</dd>
          <dt>Category</dt><dd>${esc(c.service.category)}</dd>
          <dt>Location</dt><dd>${esc(c.service.area)}, ${esc(c.service.city)}</dd>
          <dt>Available days</dt><dd>${esc(c.service.days)}</dd>
          <dt>Subscription ID</dt><dd class="mono">${esc(c.subscriptionId)}</dd>
          <dt>Activated on</dt><dd>${fmtDate(c.activatedOn)}</dd>
          <dt>Valid till</dt><dd>${fmtDate(c.validTill)}</dd>
          <dt>Status</dt><dd>${cardStatus(c)}</dd>
          <dt>Usage</dt><dd>${esc(usageText(c.usage))}</dd>
          <dt>Verify URL</dt><dd><a class="mono small" href="${esc(c.verifyUrl)}" target="_blank" rel="noopener">${esc(c.verifyUrl)}</a>
            <button type="button" class="btn btn-ghost btn-sm btn-icon" data-act="copy" aria-label="Copy verify link">${icon('copy', 'sm')}</button></dd>
        </dl>
        <div class="panel-note mt-16 small">${icon('shield')}<div>The QR on your card opens this verify link. Staff see only your first name, the service, validity and usage — never your contact details.</div></div>
        <div class="row wrap mt-16" style="--gap:8px"><a class="btn btn-secondary btn-sm" href="#/subscriptions/${esc(c.subscriptionId)}">${icon('layers', 'sm')} Subscription</a><a class="btn btn-secondary btn-sm" href="#/usage">${icon('gauge', 'sm')} Usage</a></div>
      </aside>
    </div>`);

  onAct(page, {
    png: (b) => downloadCardPng(c.svgUrl, c.subscriptionId, b),
    print: () => window.print(),
    copy: () => copyText(c.verifyUrl, 'Verify link copied'),
    counter: () => counterMode(c),
  });
}

/** Full-screen, dark, distraction-free card for showing at the door. */
function counterMode(c) {
  const overlay = el('div', { class: 'counter-mode', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Card for the counter' });
  overlay.innerHTML = `
    <button type="button" class="btn btn-secondary btn-icon counter-close" aria-label="Close">${icon('close')}</button>
    <div class="counter-inner">
      <img src="${esc(c.svgUrl)}" alt="Subscription card for ${esc(c.service.name)}">
      <div class="counter-meta">
        <b>${esc(c.holder)}</b>
        <span>${esc(c.service.name)}</span>
        <span class="mono">${esc(c.subscriptionId)} · valid till ${esc(fmtDate(c.validTill))}</span>
      </div>
      <p class="counter-tip">Turn your screen brightness up and hold the phone steady for the scan.</p>
    </div>`;
  document.body.append(overlay);
  document.body.classList.add('counter-open');
  const close = () => {
    overlay.remove();
    document.body.classList.remove('counter-open');
    document.removeEventListener('keydown', onKey);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('.counter-close', overlay).addEventListener('click', close);
  document.addEventListener('fullscreenchange', function fs() {
    if (!document.fullscreenElement && overlay.isConnected) { document.removeEventListener('fullscreenchange', fs); close(); }
  });
  overlay.requestFullscreen?.().catch(() => { /* fine without it */ });
  // Keep the screen awake while the card is up, where supported.
  navigator.wakeLock?.request('screen').then((lock) => {
    const release = () => lock.release().catch(() => {});
    if (!overlay.isConnected) { release(); return; }
    const obs = new MutationObserver(() => { if (!overlay.isConnected) { release(); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  }).catch(() => {});
}
