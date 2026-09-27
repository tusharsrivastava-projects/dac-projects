/* User Management: search, profile, status/role actions, subscriptions and payments. */
import { api } from '../../api.js';
import { go, pageHead } from '../../shell.js';
import { $, confirmAction, debounce, esc, fmtAgo, fmtDate, fmtDateTime, icon, initials, inr, pill, toast } from '../../ui.js';
import { emptyState, usageMeter } from '../../components.js';
import {
  agreementPill, appStatusPill, card, dash, hrefWith, kv, loadingRow, money, mono, mount, on, orDash, planLabel, rolePill, run, searchBox, setQuery,
  table, userStatusPill, yesNo,
} from './common.js';

const STATUSES = [['', 'Any status'], ['active', 'Active'], ['inactive', 'Inactive'], ['suspended', 'Suspended'], ['banned', 'Banned']];
const ROLES = [['', 'Any role'], ['user', 'Members'], ['lister', 'Listers'], ['admin', 'Admins']];

export async function renderUsers({ view, query }) {
  let q = query.get('q') || '';
  const status = query.get('status') || '';
  const role = query.get('role') || '';
  const params = () => ({ q, status, role });
  const first = await api.get('/api/admin/users', params());

  const root = mount(view, `
    ${pageHead('User Management', 'Search by name, email, phone, user ID or subscription ID.')}
    <div class="adm-toolbar">
      ${searchBox(q, 'Name, email, phone, user ID or subscription ID')}
      <label class="adm-filter"><span class="sr-only">Status</span><select class="select" data-filter="status">${STATUSES.map(([v, l]) => `<option value="${v}" ${v === status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="adm-filter"><span class="sr-only">Role</span><select class="select" data-filter="role">${ROLES.map(([v, l]) => `<option value="${v}" ${v === role ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div data-list></div>`);

  const listEl = $('[data-list]', root);
  const draw = (users) => {
    listEl.innerHTML = `<p class="muted small mb-8">${users.length === 200 ? 'Showing the newest 200 — refine the search to narrow down.' : `${users.length} user${users.length === 1 ? '' : 's'}`}</p>${table([
      { label: 'Name', render: (u) => `<div class="row adm-person"><span class="avatar sm">${esc(initials(u.fullName))}</span><a class="cell-title" href="#/users/${u.id}">${esc(u.fullName)}</a></div>` },
      { label: 'Email', render: (u) => `${esc(u.email)}${u.emailVerified ? '' : ' <span class="cell-sub">(unverified)</span>'}` },
      { label: 'Phone', render: (u) => orDash(u.phone) },
      { label: 'User ID', render: (u) => mono(u.publicId) },
      { label: 'Role', render: (u) => rolePill(u.role) },
      { label: 'Status', render: (u) => userStatusPill(u.status) },
      { label: 'Active subs', cls: 'right', render: (u) => `<span class="num">${u.activeSubscriptions ?? 0}</span>` },
      { label: 'Total spent', cls: 'right', render: (u) => money(u.totalSpent) },
      { label: 'Joined', render: (u) => `<span title="${esc(fmtDateTime(u.createdAt))}">${esc(fmtDate(u.createdAt))}</span>` },
    ], users, {
      rowAttrs: (u) => `class="clickable" data-href="#/users/${u.id}"`,
      empty: emptyState({ ic: 'users', title: 'No users found', text: 'Try a different name, email, phone or ID.' }),
    })}`;
  };
  draw(first.users);

  on(root, 'input', '[data-search]', debounce(async (e) => {
    q = e.target.value.trim();
    setQuery({ q });
    listEl.innerHTML = loadingRow;
    try { draw((await api.get('/api/admin/users', params())).users); } catch (err) { toast(err.message, 'bad'); }
  }, 300));
  on(root, 'change', '[data-filter]', (e, sel) => { location.hash = hrefWith('/users', query, { [sel.dataset.filter]: sel.value, q }).slice(1); });
  on(root, 'click', 'tr[data-href]', (e, tr) => { if (!e.target.closest('a, button')) location.hash = tr.dataset.href.slice(1); });
}

/* ── Detail ────────────────────────────────────────────────────────────── */

export async function renderUserDetail({ view, params, ctx }) {
  const data = await api.get(`/api/admin/users/${params.id}`);
  const u = data.user;
  const self = u.id === ctx.user.id;
  const isAdmin = u.role === 'admin';

  const actions = isAdmin ? '' : `
    ${u.status !== 'active' ? `<button type="button" class="btn btn-primary btn-sm" data-act="activate">${icon('play', 'sm')} Activate</button>` : ''}
    ${u.status === 'active' ? `<button type="button" class="btn btn-secondary btn-sm" data-act="deactivate">${icon('pause', 'sm')} Deactivate</button>` : ''}
    ${u.status !== 'suspended' ? `<button type="button" class="btn btn-danger-outline btn-sm" data-act="suspend">${icon('alert', 'sm')} Suspend</button>` : ''}
    ${u.status !== 'banned' ? `<button type="button" class="btn btn-danger-outline btn-sm" data-act="ban">${icon('ban', 'sm')} Ban</button>` : ''}
    ${u.role === 'user' ? `<button type="button" class="btn btn-outline btn-sm" data-act="lister-on">${icon('briefcase', 'sm')} Assign Lister role</button>` : ''}
    ${u.role === 'lister' ? `<button type="button" class="btn btn-danger-outline btn-sm" data-act="lister-off">${icon('minus', 'sm')} Remove Lister role</button>` : ''}`;

  const subCols = [
    { label: 'Subscription', render: (s) => `<a class="mono" href="#/subscriptions/${esc(s.id)}">${esc(s.id)}</a>` },
    { label: 'Service', render: (s) => `<a href="#/services/${s.service.id}">${esc(s.service.name)}</a>` },
    { label: 'Plan', render: (s) => esc(planLabel(s.months)) },
    { label: 'Status', render: (s) => pill(s.status) },
    { label: 'Period', render: (s) => (s.startDate ? `${esc(fmtDate(s.startDate))} – ${esc(fmtDate(s.endDate))}` : dash) },
    { label: 'Days left', cls: 'right', render: (s) => (s.status === 'active' ? `<span class="num">${s.remainingDays}</span>` : dash) },
    { label: 'Usage', render: (s) => (s.usage ? `<div class="adm-meter">${usageMeter(s.usage)}</div>` : dash) },
    {
      label: '',
      cls: 'nowrap',
      render: (s) => (['cancelled', 'expired', 'rejected'].includes(s.status) ? (s.cancelReason ? `<span class="cell-sub adm-clamp" title="${esc(s.cancelReason)}">${esc(s.cancelReason)}</span>` : '')
        : `<button type="button" class="btn btn-danger-outline btn-sm" data-cancel="${esc(s.id)}">Cancel</button>`),
    },
  ];

  const payCols = [
    { label: 'Payment', render: (p) => `${mono(p.id)}<div class="cell-sub">${esc(fmtDateTime(p.createdAt))}</div>` },
    { label: 'Service', render: (p) => esc(p.service) },
    { label: 'Amount', cls: 'right', render: (p) => money(p.amount) },
    { label: 'Coupon', render: (p) => (p.couponCode ? `<span class="tag mono">${esc(p.couponCode)}</span> <span class="cell-sub">−${esc(inr(p.discount))}</span>` : dash) },
    { label: 'Final', cls: 'right', render: (p) => `<b>${money(p.finalAmount)}</b>` },
    { label: 'UTR', render: (p) => mono(p.upiTxnId) },
    { label: 'Status', render: (p) => `${pill(p.status)}${p.rejectionReason ? `<div class="cell-sub">${esc(p.rejectionReason)}</div>` : ''}` },
    { label: 'Verified by', render: (p) => (p.verifier ? `${esc(p.verifier)}<div class="cell-sub">${esc(fmtDateTime(p.verifiedAt))}</div>` : dash) },
  ];

  const l = data.lister;
  const root = mount(view, `
    <a class="btn btn-ghost btn-sm adm-back" href="#/users">${icon('back', 'sm')} Users</a>
    <div class="adm-profile-head card">
      <div class="avatar lg">${u.avatarUrl ? `<img src="${esc(u.avatarUrl)}" alt="">` : esc(initials(u.fullName))}</div>
      <div class="grow">
        <h1>${esc(u.fullName)}</h1>
        <div class="row wrap mt-8">${rolePill(u.role)} ${userStatusPill(u.status)} <span class="mono small muted">${esc(u.publicId)}</span></div>
        ${u.statusReason ? `<div class="panel-note warn mt-16">${icon('alert')}<div><b>Status reason:</b> ${esc(u.statusReason)}</div></div>` : ''}
      </div>
      <div class="row wrap adm-profile-actions">${actions}</div>
    </div>
    ${isAdmin ? `<div class="panel-note mt-16">${icon('info')}<div>${self ? 'This is your own account.' : 'Admin accounts'} are managed separately; status and role changes are not available here.</div></div>` : ''}

    <div class="grid cols-2 mt-16 adm-top-grid">
        ${card('Profile', kv([
          ['User ID', mono(u.publicId)],
          ['Internal ID', `<span class="num">${u.id}</span>`],
          ['Email', `${esc(u.email)} ${u.emailVerified ? '<span class="pill tone-good plain">verified</span>' : '<span class="pill tone-warn plain">unverified</span>'}`],
          ['Phone', orDash(u.phone)],
          ['City', orDash(u.city)],
          ['Preferred area', orDash(u.preferredArea)],
          ['Address', orDash(u.address)],
          ['UPI ID', mono(u.upiId)],
          ['Payment note', orDash(u.paymentNote)],
          ['Referral code', mono(u.referralCode)],
          ['Referred by', orDash(u.referredBy)],
          ['Joined', esc(fmtDateTime(u.createdAt))],
          ['Last sign-in', u.lastLoginAt ? `${esc(fmtAgo(u.lastLoginAt))} <span class="cell-sub">(${esc(fmtDateTime(u.lastLoginAt))})</span>` : 'Never'],
        ]), { ic: 'user' })}
        ${data.application || l ? card('Lister', `${kv([
          data.application ? ['Application', `<a href="#/applications/${data.application.id}">${esc(data.application.businessName)}</a> <span class="mono small muted">${esc(data.application.publicId)}</span>`] : null,
          data.application ? ['Application status', appStatusPill(data.application.status)] : null,
          l ? ['Verified', yesNo(l.verified)] : null,
          l ? ['Verification ID', mono(l.verificationId)] : null,
          l ? ['Agreement', `${agreementPill(l.agreementStatus)} ${l.agreementId ? `<span class="mono small muted">${esc(l.agreementId)}</span>` : ''}`] : null,
          l ? ['Can publish', yesNo(l.canPublish)] : null,
        ])}${u.role === 'lister' ? `<div class="row wrap mt-16"><a class="btn btn-secondary btn-sm" href="#/services?q=${encodeURIComponent(u.fullName)}">Their services</a><a class="btn btn-secondary btn-sm" href="#/listers?q=${encodeURIComponent(u.email)}">Lister record</a></div>` : ''}`, { ic: 'briefcase' }) : ''}
    </div>
    <div class="stack mt-16">
        ${card(`Subscriptions (${data.subscriptions.length})`, table(subCols, data.subscriptions, { empty: '<p class="muted small">No subscriptions.</p>' }), { ic: 'layers' })}
        ${card(`Payment history (${data.payments.length})`, table(payCols, data.payments, { empty: '<p class="muted small">No payments.</p>' }), { ic: 'receipt' })}
        ${card('Activity', data.activity.length ? `<ol class="adm-timeline">${data.activity.map((a) => `<li><div><b>${esc(a.action.replace(/[._]/g, ' '))}</b>${a.detail ? ` <span class="soft">— ${esc(a.detail)}</span>` : ''}</div>
          <div class="small muted">${esc(a.actor || 'System')} · ${esc(fmtDateTime(a.at))}</div></li>`).join('')}</ol>` : '<p class="muted small">No recorded activity.</p>', { ic: 'activity' })}
    </div>
    </div>`);

  const reload = () => go(`/users/${u.id}`);
  const setStatus = (status, reason) => api.post(`/api/admin/users/${u.id}/status`, { status, reason });

  on(root, 'click', '[data-act]', async (e, btn) => {
    const act = btn.dataset.act;
    const name = `<b>${esc(u.fullName)}</b>`;
    let done = null;
    if (act === 'activate') {
      if (!(await confirmAction({ title: 'Activate this account?', message: `${name} will be able to sign in and use Subtize.ai again.`, confirm: 'Activate', tone: 'primary' }))) return;
      done = await run(btn, () => setStatus('active'), 'Account activated.');
    } else if (act === 'deactivate') {
      const reason = await confirmAction({ title: 'Deactivate this account?', message: `${name} is signed out and cannot sign in until reactivated.`, confirm: 'Deactivate', reason: true });
      if (reason === null) return;
      done = await run(btn, () => setStatus('inactive', reason), 'Account deactivated.');
    } else if (act === 'suspend') {
      const reason = await confirmAction({ title: 'Suspend this account?', message: `${name} is signed out immediately and cannot sign in.${u.role === 'lister' ? ' Their active services are taken off the catalogue.' : ''}`, confirm: 'Suspend', reason: true, reasonLabel: 'Reason (recorded and shown to the user)' });
      if (reason === null) return;
      done = await run(btn, () => setStatus('suspended', reason), 'Account suspended.');
    } else if (act === 'ban') {
      const reason = await confirmAction({ title: 'Ban this account?', message: `${name} is permanently blocked from signing in.${u.role === 'lister' ? ' Their active services are taken off the catalogue.' : ''} Existing subscriptions are not cancelled automatically.`, confirm: 'Ban account', reason: true, typeToConfirm: 'BAN' });
      if (reason === null) return;
      done = await run(btn, () => setStatus('banned', reason), 'Account banned.');
    } else if (act === 'lister-on') {
      if (!(await confirmAction({ title: 'Assign the Lister role?', message: `${name} moves to the lister dashboard and is issued a Lister Agreement to sign. They are signed out so the new role applies. Their services still need verification and a countersigned agreement before going live.`, confirm: 'Assign Lister role', tone: 'primary' }))) return;
      done = await run(btn, () => api.post(`/api/admin/users/${u.id}/role`, { role: 'lister' }), 'Lister role assigned. An agreement is waiting for their signature.');
    } else if (act === 'lister-off') {
      if (!(await confirmAction({ title: 'Remove the Lister role?', message: `${name} becomes a regular member. <b>All their active services are deactivated and their Lister Agreement is terminated.</b>`, confirm: 'Remove Lister role', typeToConfirm: 'REMOVE' }))) return;
      done = await run(btn, () => api.post(`/api/admin/users/${u.id}/role`, { role: 'user' }), 'Lister role removed.');
    }
    if (done) reload();
  });

  on(root, 'click', '[data-cancel]', async (e, btn) => {
    const subId = btn.dataset.cancel;
    const reason = await confirmAction({ title: 'Cancel this subscription?', message: `<b class="mono">${esc(subId)}</b> for ${esc(u.fullName)} ends now. Any unverified payment on it is rejected. The member is notified with your reason.`, confirm: 'Cancel subscription', reason: true, reasonLabel: 'Reason shown to the member' });
    if (reason === null) return;
    const ok = await run(btn, () => api.post(`/api/admin/users/${u.id}/subscriptions/${encodeURIComponent(subId)}/cancel`, { reason }), 'Subscription cancelled.');
    if (ok) reload();
  });
}
