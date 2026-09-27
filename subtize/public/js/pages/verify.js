/* Public card check for staff at the counter: a big VALID / NOT VALID first, details after. */
import { api } from '../api.js';
import { usageMeter } from '../components.js';
import { mountSite } from '../site.js';
import { $, DAY_SHORT, DAYS, esc, fmtDate, fmtDateTime, icon } from '../ui.js';

mountSite();
const root = $('#verify-root');
const code = decodeURIComponent(location.pathname.split('/')[2] || '');
const todayKey = DAYS[(new Date().getDay() + 6) % 7];
const DAY_FULL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

function verdict(r) {
  if (r.valid) return { tone: 'ok', ic: 'check', word: 'VALID', text: 'This subscription is active today.' };
  if (r.status === 'upcoming') return { tone: 'warn', ic: 'clock', word: 'NOT VALID YET', text: `This plan starts on ${fmtDate(r.validFrom)}. It cannot be used before then.` };
  if (r.status === 'expired') return { tone: 'no', ic: 'close', word: 'NOT VALID', text: `This plan expired on ${fmtDate(r.validTo)}. The member can renew it in the Subtize.ai app.` };
  if (r.status === 'cancelled') return { tone: 'no', ic: 'close', word: 'NOT VALID', text: 'This subscription was cancelled and can no longer be used.' };
  if (r.status === 'active') return { tone: 'no', ic: 'close', word: 'NOT VALID', text: `This plan is outside its dates (${fmtDate(r.validFrom)} to ${fmtDate(r.validTo)}).` };
  return { tone: 'no', ic: 'close', word: 'NOT VALID', text: 'This subscription is not active, so the card cannot be used.' };
}

async function check() {
  root.innerHTML = '<div class="loading">Checking card…</div>';
  let r;
  try {
    r = await api.get(`/api/verify/${encodeURIComponent(code)}`);
  } catch (e) {
    document.title = 'Card not recognised · Subtize.ai';
    root.innerHTML = `
      <div class="verdict no" role="status">
        <div class="mark">${icon('alert')}</div>
        <div class="word">NOT RECOGNISED</div>
        <p>${e.status === 404
          ? 'This card code does not match any Subtize.ai subscription. It may have been typed or scanned incorrectly.'
          : esc(e.message)}</p>
      </div>
      <div class="card mt-16">
        <h3 class="mb-8">What to do</h3>
        <ul class="soft" style="margin:0;padding-left:20px">
          <li>Ask the member to open their card in the Subtize.ai app and scan the QR again.</li>
          <li>Check the full link was scanned. Codes are case-sensitive.</li>
          <li>Still stuck? Contact <a href="/contact">Subtize.ai support</a>. Do not accept payment at the counter.</li>
        </ul>
      </div>
      <div class="row wrap mt-16" style="justify-content:center"><button type="button" class="btn btn-secondary" id="retry">${icon('refresh', 'sm')} Check again</button></div>`;
    $('#retry').addEventListener('click', check);
    return;
  }

  const v = verdict(r);
  const openToday = r.availableDays.includes(todayKey);
  const u = r.usage || {};
  const usedUp = u.allowed != null && u.remaining <= 0;
  document.title = `${v.word} · ${r.service} · Subtize.ai`;

  root.innerHTML = `
    <div class="verdict ${v.tone}" role="status">
      <div class="mark">${icon(v.ic)}</div>
      <div class="word">${v.word}</div>
      <p>${esc(v.text)}</p>
    </div>

    ${r.valid && !openToday ? `<div class="panel-note warn mt-16">${icon('alert')}<div><strong>This service does not run on ${DAY_FULL[todayKey]}s.</strong> The plan is valid, but today is not one of its available days.</div></div>` : ''}
    ${r.valid && usedUp ? `<div class="panel-note warn mt-16">${icon('alert')}<div><strong>Monthly allowance used up.</strong> All ${u.allowed} ${esc(u.unit || 'uses')} for this plan month have been used.</div></div>` : ''}

    <section class="card mt-16" aria-label="Card details">
      <div class="eyebrow">Card holder</div>
      <div class="holder">${esc(r.holder)}</div>
      <div class="soft mt-8" style="font-size:16px">${esc(r.service)}</div>
      <hr class="divider">
      <dl class="kv">
        <dt>Subscription ID</dt><dd class="mono">${esc(r.subscriptionId)}</dd>
        <dt>Valid from</dt><dd>${esc(fmtDate(r.validFrom))}</dd>
        <dt>Valid to</dt><dd>${esc(fmtDate(r.validTo))}</dd>
      </dl>
      <hr class="divider">
      <div class="label mb-8">Available days</div>
      <div class="verify-days" aria-label="Available ${esc(r.availableDays.map((d) => DAY_FULL[d]).join(', '))}">
        ${DAYS.map((d) => `<span class="${r.availableDays.includes(d) ? 'on' : ''} ${d === todayKey ? 'today' : ''}" title="${DAY_FULL[d]}${r.availableDays.includes(d) ? ' — available' : ' — closed'}">${DAY_SHORT[d]}</span>`).join('')}
      </div>
      <hr class="divider">
      <div class="label mb-8">Usage this plan month</div>
      ${u.allowed == null
        ? `<p style="margin:0"><b>${u.used ?? 0}</b> ${esc(u.unit || 'uses')} used · <span class="accent">Unlimited</span></p>`
        : usageMeter({ allowed: u.allowed, used: u.used, remaining: u.remaining, unit: u.unit || 'uses' }, { big: true })}
    </section>

    <div class="row between wrap mt-16 small muted">
      <span>Checked ${esc(fmtDateTime(r.checkedAt))}</span>
      <button type="button" class="btn btn-secondary btn-sm" id="retry">${icon('refresh', 'sm')} Check again</button>
    </div>
    <p class="muted small mt-16">Only the holder's first name and last initial are shown. Members pay Subtize.ai directly, so never take payment at the counter. Listers can record a visit from the lister dashboard.</p>`;
  $('#retry').addEventListener('click', check);
}

check();
