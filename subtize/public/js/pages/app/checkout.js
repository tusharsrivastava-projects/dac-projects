/*
 * #/checkout/:serviceId — details → plan → coupon → final payable → proceed.
 * #/payments/:id        — official QR → UTR → pending verification (or status).
 */
import { api } from '../../api.js';
import { go, setPageTitle } from '../../shell.js';
import {
  $, $$, confirmAction, copyText, esc, fmtDate, fmtDateTime, icon, inr, pill, showFieldError, toast,
} from '../../ui.js';
import {
  catTile, dayStrip, mountPage, openTodayPill, planLabel, voiceFill,
} from './common.js';

const STEPS = ['Service', 'Plan', 'Coupon', 'Review', 'Pay', 'Submit UTR', 'Verification'];

function stepper(current) {
  return `<ol class="steps" aria-label="Subscription steps">${STEPS.map((s, i) => {
    const n = i + 1;
    const st = n < current ? 'done' : n === current ? 'current' : '';
    return `<li class="${st}" ${n === current ? 'aria-current="step"' : ''}><span class="n">${n < current ? icon('check', 'sm') : n}</span><span class="t">${esc(s)}</span></li>`;
  }).join('')}</ol>
  <div class="steps-mobile">Step ${current} of ${STEPS.length} · <b>${esc(STEPS[current - 1])}</b></div>`;
}

/* ── Checkout ───────────────────────────────────────────────────────────── */

