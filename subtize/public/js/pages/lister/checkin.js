/* #/checkin — verify a member's digital subscription card and record a visit. */
import { api } from '../../api.js';
import { periodMeter, usageMeter, usageRing } from '../../components.js';
import { pageHead } from '../../shell.js';
import { $, busy, esc, fmtDate, fmtDateTime, icon, modal, pill, toast } from '../../ui.js';
import { fail, monthsLabel } from './common.js';

const scanSupported = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

export async function renderCheckin({ view, query }) {
  view.innerHTML = `
    ${pageHead('Check-in', 'Scan or type a member’s Subtize.ai card to confirm their plan, then record the visit.')}
    <div class="split checkin-split">
      <div class="stack" style="--gap:20px">
        <form class="card checkin-form" id="ci-form" novalidate>
          <label class="label" for="ci-code">Card code, verify link or subscription ID</label>
          <div class="checkin-input">
            <div class="input-group grow">${icon('card')}<input class="input input-lg" id="ci-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. SUB-2026-9FED302F" required></div>
            <button class="btn btn-primary btn-lg" type="submit">${icon('search', 'sm')} Look up</button>
          </div>
          <div class="row wrap mt-16" style="--gap:10px">
            <button class="btn btn-secondary" type="button" id="ci-scan" hidden>${icon('qr', 'sm')} Scan card QR</button>
            <span class="small muted" id="ci-scan-note">${scanSupported()
              ? 'Point your camera at the QR on the member’s card, or type the ID printed under it.'
              : 'Camera scanning is not available in this browser. Typing the subscription ID or pasting the card link works everywhere.'}</span>
          </div>
        </form>
        <div id="ci-result" aria-live="polite"></div>
      </div>
      <aside class="stack" style="--gap:20px">
        <div class="card">
          <div class="card-head"><h3>${icon('info')} How check-in works</h3></div>
          <ol class="steps-list">
            <li><b>Ask for the card</b><span>Members show their digital card in the Subtize.ai app.</span></li>
            <li><b>Scan or type</b><span>Scan the QR, or type the subscription ID printed on the card.</span></li>
            <li><b>Check validity</b><span>Only serve plans that are valid today. Payment is always to the official Subtize.ai QR, never to you directly.</span></li>
            <li><b>Record the visit</b><span>The member sees their updated usage straight away.</span></li>
          </ol>
        </div>
        <div class="card" id="ci-log"></div>
      </aside>
    </div>`;

  const form = $('#ci-form', view);
  const input = $('#ci-code', view);
  const result = $('#ci-result', view);
  renderLog($('#ci-log', view));

  const lookup = async (code) => {
    const value = (code ?? input.value).trim();
    if (!value) { input.focus(); toast('Type or scan a card first.', 'info'); return; }
    await busy($('button[type=submit]', form), async () => {
      try {
        const data = await api.post('/api/lister/checkin/lookup', { code: value });
        renderResult(result, data, value, view);
      } catch (err) {
        result.innerHTML = `<div class="card verdict bad"><div class="verdict-icon">${icon('x', 'lg')}</div><div><h2>Card not accepted</h2><p class="mb-0">${esc(err.message)}</p></div></div>`;
      }
    });
  };

  form.addEventListener('submit', (e) => { e.preventDefault(); lookup(); });
  const scanBtn = $('#ci-scan', view);
  if (scanSupported()) {
    scanBtn.hidden = false;
    scanBtn.addEventListener('click', () => scanCard((raw) => { input.value = raw; lookup(raw); }));
  }
  if (query.get('code')) { input.value = query.get('code'); lookup(); } else input.focus();
}

