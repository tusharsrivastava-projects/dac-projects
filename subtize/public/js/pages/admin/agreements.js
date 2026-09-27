/* Lister Agreements: list, bilingual reading view, countersign, terminate, reissue. */
import { api } from '../../api.js';
import { go, pageHead } from '../../shell.js';
import { $, $$, confirmAction, esc, fmtAgo, fmtDate, fmtDateTime, icon, pill, toast } from '../../ui.js';
import { emptyState } from '../../components.js';
import { card, dash, filterTabs, kv, mono, mount, on, run, scheduleBadgeRefresh, table } from './common.js';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending_admin', label: 'To countersign' },
  { key: 'pending_lister', label: 'Awaiting lister' },
  { key: 'active', label: 'Active' },
  { key: 'terminated', label: 'Terminated' },
];

export async function renderAgreements({ view, query }) {
  const tab = TABS.some((t) => t.key === query.get('tab')) ? query.get('tab') : 'all';
  const { agreements: all } = await api.get('/api/admin/agreements');
  const counts = { all: all.length };
  for (const a of all) counts[a.status] = (counts[a.status] || 0) + 1;
  const rows = tab === 'all' ? all : all.filter((a) => a.status === tab);

  mount(view, `
    ${pageHead('Agreements', 'Every lister signs the Lister Agreement electronically; Subtize.ai countersigns to make it active. Services can only go live under an active agreement.')}
    ${filterTabs(TABS.map((t) => ({ ...t, count: counts[t.key] || 0 })), tab, '/agreements', query)}
    ${table([
      { label: 'Agreement', render: (a) => `<a class="mono cell-title" href="#/agreements/${a.id}">${esc(a.agreementId)}</a><div class="cell-sub">v${esc(a.version)} · issued ${esc(fmtDate(a.createdAt))}</div>` },
      { label: 'Lister', render: (a) => `<span class="cell-title">${esc(a.business || '—')}</span><div class="cell-sub"><a href="#/users/${a.listerId}">${esc(a.listerName)}</a></div>` },
      { label: 'Verification ID', render: (a) => mono(a.verificationId) },
      { label: 'Commission', cls: 'right', render: (a) => `<span class="num">${a.commission}%</span>` },
      { label: 'Status', render: (a) => pill(a.status) },
      { label: 'Lister signed', render: (a) => (a.listerSignedAt ? `${esc(a.listerSignedName)}<div class="cell-sub">${esc(fmtDateTime(a.listerSignedAt))}</div>` : dash) },
      { label: 'Subtize.ai signed', render: (a) => (a.adminSignedAt ? `${esc(a.adminSignedName)}<div class="cell-sub">${esc(fmtDateTime(a.adminSignedAt))}</div>` : dash) },
      { label: '', cls: 'nowrap', render: (a) => (a.status === 'pending_admin' ? `<a class="btn btn-primary btn-sm" href="#/agreements/${a.id}">${icon('signature', 'sm')} Countersign</a>` : `<a class="btn btn-ghost btn-sm" href="#/agreements/${a.id}">Open</a>`) },
    ], rows, { empty: emptyState({ ic: 'signature', title: 'No agreements here', text: 'Agreements are issued when an application is approved.' }) })}`);
}