export async function renderCheckout({ view, params, query, isCurrent }) {
  let s;
  try {
    ({ service: s } = await api.get(`/api/services/${encodeURIComponent(params.serviceId)}`));
  } catch (e) {
    if (e.status === 404) {
      mountPage(view, `<div class="empty"><div class="icon-tile">${icon('alert')}</div><h3>This service is not taking subscriptions</h3><p>${esc(e.message)}</p><a class="btn btn-primary" href="#/explore">Explore services</a></div>`);
      return;
    }
    throw e;
  }
  if (!isCurrent()) return;
  setPageTitle(`Subscribe · ${s.name}`);

  const qMonths = Number(query.get('months'));
  const state = {
    months: s.plans.includes(qMonths) ? qMonths : s.plans[0],
    coupon: (query.get('coupon') || '').trim().toUpperCase(),
    quote: null,
  };
  const mine = s.mySubscription;
  const blocked = mine && ['pending_verification', 'verified'].includes(mine.status);
  const full = s.spotsLeft === 0 && mine?.status !== 'active';
  const p = s.usagePolicy || {};

  const notices = [];
  if (blocked) notices.push(`<div class="panel-note warn">${icon('clock')}<div><strong>You already have a payment for this service waiting on verification.</strong> You can subscribe again once it is verified or closed. <a href="#/subscriptions/${esc(mine.id)}">View it</a></div></div>`);
  else if (mine?.status === 'active') notices.push(`<div class="panel-note">${icon('refresh')}<div><strong>You are subscribed until ${esc(fmtDate(mine.endDate))}.</strong> A renewal starts the day after your current plan ends. Renewal opens in the last few days of a plan.</div></div>`);
  else if (mine?.status === 'pending_payment') notices.push(`<div class="panel-note">${icon('info')}<div>You have an unpaid checkout for this service. Continuing here replaces it with a fresh QR.</div></div>`);
  if (full) notices.push(`<div class="panel-note danger">${icon('alert')}<div><strong>This service is full right now.</strong> Check back soon, or <a href="#/explore?category=${esc(s.category.slug)}">see similar services</a>.</div></div>`);

  const page = mountPage(view, `
    <a class="back-link" href="#/services/${s.id}">${icon('back', 'sm')} Back to service</a>
    <div class="page-head mt-16"><div><h1>Subscribe</h1><p>Five quick steps. You pay only to the official Subtize.ai UPI QR.</p></div></div>
    ${stepper(2)}
    ${notices.length ? `<div class="stack mt-16">${notices.join('')}</div>` : ''}
    <div class="split checkout mt-24">
      <div class="stack" style="--gap:18px">
        <section class="card co-step">
          <div class="co-num">1</div>
          <div class="grow">
            <h3>Service details</h3>
            <div class="row top mt-16" style="--gap:14px">
              ${catTile(s.category.icon)}
              <div class="grow">
                <div class="eyebrow accent">${esc(s.category.name)}</div>
                <div class="co-name">${esc(s.name)}</div>
                <div class="muted small row" style="--gap:6px">${icon('pin', 'sm')} ${esc(s.area)}, ${esc(s.city)}${s.distanceKm != null ? ` · ${s.distanceKm} km` : ''}</div>
              </div>
              <div class="price nowrap">${inr(s.monthlyPrice)}<small> /mo</small></div>
            </div>
            <div class="co-avail mt-16">
              <div><div class="label mb-8">Available days</div>${dayStrip(s.availableDays)}</div>
              <div><div class="label mb-8">Hours</div><div class="soft">${esc(s.hours || 'See service rules')}</div></div>
              <div><div class="label mb-8">Today</div>${openTodayPill(s.availableDays)}</div>
            </div>
            <dl class="kv" style="margin-top:16px">
              <dt>Usage</dt><dd>${p.allowed == null ? `Unlimited ${esc(p.unit || '')}` : `${p.allowed} ${esc(p.unit)}`} per month</dd>
              ${p.restrictions ? `<dt>Restrictions</dt><dd>${esc(p.restrictions)}</dd>` : ''}
              ${s.spotsLeft != null ? `<dt>Spots left</dt><dd>${s.spotsLeft}</dd>` : ''}
            </dl>
          </div>
        </section>

        <section class="card co-step">
          <div class="co-num">2</div>
          <div class="grow">
            <h3>Select your plan</h3>
            <div class="plan-list mt-16" role="radiogroup" aria-label="Plan length">
              ${s.plans.map((m) => `<label class="plan-opt"><input type="radio" name="months" value="${m}" ${m === state.months ? 'checked' : ''}>
                <span><b>${planLabel(m)}</b><span class="num">${inr(s.monthlyPrice * m)}${m > 1 ? `<small class="muted"> · ${inr(s.monthlyPrice)}/mo</small>` : ''}</span></span></label>`).join('')}
            </div>
            <p class="muted small mt-8" style="margin-bottom:0">Usage allowances reset every month, even on longer plans.</p>
          </div>
        </section>

        <section class="card co-step">
          <div class="co-num">3</div>
          <div class="grow">
            <h3>Coupon code <span class="muted small" style="font-weight:500">(optional)</span></h3>
            <form class="coupon-form mt-16" novalidate autocomplete="off">
              <div class="field">
                <label for="co-coupon" class="sr-only">Coupon code</label>
                <div class="row" style="--gap:8px">
                  <input class="input mono grow" id="co-coupon" name="couponCode" placeholder="e.g. WELCOME10" value="${esc(state.coupon)}" style="text-transform:uppercase">
                  <button type="submit" class="btn btn-secondary">Apply</button>
                </div>
              </div>
              <div class="coupon-applied mt-8" hidden></div>
              ${s.offerCode ? `<div class="mt-8 small soft">Offer available: <button type="button" class="chip" data-use="${esc(s.offerCode)}">${icon('tag')} ${esc(s.offerCode)} · ${esc(s.offerLabel)}</button></div>` : ''}
              <div class="mt-8 small"><a href="#/coupons">See all coupons</a></div>
            </form>
          </div>
        </section>

        <section class="card">
          <div class="card-head" style="margin-bottom:10px"><h3>${icon('mic')} Fill by voice</h3></div>
          <p class="muted small">Say or type something like “three months with coupon WELCOME10”.</p>
          <div data-voice></div>
        </section>
      </div>

      <aside class="stack sticky-side" style="--gap:16px">
        <section class="card co-step summary">
          <div class="co-num">4</div>
          <div class="grow">
            <h3>Final payable</h3>
            <div data-summary class="mt-16"><div class="skeleton" style="height:120px"></div></div>
          </div>
        </section>
        <section class="card co-step">
          <div class="co-num">5</div>
          <div class="grow">
            <h3>Pay with UPI</h3>
            <p class="muted small mt-8">Next you will see the official Subtize.ai QR for the exact amount.</p>
            <div data-err></div>
            <button type="button" class="btn btn-primary btn-lg btn-block mt-8" data-proceed ${blocked || full ? 'disabled' : ''}>${icon('qr')} Proceed to pay</button>
            <div class="panel-note warn mt-16 small">${icon('shield')}<div><strong>Pay only to the official Subtize.ai QR.</strong> Never pay a provider directly — payments outside Subtize.ai cannot be verified or refunded.</div></div>
          </div>
        </section>
      </aside>
    </div>`);

  const couponForm = $('.coupon-form', page);
  const couponInput = couponForm.elements.couponCode;
  const applied = $('.coupon-applied', page);
  const summary = $('[data-summary]', page);

  const renderSummary = () => {
    const q = state.quote;
    if (!q) { summary.innerHTML = '<div class="muted">Price unavailable.</div>'; return; }
    summary.innerHTML = `
      <dl class="sum">
        <div><dt>Monthly price</dt><dd class="num">${inr(q.monthlyPrice)}</dd></div>
        <div><dt>Plan</dt><dd>${planLabel(q.months)}</dd></div>
        <div><dt>Amount</dt><dd class="num">${inr(q.amount)}</dd></div>
        <div class="${q.discount ? 'disc' : ''}"><dt>Discount${q.coupon ? ` <span class="mono">(${esc(q.coupon.code)})</span>` : ''}</dt><dd class="num">${q.discount ? `− ${inr(q.discount)}` : inr(0)}</dd></div>
        <div class="total"><dt>Final payable</dt><dd class="num">${inr(q.finalAmount)}</dd></div>
      </dl>`;
    applied.hidden = !q.coupon;
    applied.innerHTML = q.coupon ? `<span class="offer-tag">${icon('checkCircle', 'sm')} ${esc(q.coupon.code)} applied — you save ${inr(q.discount)}</span> <button type="button" class="btn btn-ghost btn-sm" data-remove>Remove</button>` : '';
  };

  const requote = async ({ fromApply = false } = {}) => {
    showFieldError(couponForm, null);
    try {
      const { quote } = await api.post('/api/me/checkout/quote', { serviceId: s.id, months: state.months, couponCode: state.coupon || undefined });
      state.quote = quote;
      if (fromApply && quote.coupon) toast(`Coupon ${quote.coupon.code} applied.`);
    } catch (e) {
      if (e.details?.field === 'couponCode' && state.coupon) {
        showFieldError(couponForm, e);
        state.coupon = '';
        const { quote } = await api.post('/api/me/checkout/quote', { serviceId: s.id, months: state.months });
        state.quote = quote;
      } else { toast(e.message, 'bad'); }
    }
    renderSummary();
  };

  const setMonths = (m) => {
    if (!s.plans.includes(Number(m))) { toast(`This service offers ${s.plans.map(planLabel).join(', ')} plans.`, 'info'); return false; }
    state.months = Number(m);
    $$('input[name=months]', page).forEach((r) => { r.checked = Number(r.value) === state.months; });
    return true;
  };

  page.addEventListener('change', (e) => {
    if (e.target.name === 'months') { setMonths(e.target.value); requote(); }
  });
  couponForm.addEventListener('submit', (e) => {
    e.preventDefault();
    state.coupon = couponInput.value.trim().toUpperCase();
    couponInput.value = state.coupon;
    busyBtn($('button[type=submit]', couponForm), () => requote({ fromApply: true }));
  });
  page.addEventListener('click', (e) => {
    const use = e.target.closest('[data-use]');
    if (use) { couponInput.value = use.dataset.use; couponForm.requestSubmit(); }
    if (e.target.closest('[data-remove]')) { state.coupon = ''; couponInput.value = ''; requote(); }
  });

  voiceFill($('[data-voice]', page), {
    serviceId: s.id,
    placeholder: 'e.g. three months with coupon WELCOME10',
    onFields: (f) => {
      let changed = false;
      if (f.months) changed = setMonths(f.months) || changed;
      if (f.couponCode !== undefined) { state.coupon = String(f.couponCode || '').toUpperCase(); couponInput.value = state.coupon; changed = true; }
      if (f.upiTxnId) toast('Keep that transaction ID — you will enter it after paying.', 'info');
      if (changed) requote({ fromApply: Boolean(f.couponCode) });
    },
  });

  $('[data-proceed]', page).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const err = $('[data-err]', page);
    err.innerHTML = '';
    btn.classList.add('is-loading');
    try {
      const { payment } = await api.post('/api/me/checkout', { serviceId: s.id, months: state.months, couponCode: state.coupon || undefined });
      go(`/payments/${payment.id}`, { replace: true });
    } catch (ex) {
      btn.classList.remove('is-loading');
      if (ex.details?.field === 'couponCode') { showFieldError(couponForm, ex); state.coupon = ''; requote(); return; }
      const links = ex.status === 409
        ? `<div class="row wrap mt-8" style="--gap:8px"><a class="btn btn-secondary btn-sm" href="#/subscriptions">My subscriptions</a><a class="btn btn-secondary btn-sm" href="#/payments">Payments</a></div>`
        : ex.status === 403 ? '<div class="mt-8"><a href="#/profile">Go to your profile</a></div>' : '';
      err.innerHTML = `<div class="panel-note danger mt-8">${icon('alert')}<div><strong>${esc(ex.message)}</strong>${links}</div></div>`;
    }
  });

  // First quote: with the prefilled coupon if there is one.
  await requote({ fromApply: false });
}

