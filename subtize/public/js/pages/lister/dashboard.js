/* #/ — the lister's business at a glance. */
import { api } from '../../api.js';
import { revenueChart, statTile, emptyState } from '../../components.js';
import { pageHead } from '../../shell.js';
import { $, esc, fmtAgo, fmtMonth, icon, initials, inr, pill } from '../../ui.js';
import { formulaHtml, setStanding, state } from './common.js';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

const RECENT_TEXT = { active: 'subscribed to', cancelled: 'cancelled', expired: 'plan ended for' };
const RECENT_TONE = { active: 'good', cancelled: 'bad', expired: 'neutral' };

export async function renderDashboard({ view, isCurrent }) {
  const data = await api.get('/api/lister/overview');
  if (!isCurrent()) return;
  setStanding(data.standing);
  const m = data.metrics;
  const st = data.standing;
  const pct = m.commissionPercent ?? state.commission;
  const monthLabel = fmtMonth(data.month);
  const firstName = (state.user.fullName || '').split(' ')[0];

  view.innerHTML = `
    ${pageHead(`${greeting()}, ${firstName}`, `Your business on Subtize.ai for <b>${esc(monthLabel)}</b>.`,
      `<a class="btn btn-secondary" href="#/checkin">${icon('qr', 'sm')} Check in a member</a>
       <a class="btn btn-primary" href="#/services">${icon('layers', 'sm')} My services</a>`)}

    <section class="lister-money-row">
      ${statTile({ label: 'Monthly gross subscription revenue', value: inr(m.gross), sub: `${esc(monthLabel)} · verified payments`, ic: 'trend' })}
      ${statTile({ label: `${pct}% Subtize.ai platform commission`, value: inr(m.commission), sub: 'Retained by Subtize.ai', ic: 'percent' })}
      ${statTile({ label: 'Estimated payable amount', value: inr(m.payable), sub: `Your ${100 - pct}% for ${esc(monthLabel)}`, ic: 'wallet', hero: true })}
      <div class="stat">
        <div class="stat-label">${icon('receipt')}Settlement status</div>
        <div class="stat-value stat-pill">${pill(m.settlementStatus)}</div>
        <div class="stat-sub"><a href="#/settlements">Settlement history</a></div>
      </div>
    </section>

    <div class="card mt-16">
      <div class="card-head"><h3>${icon('scale')} How your payout is worked out</h3><a class="btn btn-ghost btn-sm" href="#/revenue">Revenue details ${icon('arrowRight', 'sm')}</a></div>
      ${formulaHtml({ gross: m.gross, commission: m.commission, payable: m.payable, percent: pct, monthLabel })}
    </div>

    <h2 class="lister-h2">Subscribers</h2>
    <section class="stats lister-stats">
      ${statTile({ label: 'Total subscribers', value: m.totalSubscribers.toLocaleString('en-IN'), sub: 'All time, unique members', ic: 'users' })}
      ${statTile({ label: 'Current month subscribers', value: m.currentMonthSubscribers.toLocaleString('en-IN'), sub: `Plans running in ${esc(monthLabel)}`, ic: 'calendar' })}
      ${statTile({ label: 'Active subscriptions', value: m.activeSubscriptions.toLocaleString('en-IN'), sub: 'Valid today', ic: 'checkCircle' })}
      ${statTile({ label: 'New subscriptions', value: m.newSubscriptions.toLocaleString('en-IN'), sub: `Activated in ${esc(monthLabel)}`, ic: 'plus' })}
      ${statTile({ label: 'Cancellations', value: m.cancellations.toLocaleString('en-IN'), sub: `<a href="#/cancellations">In ${esc(monthLabel)}</a>`, ic: 'ban' })}
      ${statTile({ label: 'Services live', value: `${m.activeServices} / ${m.services}`, sub: `<a href="#/services">${m.services - m.activeServices} not live</a>`, ic: 'layers' })}
    </section>

    <div class="split mt-24 lister-dash-split">
      <div class="stack" style="--gap:20px">
      <div class="card">
        <div class="card-head"><h3>${icon('chart')} Revenue, last ${data.trend.length} months</h3><span class="muted small">Gross = your payout + commission</span></div>
        <div id="dash-chart"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${icon('activity')} Recent subscriber activity</h3><a class="btn btn-ghost btn-sm" href="#/subscribers">All subscribers ${icon('arrowRight', 'sm')}</a></div>
        ${data.recent.length ? `<ul class="activity-list">${data.recent.map((r) => `
          <li>
            <div class="avatar sm-avatar" aria-hidden="true">${esc(initials(r.subscriber))}</div>
            <div class="grow">
              <div><b>${esc(r.subscriber)}</b> <span class="soft">${RECENT_TEXT[r.status] || esc(r.status)}</span> <b>${esc(r.service)}</b></div>
              <div class="small muted"><span class="mono">${esc(r.id)}</span> · ${esc(fmtAgo(r.at))}</div>
            </div>
            <span class="pill tone-${RECENT_TONE[r.status] || 'neutral'}">${esc(r.status === 'active' ? 'New' : r.status === 'cancelled' ? 'Cancelled' : 'Ended')}</span>
          </li>`).join('')}</ul>`
          : emptyState({ ic: 'users', title: 'No subscribers yet', text: 'When members subscribe to your services, they show up here.' })}
      </div>
      </div>
      <div class="stack" style="--gap:20px">
        <div class="card">
          <div class="card-head"><h3>${icon('shield')} Account standing</h3></div>
          <dl class="kv">
            <dt>Verification ID</dt><dd class="mono">${esc(st.verificationId || '—')}</dd>
            <dt>Verification</dt><dd>${st.verified ? pill('approved', 'Verified') : pill(st.applicationStatus || 'pending')}</dd>
            <dt>Agreement ID</dt><dd class="mono">${esc(st.agreementId || '—')}</dd>
            <dt>Agreement</dt><dd>${st.agreementStatus ? pill(st.agreementStatus) : pill('draft', 'Not issued')}</dd>
            <dt>Commission</dt><dd>${pct}% platform · ${100 - pct}% to you</dd>
          </dl>
          <a class="btn btn-secondary btn-sm btn-block mt-16" href="#/agreement">${icon('file', 'sm')} View agreement</a>
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon('zap')} Quick actions</h3></div>
          <div class="quick-links">
            <a href="#/checkin">${icon('qr')}<span>Check in a member<small>Scan or type their card</small></span>${icon('chevron', 'sm')}</a>
            <a href="#/services">${icon('plus')}<span>Add or edit a service<small>Description, days, photos</small></span>${icon('chevron', 'sm')}</a>
            <a href="#/subscribers">${icon('download')}<span>Export subscribers<small>CSV for this month</small></span>${icon('chevron', 'sm')}</a>
          </div>
        </div>
      </div>
    </div>`;

  const chartHost = $('#dash-chart', view);
  if (data.trend.some((r) => r.gross > 0)) {
    revenueChart(chartHost, data.trend.map((r) => ({ month: r.month, gross: r.gross, commission: r.gross - r.payable, payable: r.payable })),
      { payoutLabel: 'Your payout', commissionLabel: `Subtize.ai commission (${pct}%)` });
  } else {
    chartHost.innerHTML = emptyState({ ic: 'chart', title: 'No revenue yet', text: 'Revenue appears here once members pay for your services.' });
  }
}