function renderResult(host, data, code, view) {
  const s = data.subscription;
  const u = s.usage;
  const valid = data.validToday;
  const open = data.availableToday;
  const exhausted = u.allowed != null && u.remaining <= 0;
  const canRecord = valid && !exhausted;
  const verdict = !valid ? ['bad', 'x', 'Not valid today', s.status === 'active' ? `This plan runs ${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}.` : `This subscription is ${pill(s.status)}.`]
    : exhausted ? ['warn', 'alert', 'Valid, but no usage left', `All ${u.allowed} ${esc(u.unit)} for this cycle are used.`]
      : !open ? ['warn', 'alert', 'Valid plan, but closed today', 'Today is not one of this service’s available days. Serve the member only if you have agreed to.']
        : ['good', 'checkCircle', 'Valid today', 'Active plan and today is an available day.'];

  host.innerHTML = `
    <div class="card verdict ${verdict[0]}">
      <div class="verdict-icon">${icon(verdict[1], 'lg')}</div>
      <div class="grow"><h2>${verdict[2]}</h2><p class="mb-0">${verdict[3]}</p></div>
    </div>
    <div class="card mt-16">
      <div class="checkin-member">
        <div class="grow">
          <div class="eyebrow">Subscriber</div>
          <h3 class="checkin-name">${esc(s.subscriber)}</h3>
          <div class="soft">${esc(s.service)}</div>
          <div class="row wrap mt-8" style="--gap:8px">
            ${pill(s.status)}
            <span class="pill ${valid ? 'tone-good' : 'tone-bad'}">${valid ? 'Valid today' : 'Not valid today'}</span>
            <span class="pill ${open ? 'tone-good' : 'tone-warn'}">${open ? 'Open today' : 'Closed today'}</span>
          </div>
        </div>
        <div id="ci-ring">${usageRing(u, 116)}</div>
      </div>
      <dl class="kv mt-16">
        <dt>Subscription ID</dt><dd class="mono">${esc(s.id)}</dd>
        <dt>Plan</dt><dd>${esc(monthsLabel(s.months))}</dd>
        <dt>Valid</dt><dd>${esc(fmtDate(s.startDate))} – ${esc(fmtDate(s.endDate))}</dd>
      </dl>
      <div class="mt-16">${periodMeter({ ...s, remainingDays: daysLeft(s.endDate) })}</div>
      <div class="mt-16" id="ci-meter">${usageMeter(u, { big: true })}</div>

      ${canRecord ? `
      <form class="record-box mt-24" id="ci-record" novalidate>
        <h4>Record a visit</h4>
        <div class="record-row">
          <div class="field">
            <span class="label" id="units-label">${esc(capital(u.unit))}</span>
            <div class="stepper" role="group" aria-labelledby="units-label">
              <button type="button" class="btn btn-secondary btn-icon" data-step="-1" aria-label="One less">${icon('minus')}</button>
              <input class="input num" name="units" id="ci-units" type="number" min="1" max="${u.allowed != null ? Math.min(20, u.remaining) : 20}" value="1" inputmode="numeric" aria-label="Units">
              <button type="button" class="btn btn-secondary btn-icon" data-step="1" aria-label="One more">${icon('plus')}</button>
            </div>
          </div>
          <div class="field grow"><label for="ci-note">Note <span class="muted">(optional)</span></label><input class="input" id="ci-note" name="note" maxlength="200" placeholder="e.g. Morning session"></div>
        </div>
        <button class="btn btn-primary btn-lg btn-block mt-16" type="submit" id="ci-submit">${icon('check', 'sm')} Record 1 visit</button>
      </form>` : ''}
    </div>`;

  const rec = $('#ci-record', host);
  if (!rec) return;
  const units = $('#ci-units', rec);
  const max = Number(units.max);
  const label = () => {
    const n = Number(units.value) || 1;
    $('#ci-submit', rec).lastChild.textContent = ` Record ${n} ${n === 1 ? singular(u.unit) : u.unit}`;
  };
  rec.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    units.value = Math.max(1, Math.min(max, (Number(units.value) || 1) + Number(b.dataset.step)));
    label();
  }));
  units.addEventListener('input', label);
  label();

  rec.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = Number(units.value);
    if (!Number.isInteger(n) || n < 1 || n > max) { toast(`Enter between 1 and ${max}.`, 'bad'); return; }
    await busy($('#ci-submit', rec), async () => {
      try {
        const res = await api.post('/api/lister/checkin', { code, units: n, note: $('#ci-note', rec).value.trim() });
        toast(`Recorded ${n} ${n === 1 ? singular(res.usage.unit) : res.usage.unit} for ${s.subscriber}.`);
        renderResult(host, { ...data, subscription: { ...s, usage: res.usage } }, code, view);
        const done = $('.verdict', host);
        done?.insertAdjacentHTML('afterend', `<div class="panel-note good mt-16">${icon('checkCircle')}<div><strong>Visit recorded.</strong> ${res.usage.allowed == null ? `${res.usage.used} ${esc(res.usage.unit)} used this cycle.` : `${res.usage.remaining} of ${res.usage.allowed} ${esc(res.usage.unit)} left this cycle.`}</div></div>`);
        renderLog($('#ci-log', view));
      } catch (err) { fail(err); }
    });
  });
}