async function busyBtn(btn, fn) {
  btn.classList.add('is-loading');
  try { await fn(); } finally { btn.classList.remove('is-loading'); }
}

/* ── Payment: QR → UTR → pending ────────────────────────────────────────── */

export async function renderPayment({ view, params, isCurrent }) {
  const { payment: p } = await api.get(`/api/me/payments/${encodeURIComponent(params.id)}`);
  if (!isCurrent()) return;
  setPageTitle(p.status === 'awaiting_payment' ? 'Pay with UPI' : 'Payment status');
  if (p.status === 'awaiting_payment') return payScreen(view, p);
  return statusScreen(view, p);
}

function payScreen(view, p) {
  const q = p.qr;
  const page = mountPage(view, `
    <a class="back-link" href="#/services/${p.service.id}">${icon('back', 'sm')} ${esc(p.service.name)}</a>
    <div class="page-head mt-16"><div><h1>Pay ${inr(p.finalAmount)}</h1><p>${esc(p.service.name)} · ${planLabel(p.months)} · Payment <span class="mono">${esc(p.id)}</span></p></div></div>
    ${stepper(5)}
    <div class="panel-note danger official-note mt-16">${icon('shield')}<div><strong>Pay only to this official Subtize.ai QR. Never pay a provider directly.</strong> Subtize.ai collects every payment and passes it on. Money sent anywhere else cannot be verified, activated or refunded.</div></div>
    <div class="grid cols-2 pay-grid mt-24">
      <section class="card qr-card">
        <div class="card-head"><h3>${icon('qr')} Scan &amp; pay</h3>${pill('awaiting_payment')}</div>
        ${q.attachedUrl ? `<div class="segmented mb-16" role="tablist"><button type="button" class="active" data-qr="gen" role="tab">Payment QR</button><button type="button" data-qr="img" role="tab">Show the official QR image</button></div>` : ''}
        <div class="qr-frame" data-qr-gen><img src="${esc(q.image)}" alt="Official Subtize.ai UPI QR for ${esc(inr(p.finalAmount))}" width="260" height="260"></div>
        ${q.attachedUrl ? `<div class="qr-frame" data-qr-img hidden><img src="${esc(q.attachedUrl)}" alt="Official Subtize.ai QR image" loading="lazy"></div>
          <p class="muted small center mt-8" data-qr-img-note hidden>With the official QR image, enter the exact amount ${inr(p.finalAmount)} and reference ${esc(p.upiRef)} yourself.</p>` : ''}
        <div class="pay-amount mt-16"><span class="muted small">Pay exactly</span><b class="num">${inr(p.finalAmount)}</b></div>
        <a class="btn btn-primary btn-lg btn-block mt-16 upi-open" href="${esc(q.upiUri)}">${icon('smartphone')} Open in UPI app</a>
        <p class="muted small center mt-8" style="margin-bottom:0">On a phone? This opens Google Pay, PhonePe, Paytm or BHIM with everything filled in.</p>
        <div class="divider"></div>
        <dl class="kv pay-kv">
          <dt>Payee name</dt><dd>${esc(q.payee)} ${q.official ? `<span class="pill tone-good plain" style="margin-left:4px">${icon('checkCircle', 'sm')} Official</span>` : ''}</dd>
          <dt>UPI ID</dt><dd><span class="mono">${esc(q.vpa)}</span> <button type="button" class="btn btn-ghost btn-sm btn-icon" data-copy="${esc(q.vpa)}" data-label="UPI ID copied" aria-label="Copy UPI ID">${icon('copy', 'sm')}</button></dd>
          <dt>Amount</dt><dd><span class="num">${inr(p.finalAmount)}</span> <button type="button" class="btn btn-ghost btn-sm btn-icon" data-copy="${(p.finalAmount / 100).toFixed(2)}" data-label="Amount copied" aria-label="Copy amount">${icon('copy', 'sm')}</button></dd>
          <dt>Reference</dt><dd><span class="mono">${esc(p.upiRef)}</span> <button type="button" class="btn btn-ghost btn-sm btn-icon" data-copy="${esc(p.upiRef)}" data-label="Reference copied" aria-label="Copy reference">${icon('copy', 'sm')}</button></dd>
          ${p.discount ? `<dt>Discount</dt><dd>${inr(p.discount)} off ${inr(p.amount)}${p.couponCode ? ` <span class="mono">(${esc(p.couponCode)})</span>` : ''}</dd>` : ''}
        </dl>
      </section>

      <section class="card utr-card">
        <div class="card-head"><h3>${icon('receipt')} After paying: enter your UPI Transaction ID</h3></div>
        <ol class="howto">
          <li>Pay <b>${inr(p.finalAmount)}</b> using the QR or the button.</li>
          <li>Open the payment receipt in your UPI app.</li>
          <li>Copy the <b>UPI Transaction ID</b> (also called UTR or UPI Ref No.) — usually 12 digits.</li>
        </ol>
        <form class="utr-form mt-16" novalidate autocomplete="off">
          <div class="field">
            <label for="utr" class="req">UPI Transaction ID (UTR)</label>
            <input class="input mono utr-input" id="utr" name="upiTxnId" inputmode="numeric" placeholder="e.g. 419200123456" maxlength="40" required>
            <div class="hint">We match this with the payment received by Subtize.ai.</div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg btn-block mt-16">${icon('checkCircle')} Submit for verification</button>
        </form>
        <div class="mt-16"><div class="label mb-8">Or say it</div><div data-voice></div></div>
        <div class="divider"></div>
        <div class="row between wrap" style="--gap:8px">
          <span class="muted small">Changed your mind? Nothing has been charged by Subtize.ai.</span>
          <button type="button" class="btn btn-danger-outline btn-sm" data-abandon>${icon('trash', 'sm')} Discard checkout</button>
        </div>
      </section>
    </div>`);

  const form = $('.utr-form', page);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    const v = form.elements.upiTxnId.value.replace(/\s+/g, '').toUpperCase();
    showFieldError(form, null);
    if (!/^[A-Z0-9]{10,35}$/.test(v)) {
      showFieldError(form, { message: 'Enter the UPI Transaction ID from your receipt — usually a 12-digit number.', details: { field: 'upiTxnId' } });
      return;
    }
    btn.classList.add('is-loading');
    try {
      const { payment } = await api.post(`/api/me/payments/${p.id}/submit`, { upiTxnId: v });
      toast('Submitted. Your payment is pending verification.');
      statusScreen(page.parentElement, { ...p, ...payment });
      window.scrollTo(0, 0);
    } catch (ex) {
      if (!showFieldError(form, ex)) {
        if (ex.status === 409) showFieldError(form, { message: ex.message, details: { field: 'upiTxnId' } });
        else toast(ex.message, 'bad');
      }
    } finally { btn.classList.remove('is-loading'); }
  });

  voiceFill($('[data-voice]', page), {
    serviceId: p.service.id,
    placeholder: 'e.g. my transaction ID is 4192…',
    onFields: (f) => {
      if (f.upiTxnId) { form.elements.upiTxnId.value = f.upiTxnId; form.elements.upiTxnId.focus(); }
      else if (f.months || f.couponCode !== undefined) toast('Plan and coupon are locked for this payment. Discard it to change them.', 'info');
    },
  });

  page.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { copyText(c.dataset.copy, c.dataset.label || 'Copied'); return; }
    const tab = e.target.closest('[data-qr]');
    if (tab) {
      $$('[data-qr]', page).forEach((b) => b.classList.toggle('active', b === tab));
      const img = tab.dataset.qr === 'img';
      $('[data-qr-gen]', page).hidden = img;
      $('[data-qr-img]', page).hidden = !img;
      $('[data-qr-img-note]', page).hidden = !img;
      return;
    }
    if (e.target.closest('[data-abandon]')) {
      const ok = await confirmAction({
        title: 'Discard this checkout?',
        message: `The QR for <b>${esc(inr(p.finalAmount))}</b> will stop being valid. <b>Do not discard if you have already paid</b> — submit your transaction ID instead.`,
        confirm: 'Discard checkout',
      });
      if (!ok) return;
      try {
        await api.post(`/api/me/payments/${p.id}/abandon`);
        toast('Checkout discarded.');
        go(`/services/${p.service.id}`);
      } catch (ex) { toast(ex.message, 'bad'); }
    }
  });
}