export async function renderAgreement({ view, params, query, ctx }) {
  const { agreement: a } = await api.get(`/api/admin/agreements/${params.id}`);
  const lang = query.get('lang') === 'hi' ? 'hi' : 'en';

  const status = {
    pending_lister: ['warn', 'clock', 'Waiting for the lister to read and e-sign this agreement.'],
    pending_admin: ['warn', 'signature', `Signed by ${a.listerSignedName} ${fmtAgo(a.listerSignedAt)}. Review it and countersign as Subtize.ai to make it active.`],
    active: ['good', 'shield', `Active since ${fmtDateTime(a.adminSignedAt)}. The lister can publish services.`],
    terminated: ['danger', 'ban', `Terminated ${fmtDateTime(a.terminatedAt)}. The lister's services were taken off the catalogue.`],
  }[a.status];

  const sectionsHtml = (l) => a.sections[l].map((s, i) => `<section class="adm-clause"><h4>${i + 1}. ${esc(s.heading)}</h4><p>${esc(s.body)}</p></section>`).join('');

  const root = mount(view, `
    <a class="btn btn-ghost btn-sm adm-back" href="#/agreements">${icon('back', 'sm')} Agreements</a>
    ${pageHead(`Lister Agreement ${a.agreementId}`, `${esc(a.business || a.listerName)} · ${pill(a.status)}`, `
      <a class="btn btn-secondary" href="/api/admin/agreements/${a.id}/download" download>${icon('download')} Download</a>
      ${a.status !== 'terminated' ? `<button type="button" class="btn btn-danger-outline" data-act="terminate">${icon('ban')} Terminate</button>` : `<button type="button" class="btn btn-primary" data-act="reissue">${icon('refresh')} Issue a new agreement</button>`}`)}
    <div class="panel-note ${status[0]} mb-16">${icon(status[1])}<div>${esc(status[2])}</div></div>

    <div class="adm-split">
      <section class="card adm-doc">
        <div class="card-head"><h3><span class="icon-tile sm">${icon('file')}</span>Agreement text</h3>
          <div class="segmented" role="tablist" aria-label="Language">
            <button type="button" role="tab" data-lang="en" class="${lang === 'en' ? 'active' : ''}" aria-selected="${lang === 'en'}">English</button>
            <button type="button" role="tab" data-lang="hi" class="hi ${lang === 'hi' ? 'active' : ''}" aria-selected="${lang === 'hi'}">हिंदी</button>
          </div></div>
        <div data-sections="en" ${lang === 'en' ? '' : 'hidden'}>${sectionsHtml('en')}</div>
        <div data-sections="hi" class="hi" lang="hi" ${lang === 'hi' ? '' : 'hidden'}>${sectionsHtml('hi')}</div>
        <p class="small muted mt-16">If the English and Hindi texts differ, the English text prevails.</p>
      </section>

      <div class="stack adm-sticky">
        ${card('Details', kv([
          ['Agreement ID', mono(a.agreementId)],
          ['Verification ID', mono(a.verificationId)],
          ['Lister', `<a href="#/users/${a.listerId}">${esc(a.listerName)}</a>`],
          ['Business', esc(a.business || '—')],
          ['Commission', `<b>${a.commission}%</b> to Subtize.ai · ${100 - a.commission}% to the lister`],
          ['Version', esc(a.version)],
          ['Issued', esc(fmtDateTime(a.createdAt))],
        ]), { ic: 'info' })}
        <section class="card">
          <div class="card-head"><h3><span class="icon-tile sm">${icon('signature')}</span>Signatures</h3></div>
          <div class="adm-sig">
            <div class="eyebrow">Lister</div>
            ${a.listerSignature ? `<div class="adm-sig-img"><img src="${esc(a.listerSignature)}" alt="Lister's signature"></div>` : '<div class="adm-sig-empty">Not signed yet</div>'}
            ${a.listerSignedAt ? `<div><b>${esc(a.listerSignedName)}</b></div><div class="small muted">${esc(fmtDateTime(a.listerSignedAt))}</div>` : ''}
          </div>
          <div class="adm-sig mt-16">
            <div class="eyebrow">For Subtize.ai</div>
            ${a.adminSignedAt ? `<div class="adm-sig-typed">${esc(a.adminSignedName)}</div><div class="small muted">${esc(fmtDateTime(a.adminSignedAt))}</div>`
              : a.status === 'pending_admin' ? `<form class="stack" style="--gap:10px" data-countersign novalidate>
                  <div class="field"><label for="cs-name">Signatory name</label><input id="cs-name" class="input" name="signedName" value="${esc(ctx.user.fullName)}" minlength="2" maxlength="120" autocomplete="name"></div>
                  <p class="small muted">Typing your name and countersigning is a binding electronic signature on behalf of Subtize.ai.</p>
                  <button type="submit" class="btn btn-primary btn-block">${icon('signature')} Countersign as Subtize.ai</button>
                </form>`
              : `<div class="adm-sig-empty">${a.status === 'pending_lister' ? 'Available after the lister signs' : 'Not signed'}</div>`}
          </div>
        </section>
      </div>
    </div>`);

  on(root, 'click', '[data-lang]', (e, btn) => {
    const l = btn.dataset.lang;
    $$('[data-lang]', root).forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
    $$('[data-sections]', root).forEach((s) => { s.hidden = s.dataset.sections !== l; });
  });

  const form = $('[data-countersign]', root);
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.elements.signedName.value.trim();
    if (name.length < 2) { toast('Type the signatory name.', 'bad'); form.elements.signedName.focus(); return; }
    const ok = await confirmAction({
      title: 'Countersign this agreement?',
      message: `Signing as <b>${esc(name)}</b> for Subtize.ai makes agreement <b class="mono">${esc(a.agreementId)}</b> with ${esc(a.business || a.listerName)} active at <b>${a.commission}%</b> commission. The lister can then publish services.`,
      confirm: 'Countersign',
      tone: 'primary',
    });
    if (!ok) return;
    const res = await run($('button[type=submit]', form), () => api.post(`/api/admin/agreements/${a.id}/countersign`, { signedName: name }), 'Agreement countersigned and active.');
    if (res) { scheduleBadgeRefresh(); go(`/agreements/${a.id}`); }
  });

  on(root, 'click', '[data-act]', async (e, btn) => {
    if (btn.dataset.act === 'terminate') {
      const reason = await confirmAction({
        title: 'Terminate this agreement?',
        message: `<b>${esc(a.business || a.listerName)}</b> loses publishing rights and <b>all their active services are taken off the catalogue</b>. Paid subscriptions are honoured until they end. This cannot be undone — a new agreement would have to be issued and signed.`,
        confirm: 'Terminate agreement',
        reason: true,
        reasonLabel: 'Reason (sent to the lister)',
        typeToConfirm: 'TERMINATE',
      });
      if (reason === null) return;
      const res = await run(btn, () => api.post(`/api/admin/agreements/${a.id}/terminate`, { reason }), 'Agreement terminated.');
      if (res) { scheduleBadgeRefresh(); go(`/agreements/${a.id}`); }
    } else {
      const ok = await confirmAction({ title: 'Issue a new agreement?', message: `A fresh Lister Agreement at the current platform commission is issued to ${esc(a.listerName)} for e-signature.`, confirm: 'Issue agreement', tone: 'primary' });
      if (!ok) return;
      const res = await run(btn, () => api.post(`/api/admin/listers/${a.listerId}/agreement`), 'New agreement issued. Waiting for the lister to sign.');
      if (res?.agreement) go(`/agreements/${res.agreement.id}`);
    }
  });
}
