/* #/coupons — live public coupons with copy and "use". */
import { api } from '../../api.js';
import { emptyState } from '../../components.js';
import { pageHead } from '../../shell.js';
import { copyText, esc, fmtDate, icon, inr } from '../../ui.js';
import { mountPage } from './common.js';

function couponCard(c) {
  const useHref = c.service ? `#/checkout/${c.service.id}?coupon=${encodeURIComponent(c.code)}` : `#/explore?coupon=${encodeURIComponent(c.code)}`;
  return `
  <article class="card coupon-card">
    <div class="coupon-top">
      <div class="coupon-label">${esc(c.label)}</div>
      <button type="button" class="coupon-code" data-copy="${esc(c.code)}" aria-label="Copy coupon code ${esc(c.code)}"><span class="mono">${esc(c.code)}</span>${icon('copy', 'sm')}</button>
    </div>
    <p class="soft" style="margin:12px 0 14px">${esc(c.description || '')}</p>
    <dl class="kv small">
      <dt>Applies to</dt><dd>${c.service ? `<a href="#/services/${c.service.id}">${esc(c.service.name)}</a>` : 'Any service'}</dd>
      <dt>Minimum order</dt><dd>${c.minValue ? inr(c.minValue) : 'None'}</dd>
      ${c.maxDiscount ? `<dt>Maximum discount</dt><dd>${inr(c.maxDiscount)}</dd>` : ''}
      <dt>Valid till</dt><dd>${fmtDate(c.expiresOn)}</dd>
      <dt>Uses left</dt><dd>${c.remaining == null ? 'Unlimited' : c.remaining}</dd>
    </dl>
    <div class="row wrap mt-16" style="--gap:8px;margin-top:auto;padding-top:16px">
      ${c.canUse === false
        ? `<span class="pill tone-neutral grow" style="justify-content:center;height:34px">${icon('check', 'sm')} You've used this coupon</span>`
        : `<a class="btn btn-primary btn-sm grow" href="${useHref}">${icon('zap', 'sm')} Use ${c.service ? 'now' : 'on a service'}</a>`}
      <button type="button" class="btn btn-secondary btn-sm" data-copy="${esc(c.code)}">${icon('copy', 'sm')} Copy</button>
    </div>
  </article>`;
}

export async function renderCoupons({ view, isCurrent }) {
  const { coupons } = await api.get('/api/coupons');
  if (!isCurrent()) return;
  const page = mountPage(view, `
    ${pageHead('Coupons', 'Apply a code at checkout to lower what you pay. One use per coupon per member unless stated.')}
    ${coupons.length ? `<div class="grid auto" style="--min:290px">${coupons.map(couponCard).join('')}</div>`
    : emptyState({ ic: 'ticket', title: 'No coupons right now', text: 'New offers appear here as soon as they go live.' })}`);
  page.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) copyText(c.dataset.copy, `Coupon ${c.dataset.copy} copied`);
  });
}