async function renderLog(host) {
  if (!host) return;
  let list = [];
  try { ({ checkins: list } = await api.get('/api/lister/checkins', { limit: 8 })); } catch { /* the log is a nicety */ }
  host.innerHTML = `<div class="card-head"><h3>${icon('clock')} Recent check-ins</h3></div>
    ${list.length ? `<ul class="activity-list compact">${list.map((c) => `
      <li><div class="grow"><b>${esc(c.subscriber)}</b><div class="small muted">${esc(c.service)}${c.note ? ` · ${esc(c.note)}` : ''}</div></div>
      <div class="right small"><b>+${c.units}</b> ${esc(c.units === 1 ? singular(c.unit) : c.unit)}<div class="muted">${esc(fmtDateTime(c.at))}</div></div></li>`).join('')}</ul>`
      : '<p class="small muted mb-0">Visits you record here appear in this list.</p>'}`;
}

const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : 'Visits');
const singular = (unit) => {
  const u = String(unit || 'visits');
  return /(ches|shes|sses|xes)$/.test(u) ? u.slice(0, -2) : u.replace(/s$/, '');
};
function daysLeft(end) {
  const [y, m, d] = end.split('-').map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((new Date(y, m - 1, d) - t) / 864e5) + 1);
}

/* ── Camera scanner (BarcodeDetector) ───────────────────────────────────── */

async function scanCard(onCode) {
  let stream = null;
  let timer = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  const body = `
    <div class="scanner">
      <video id="scan-video" playsinline muted></video>
      <div class="scanner-frame" aria-hidden="true"></div>
    </div>
    <p class="small muted mt-16 mb-0" id="scan-status">Starting the camera…</p>`;

  modal({
    title: 'Scan card QR',
    body,
    confirm: 'Close',
    cancel: null,
    hideConfirm: false,
    onOpen: async (box, close) => {
      const video = $('#scan-video', box);
      const status = $('#scan-status', box);
      // Stop the camera however the dialog closes (button, Escape, backdrop).
      const observer = new MutationObserver(() => { if (!box.isConnected) { stop(); observer.disconnect(); } });
      observer.observe(document.body, { childList: true });
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats?.().catch(() => []) || [];
        if (formats.length && !formats.includes('qr_code')) throw new Error('This browser cannot read QR codes. Type the subscription ID instead.');
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) { stop(); return; }
        video.srcObject = stream;
        await video.play();
        status.textContent = 'Hold the card steady inside the frame.';
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            const hit = codes.find((c) => c.rawValue);
            if (hit) { stop(); close(true); onCode(hit.rawValue); return; }
          } catch { /* frame not ready yet */ }
          timer = setTimeout(tick, 300);
        };
        tick();
      } catch (err) {
        stop();
        status.innerHTML = `<span class="accent-bad">${esc(err.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access, or type the subscription ID instead.' : err.message || 'Could not start the camera.')}</span>`;
      }
    },
  }).finally(stop);
}
