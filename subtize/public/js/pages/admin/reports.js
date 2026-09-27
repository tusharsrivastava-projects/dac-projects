/* Reports: monthly financial report with CSV exports, the activity log and the mail outbox. */
import { api } from '../../api.js';
import { go, pageHead } from '../../shell.js';
import { $, debounce, esc, fmtAgo, fmtDate, fmtDateTime, fmtMonth, icon, inr, tonePill } from '../../ui.js';
import { emptyState, statTile } from '../../components.js';
import { card, dash, filterTabs, money, monthPicker, mount, on, orDash, table, validMonth } from './common.js';

const TABS = [{ key: 'monthly', label: 'Monthly report' }, { key: 'activity', label: 'Activity log' }, { key: 'outbox', label: 'Mail outbox' }];

export async function renderReports({ view, query }) {
  const tab = TABS.some((t) => t.key === query.get('tab')) ? query.get('tab') : 'monthly';
  if (tab === 'activity') return activity(view, query);
  if (tab === 'outbox') return outbox(view, query);
  return monthly(view, query);
}

const head = (query, tab, actions = '') => `
  ${pageHead('Reports', 'Month-end numbers for accounts, plus the audit trail and outgoing mail.', actions)}
  ${filterTabs(TABS, tab, '/reports', new URLSearchParams(query.get('month') ? { month: query.get('month') } : {}))}`;

async function monthly(view, query) {
  const month = validMonth(query.get('month'));
  const { report: r } = await api.get('/api/admin/reports/monthly', { month });
  const qs = `?month=${encodeURIComponent(month)}`;

  const root = mount(view, `
    ${head(query, 'monthly')}
    <div class="adm-toolbar">
      ${monthPicker(month)}
      <span class="muted small">${esc(fmtDate(r.period.start))} – ${esc(fmtDate(r.period.end))}</span>
      <div class="row wrap adm-push">
        <a class="btn btn-secondary btn-sm" href="/api/admin/reports/monthly.csv${qs}" download>${icon('download', 'sm')} Monthly report CSV</a>
        <a class="btn btn-secondary btn-sm" href="/api/admin/reports/payments.csv${qs}" download>${icon('download', 'sm')} Payments CSV</a>
      </div>
    </div>

    <h2 class="adm-h2">Revenue · ${esc(fmtMonth(month))}</h2>
    <div class="adm-stats five">
      ${statTile({ label: 'Gross subscriptions', value: inr(r.revenue.gross), ic: 'trend', hero: true, sub: 'verified payments' })}
      ${statTile({ label: 'Subtize.ai commission', value: inr(r.revenue.commission), ic: 'percent' })}
      ${statTile({ label: 'Lister payable', value: inr(r.revenue.listerPayable), ic: 'wallet' })}
      ${statTile({ label: 'Coupon discounts', value: inr(r.revenue.discounts), ic: 'tag', sub: 'given to members' })}
      ${statTile({ label: 'Verified payments', value: String(r.revenue.payments), ic: 'receipt' })}
    </div>

    <h2 class="adm-h2">Subscriptions and people</h2>
    <div class="adm-stats">
      ${statTile({ label: 'Activated', value: String(r.subscriptions.activated), ic: 'play' })}
      ${statTile({ label: 'Cancelled', value: String(r.subscriptions.cancelled), ic: 'ban' })}
      ${statTile({ label: 'Expired', value: String(r.subscriptions.expired), ic: 'clock' })}
      ${statTile({ label: 'Rejected payments', value: String(r.subscriptions.rejectedPayments), ic: 'x' })}
      ${statTile({ label: 'New users', value: String(r.users.newUsers), ic: 'user' })}
      ${statTile({ label: 'New listers', value: String(r.users.newListers), ic: 'briefcase', sub: 'applications approved' })}
    </div>

    <div class="stack mt-24">
      ${card(`By service (${r.services.length})`, table([
        { label: 'Service', render: (s) => `<a class="cell-title" href="#/services/${s.serviceId}">${esc(s.service)}</a><div class="cell-sub mono">${esc(s.servicePublicId)}</div>` },
        { label: 'Lister', render: (s) => (s.listerId ? `${esc(s.businessName || s.listerName)}<div class="cell-sub">${esc(s.listerName)}</div>` : '<span class="tag">Subtize.ai Direct</span>') },
        { label: 'Payments', cls: 'right', render: (s) => `<span class="num">${s.payments}</span>` },
        { label: 'Discounts', cls: 'right', render: (s) => money(s.discounts) },
        { label: 'Gross', cls: 'right', render: (s) => `<b>${money(s.gross)}</b>` },
        { label: 'Rate', cls: 'right', render: (s) => (s.listerId ? `${s.percent}%` : '100%') },
        { label: 'Commission', cls: 'right', render: (s) => money(s.listerId ? s.commission : s.gross) },
        { label: 'Lister payable', cls: 'right', render: (s) => (s.listerId ? money(s.payable) : dash) },
      ], r.services, { empty: '<p class="muted small">No verified payments this month.</p>' }), { ic: 'store' })}
      ${card(`By lister (${r.listers.length})`, table([
        { label: 'Lister', render: (l) => `<a class="cell-title" href="#/users/${l.listerId}">${esc(l.businessName || l.listerName)}</a><div class="cell-sub">${esc(l.listerName)}</div>` },
        { label: 'Payments', cls: 'right', render: (l) => `<span class="num">${l.payments}</span>` },
        { label: 'Gross', cls: 'right', render: (l) => money(l.gross) },
        { label: 'Commission', cls: 'right', render: (l) => `${money(l.commission)} <span class="cell-sub">(${l.percent}%)</span>` },
        { label: 'Payable', cls: 'right', render: (l) => `<b>${money(l.payable)}</b>` },
      ], r.listers, { empty: '<p class="muted small">No lister revenue this month.</p>' }), { ic: 'briefcase' })}
    </div>`);

  on(root, 'change', '[data-month]', (e) => go(`/reports?month=${validMonth(e.target.value)}`));
}

