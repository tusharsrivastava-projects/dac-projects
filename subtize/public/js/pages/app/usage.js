/* #/usage — allowance, usage and period for every active or expired plan. */
import { api } from '../../api.js';
import { emptyState, periodMeter, usageMeter, usageRing } from '../../components.js';
import { pageHead } from '../../shell.js';
import { esc, fmtDate, icon } from '../../ui.js';
import { catTile, dayStrip, fmtLogStamp, mountPage, planLabel, subPill } from './common.js';

function usageCard(s) {
  const u = s.usage;
  const svc = s.service;
  return `
  <article class="card usage-card">
    <div class="row between wrap mb-16" style="--gap:10px">
      <div class="row" style="--gap:12px">${catTile(svc.category.icon, 'sm')}
        <div><a class="sub-title" href="#/subscriptions/${esc(s.id)}">${esc(svc.name)}</a><div class="muted small">${esc(svc.category.name)} · ${planLabel(s.months)}</div></div></div>
      ${subPill(s)}
    </div>
    <div class="usage-top">
      ${usageRing(u, 120)}
      <div class="grow stack" style="--gap:12px">
        <div class="usage-nums">
          <div><span class="label">Allowed</span><b class="num">${u.allowed == null ? '<span class="unl">Unlimited</span>' : u.allowed}</b><span class="muted small">${esc(u.unit)} / month</span></div>
          <div><span class="label">Used</span><b class="num">${u.used}</b><span class="muted small">this cycle</span></div>
          <div><span class="label">Remaining</span><b class="num">${u.allowed == null ? '∞' : u.remaining}</b><span class="muted small">${esc(u.unit)}</span></div>
        </div>
        ${usageMeter(u)}
        ${s.status === 'active' ? periodMeter(s) : ''}
      </div>
    </div>
    <div class="divider"></div>
    <dl class="kv">
      <dt>Subscription period</dt><dd>${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}</dd>
      <dt>Current cycle</dt><dd>${u.cycleStart ? `${fmtDate(u.cycleStart)} – ${fmtDate(u.cycleEnd)}` : '—'}</dd>
      <dt>Expiry date</dt><dd>${fmtDate(s.endDate)}${s.status === 'active' ? ` <span class="muted">(${s.remainingDays} days left)</span>` : ''}</dd>
      <dt>Available days</dt><dd>${dayStrip(svc.availableDays)}${svc.hours ? `<div class="muted small mt-8">${esc(svc.hours)}</div>` : ''}</dd>
      <dt>Restrictions</dt><dd class="soft">${esc(svc.restrictions || 'None')}</dd>
      <dt>Service rules</dt><dd class="soft">${esc(svc.rules || 'None')}</dd>
    </dl>
    <details class="usage-log mt-16">
      <summary>${icon('activity', 'sm')} Recent usage <span class="muted">(${u.log.length})</span></summary>
      ${u.log.length ? `<ul class="log-list">${u.log.slice(0, 8).map((l) => `<li><span>${fmtLogStamp(l.logged_at)}</span><span class="num">${l.units} ${esc(u.unit)}</span>${l.note ? `<span class="muted small">${esc(l.note)}</span>` : ''}</li>`).join('')}</ul>`
    : '<p class="muted small mt-8" style="margin-bottom:0">Nothing recorded yet. Show your card at the counter and each use appears here.</p>'}
    </details>
  </article>`;
}

export async function renderUsage({ view, isCurrent }) {
  const { subscriptions } = await api.get('/api/me/usage');
  if (!isCurrent()) return;
  const live = subscriptions.filter((s) => s.status === 'active');
  const past = subscriptions.filter((s) => s.status !== 'active');
  mountPage(view, `
    ${pageHead('Usage', 'How much of each plan you have used this month. Allowances reset every month.')}
    ${subscriptions.length ? `
      ${live.length ? `<h2 class="mb-16">Active plans</h2><div class="grid cols-2 usage-grid">${live.map(usageCard).join('')}</div>` : ''}
      ${past.length ? `<h2 class="mb-16 ${live.length ? 'mt-32' : ''}">Past plans</h2><div class="grid cols-2 usage-grid">${past.map(usageCard).join('')}</div>` : ''}`
    : emptyState({ ic: 'gauge', title: 'No usage to show yet', text: 'Once a subscription is active, every visit, delivery or session logged against it shows up here.', action: '<a class="btn btn-primary" href="#/explore">Explore services</a>' })}`);
}
