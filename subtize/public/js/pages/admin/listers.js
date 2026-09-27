/* Lister Management: every approved provider with standing and this month's numbers. */
import { api } from '../../api.js';
import { go, pageHead } from '../../shell.js';
import { $, confirmAction, debounce, esc, fmtMonth, icon, inr, toast } from '../../ui.js';
import { emptyState, statTile } from '../../components.js';
import { agreementPill, appStatusPill, loadingRow, money, mono, mount, on, run, searchBox, setQuery, table, userStatusPill } from './common.js';

export async function renderListers({ view, query }) {
  let q = query.get('q') || '';
  const [first, apps, agrs] = await Promise.all([
    api.get('/api/admin/listers', { q }),
    api.get('/api/admin/applications'),
    api.get('/api/admin/agreements'),
  ]);
  // Latest application and agreement per lister, for the links.
  const appFor = new Map();
  for (const a of apps.applications) if (!appFor.has(a.userId) || appFor.get(a.userId).id < a.id) appFor.set(a.userId, a);
  const agrFor = new Map();
  for (const a of agrs.agreements) if (!agrFor.has(a.listerId) || agrFor.get(a.listerId).id < a.id) agrFor.set(a.listerId, a);

  const month = fmtMonth(first.month);
  const totals = (rows) => rows.reduce((t, l) => ({ gross: t.gross + l.monthGross, payable: t.payable + l.monthPayable, subs: t.subs + l.subscribers }), { gross: 0, payable: 0, subs: 0 });

  const root = mount(view, `
    ${pageHead('Lister Management', `Verified providers, their agreement standing and ${esc(month)} earnings. Provider identity is internal to Subtize.ai.`, `
      <a class="btn btn-secondary" href="#/applications">${icon('fileCheck')} Applications</a>`)}
    <div class="adm-stats" data-stats></div>
    <div class="adm-toolbar mt-16">${searchBox(q, 'Search business, name, email or verification ID')}</div>
    <div data-list></div>`);

  const listEl = $('[data-list]', root);
  const draw = (rows) => {
    const t = totals(rows);
    $('[data-stats]', root).innerHTML = [
      statTile({ label: 'Listers', value: String(rows.length), ic: 'briefcase', sub: `${rows.filter((l) => l.agreementStatus === 'active').length} under active agreement` }),
      statTile({ label: 'Active subscribers', value: t.subs.toLocaleString('en-IN'), ic: 'users', sub: 'across lister services' }),
      statTile({ label: `Gross · ${month}`, value: inr(t.gross), ic: 'trend', sub: 'verified payments' }),
      statTile({ label: `Payable · ${month}`, value: inr(t.payable), ic: 'wallet', sub: 'after commission', hero: true }),
    ].join('');
    listEl.innerHTML = table([
      {
        label: 'Business',
        render: (l) => `<span class="cell-title">${esc(l.businessName || '—')}</span><div class="cell-sub"><a href="#/users/${l.id}">${esc(l.fullName)}</a> · ${esc(l.email)}</div>${l.status !== 'active' ? `<div class="mt-8">${userStatusPill(l.status)}</div>` : ''}`,
      },
      { label: 'Verification ID', render: (l) => mono(l.verificationId) },
      { label: 'Application', render: (l) => { const a = appFor.get(l.id); return a ? `<a href="#/applications/${a.id}">${appStatusPill(l.applicationStatus)}</a>` : appStatusPill(l.applicationStatus); } },
      { label: 'Agreement', render: (l) => { const a = agrFor.get(l.id); return a ? `<a href="#/agreements/${a.id}">${agreementPill(l.agreementStatus)}</a>` : agreementPill(l.agreementStatus); } },
      { label: 'Services', cls: 'right', render: (l) => `<a class="num" href="#/services?q=${encodeURIComponent(l.fullName)}">${l.services}</a>` },
      { label: 'Active subscribers', cls: 'right', render: (l) => `<span class="num">${l.subscribers}</span>` },
      { label: `Gross ${month}`, cls: 'right', render: (l) => money(l.monthGross) },
      { label: `Payable ${month}`, cls: 'right', render: (l) => `<b>${money(l.monthPayable)}</b>` },
      {
        label: '',
        cls: 'nowrap',
        render: (l) => `<div class="row adm-actions">
          ${!l.agreementStatus || l.agreementStatus === 'terminated' ? `<button type="button" class="btn btn-outline btn-sm" data-issue="${l.id}">${icon('signature', 'sm')} Issue agreement</button>` : ''}
        </div>`,
      },
    ], rows, { empty: emptyState({ ic: 'briefcase', title: 'No listers found', text: q ? 'Nothing matches that search.' : 'Approve an application to add the first lister.' }) });
  };
  draw(first.listers);

  on(root, 'input', '[data-search]', debounce(async (e) => {
    q = e.target.value.trim();
    setQuery({ q });
    listEl.innerHTML = loadingRow;
    try { draw((await api.get('/api/admin/listers', { q })).listers); } catch (err) { toast(err.message, 'bad'); }
  }, 300));

  on(root, 'click', '[data-issue]', async (e, btn) => {
    const ok = await confirmAction({ title: 'Issue a new Lister Agreement?', message: 'A fresh agreement at the current platform commission is issued for the lister to e-sign. Subtize.ai countersigns afterwards.', confirm: 'Issue agreement', tone: 'primary' });
    if (!ok) return;
    const res = await run(btn, () => api.post(`/api/admin/listers/${btn.dataset.issue}/agreement`), 'Agreement issued. Waiting for the lister to sign.');
    if (res?.agreement) go(`/agreements/${res.agreement.id}`);
  });
}