async function activity(view, query) {
  const { activity: rows } = await api.get('/api/admin/activity', { limit: 500 });
  const root = mount(view, `
    ${head(query, 'activity')}
    <div class="adm-toolbar"><label class="input-group adm-search">${icon('filter')}<input class="input" type="search" placeholder="Filter by actor, action, entity or detail" data-filter aria-label="Filter the activity log"></label>
      <span class="muted small" data-count></span></div>
    <div data-list></div>`);
  const listEl = $('[data-list]', root);
  const draw = (needle = '') => {
    const n = needle.toLowerCase();
    const list = n ? rows.filter((a) => [a.actor, a.action, a.entity, a.entityId, a.detail].some((x) => String(x ?? '').toLowerCase().includes(n))) : rows;
    $('[data-count]', root).textContent = `${list.length} of the latest ${rows.length} entries`;
    listEl.innerHTML = table([
      { label: 'When', render: (a) => `<span class="nowrap" title="${esc(fmtDateTime(a.at))}">${esc(fmtAgo(a.at))}</span><div class="cell-sub nowrap">${esc(fmtDateTime(a.at))}</div>` },
      { label: 'Actor', render: (a) => orDash(a.actor) },
      { label: 'Action', render: (a) => `<span class="mono small">${esc(a.action)}</span>` },
      { label: 'Entity', render: (a) => (a.entity ? `${esc(a.entity)} ${a.entityId ? `<span class="mono small muted">${esc(a.entityId)}</span>` : ''}` : dash) },
      { label: 'Detail', render: (a) => orDash(a.detail) },
    ], list, { empty: emptyState({ ic: 'activity', title: 'No matching entries' }) });
  };
  draw();
  on(root, 'input', '[data-filter]', debounce((e) => draw(e.target.value.trim()), 150));
}

async function outbox(view, query) {
  const { messages } = await api.get('/api/admin/outbox');
  mount(view, `
    ${head(query, 'outbox')}
    <div class="panel-note mb-16">${icon('info')}<div>The latest 100 emails the platform sent or tried to send. Without SMTP configured (local development) messages stay here as <b>logged</b> — including sign-up OTP codes.</div></div>
    ${messages.length ? `<div class="adm-mail">${messages.map((m) => `
      <details class="card tight">
        <summary><div class="grow"><b>${esc(m.subject)}</b><div class="small muted">To ${esc(m.to)} · ${esc(fmtDateTime(m.at))}</div></div>
          ${tonePill(m.status, m.status === 'sent' ? 'good' : m.status === 'failed' ? 'bad' : 'neutral')}</summary>
        ${m.error ? `<div class="panel-note danger mt-8">${icon('alert')}<div>${esc(m.error)}</div></div>` : ''}
        <pre class="adm-mail-body">${esc(m.body)}</pre>
      </details>`).join('')}</div>` : emptyState({ ic: 'mail', title: 'No mail yet', text: 'Sign-up codes, receipts and notices appear here.' })}`);
}