function statusScreen(view, p) {
  const S = {
    pending: { step: 7, ic: 'clock', tone: 'warn', title: 'Pending verification', text: 'Thank you! A Subtize.ai admin now checks your UPI Transaction ID against the payment we received and activates your subscription — usually within a few hours. You will get a notification, and your digital subscription card will appear under Subscription Cards.' },
    verified: { step: 8, ic: 'checkCircle', tone: 'good', title: 'Payment verified', text: 'Your payment has been verified. Your subscription is active (or will start right after your current plan) and your digital card is ready.' },
    rejected: { step: 6, ic: 'alert', tone: 'bad', title: 'Payment not verified', text: p.rejectionReason ? `Reason: ${p.rejectionReason}` : 'This payment could not be verified.' },
  }[p.status] || { step: 5, ic: 'info', tone: 'neutral', title: p.status, text: '' };

  const page = mountPage(view, `
    ${stepper(Math.min(S.step, 7))}
    <section class="card result-card mt-24 result-${S.tone}">
      <div class="result-ic">${icon(S.ic)}</div>
      <div class="result-pill">${pill(p.status)}</div>
      <h1 class="mt-8">${esc(S.title)}</h1>
      <p class="soft result-text">${esc(S.text)}</p>
      <dl class="kv result-kv">
        <dt>Service</dt><dd>${esc(p.service?.name || '')}</dd>
        ${p.months ? `<dt>Plan</dt><dd>${planLabel(p.months)}</dd>` : ''}
        <dt>Payment ID</dt><dd class="mono">${esc(p.id)}</dd>
        <dt>Amount</dt><dd>${inr(p.amount)}</dd>
        <dt>Discount</dt><dd>${p.discount ? `${inr(p.discount)}${p.couponCode ? ` (${esc(p.couponCode)})` : ''}` : '—'}</dd>
        <dt>Paid</dt><dd><b>${inr(p.finalAmount)}</b></dd>
        ${p.upiTxnId ? `<dt>UPI Transaction ID</dt><dd class="mono">${esc(p.upiTxnId)}</dd>` : ''}
        ${p.submittedAt ? `<dt>Submitted</dt><dd>${fmtDateTime(p.submittedAt)}</dd>` : ''}
        ${p.verifiedAt ? `<dt>Verified</dt><dd>${fmtDateTime(p.verifiedAt)}</dd>` : ''}
      </dl>
      <div class="row wrap center-row mt-24">
        ${p.status === 'rejected' && p.service ? `<a class="btn btn-primary" href="#/checkout/${p.service.id}">Try again</a>` : ''}
        ${p.status === 'verified' && p.subscriptionId ? `<a class="btn btn-primary" href="#/cards/${esc(p.subscriptionId)}">${icon('card', 'sm')} View my card</a>` : ''}
        <a class="btn ${p.status === 'pending' ? 'btn-primary' : 'btn-secondary'}" href="#/subscriptions${p.status === 'pending' ? '?tab=pending' : ''}">${icon('layers', 'sm')} My Subscriptions</a>
        <a class="btn btn-secondary" href="#/payments">${icon('wallet', 'sm')} Payments</a>
        <a class="btn btn-ghost" href="#/">Dashboard</a>
      </div>
    </section>`);
  return page;
}
