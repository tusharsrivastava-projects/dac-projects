/* Lister applications: queue by status and the full review screen. */
import { api } from '../../api.js';
import { go, pageHead } from '../../shell.js';
import { $, confirmAction, debounce, esc, fmtAgo, fmtDate, fmtDateTime, icon, modal, pill, toast, tonePill } from '../../ui.js';
import { emptyState } from '../../components.js';
import { DOC_KIND, agreementPill, card, filterTabs, kv, loadingRow, mono, mount, on, orDash, run, scheduleBadgeRefresh, searchBox, setQuery, table } from './common.js';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'applied', label: 'Applied' },
  { key: 'under_review', label: 'Under review' },
  { key: 'verification_required', label: 'Verification required' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'suspended', label: 'Suspended' },
];

const checkIcon = (ok, label) => `<span class="adm-check ${ok ? 'on' : ''}" title="${esc(label)} ${ok ? 'verified' : 'not verified'}">${icon(ok ? 'checkCircle' : 'clock', 'sm')} ${esc(label)}</span>`;

export async function renderApplications({ view, query }) {
  const tab = TABS.some((t) => t.key === query.get('tab')) ? query.get('tab') : 'all';
  let q = query.get('q') || '';
  const params = () => ({ status: tab === 'all' ? '' : tab, q });
  const first = await api.get('/api/admin/applications', params());
  const counts = first.counts || {};
  counts.all = Object.values(counts).reduce((a, b) => a + b, 0);

  const root = mount(view, `
    ${pageHead('Applications', 'People applying to list services. Verify documents and address, then approve to issue a Verification ID and the Lister Agreement.')}
    ${filterTabs(TABS.map((t) => ({ ...t, count: counts[t.key] || 0 })), tab, '/applications', query)}
    <div class="adm-toolbar">${searchBox(q, 'Search business, applicant, email or application ID')}</div>
    <div data-list></div>`);

  const listEl = $('[data-list]', root);
  const draw = (rows) => {
    listEl.innerHTML = table([
      { label: 'Application', render: (a) => `${mono(a.publicId)}<div class="cell-sub">${esc(fmtDate(a.createdAt))}</div>` },
      { label: 'Business', render: (a) => `<a class="cell-title" href="#/applications/${a.id}">${esc(a.businessName)}</a><div class="cell-sub">${esc(a.category?.name || '—')}</div>` },
      { label: 'Applicant', render: (a) => `${esc(a.applicantName)}<div class="cell-sub">${esc(a.email)}</div>` },
      { label: 'City', render: (a) => esc(a.city) },
      { label: 'Status', render: (a) => pill(a.status) },
      { label: 'Checks', render: (a) => `<div class="adm-checkset">${checkIcon(a.documentsVerified, 'Docs')}${checkIcon(a.addressVerified, 'Address')}</div>` },
      { label: 'Documents', cls: 'right', render: (a) => `<span class="num">${a.documents.length}</span>` },
      { label: 'Verification ID', render: (a) => mono(a.verificationId) },
      { label: '', cls: 'nowrap', render: (a) => `<a class="btn ${['applied', 'under_review'].includes(a.status) ? 'btn-primary' : 'btn-secondary'} btn-sm" href="#/applications/${a.id}">${['applied', 'under_review', 'verification_required'].includes(a.status) ? 'Review' : 'Open'}</a>` },
    ], rows, { empty: emptyState({ ic: 'fileCheck', title: 'No applications here', text: q ? 'Nothing matches that search.' : 'New lister applications will appear here.' }) });
  };
  draw(first.applications);

  on(root, 'input', '[data-search]', debounce(async (e) => {
    q = e.target.value.trim();
    setQuery({ q });
    listEl.innerHTML = loadingRow;
    try { draw((await api.get('/api/admin/applications', params())).applications); } catch (err) { toast(err.message, 'bad'); }
  }, 300));
}

/* ── Review ────────────────────────────────────────────────────────────── */

const HISTORY = {
  'application.submitted': 'Application submitted',
  'application.resubmitted': 'Resubmitted with corrections',
  'application.under_review': 'Review started',
  'application.verification_required': 'Correction requested',
  'application.approved': 'Approved',
  'application.rejected': 'Rejected',
  'application.suspended': 'Suspended',
  'application.checks_updated': 'Verification checks updated',
  'application.sensitive_viewed': 'Sensitive details revealed',
  'application.document_viewed': 'Document viewed',
};

const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export async function renderApplication({ view, params, query }) {
  const reveal = query.get('reveal') === '1';
  const data = await api.get(`/api/admin/applications/${params.id}`, reveal ? { reveal: 1 } : null);
  const a = data.application;
  const open = ['applied', 'under_review', 'verification_required'].includes(a.status);
  const docUrl = (d) => `/api/admin/applications/${a.id}/documents/${d.id}`;
  const sensitive = (v) => (v ? `<span class="mono ${reveal ? '' : 'adm-masked'}">${esc(v)}</span>` : '<span class="muted">—</span>');

  const root = mount(view, `
    <a class="btn btn-ghost btn-sm adm-back" href="#/applications">${icon('back', 'sm')} Applications</a>
    ${pageHead(a.businessName, `${mono(a.publicId)} · submitted ${esc(fmtDate(a.createdAt))} · ${pill(a.status)}`, `
      <a class="btn btn-ghost" href="#/users/${a.userId}">${icon('user')} Applicant account</a>
      ${reveal
        ? `<a class="btn btn-secondary" href="#/applications/${a.id}">${icon('eyeOff')} Hide sensitive details</a>`
        : `<button type="button" class="btn btn-secondary" data-reveal>${icon('eye')} Reveal sensitive details</button>`}`)}

    ${reveal ? `<div class="panel-note warn mb-16">${icon('eye')}<div><b>Sensitive details are visible.</b> This view was recorded in the activity log with your name.</div></div>` : ''}
    ${a.status === 'verification_required' && a.correctionNote ? `<div class="panel-note warn mb-16">${icon('alert')}<div><b>Correction requested:</b> ${esc(a.correctionNote)}<div class="small muted">Waiting for the applicant to resubmit.</div></div></div>` : ''}
    ${a.verificationId ? `<div class="panel-note good mb-16">${icon('shield')}<div>Verification ID <b class="mono">${esc(a.verificationId)}</b>${a.reviewedAt ? ` · decided ${esc(fmtDateTime(a.reviewedAt))}` : ''}</div></div>` : ''}

    <div class="adm-split">
      <div class="stack">
        ${card('Applicant and business', kv([
          ['Applicant', esc(a.applicantName)],
          ['Business name', esc(a.businessName)],
          ['Email', esc(a.email)],
          ['Phone', esc(a.phone)],
          ['Business address', esc(a.businessAddress)],
          ['City', esc(a.city)],
          ['Category', esc(a.category?.name || '—')],
          ['Services offered', `<span class="adm-pre">${esc(a.serviceDescription)}</span>`],
          ['Agreement terms', a.agreementAck ? tonePill('Acknowledged 20% commission terms', 'good') : tonePill('Not acknowledged', 'bad')],
        ]), { ic: 'briefcase' })}
        ${card('Identity and address', kv([
          ['Verification type', orDash(a.govIdType)],
          ['Verification number', sensitive(a.govIdNumber)],
          ['Address proof type', orDash(a.addressProofType)],
          ['Address proof ID', sensitive(a.addressProofId)],
        ]), { ic: 'shield', actions: reveal ? tonePill('Revealed', 'warn') : tonePill('Masked', 'neutral') })}
        ${card('Bank and settlement', kv([
          ['Account holder', orDash(a.bankAccountName)],
          ['Account number', sensitive(a.bankAccountNumber)],
          ['IFSC', mono(a.bankIfsc)],
          ['Bank', orDash(a.bankName)],
          ['Settlement UPI', sensitive(a.settlementUpi)],
        ]), { ic: 'wallet', actions: reveal ? tonePill('Revealed', 'warn') : tonePill('Masked', 'neutral') })}
        ${card(`Documents (${a.documents.length})`, a.documents.length ? `
          <ul class="adm-docs">${a.documents.map((d) => `<li>
            <span class="icon-tile sm">${icon(d.mime?.startsWith('image/') ? 'file' : 'fileCheck')}</span>
            <div class="grow"><div class="cell-title">${esc(DOC_KIND[d.kind] || d.kind)}</div><div class="cell-sub">${esc(d.name)} · ${esc(size(d.size))} · ${esc(fmtDateTime(d.uploadedAt))}</div></div>
            <a class="btn btn-secondary btn-sm" href="${docUrl(d)}" target="_blank" rel="noopener">${icon('external', 'sm')} Open</a>
            ${d.mime?.startsWith('image/') ? `<div class="adm-doc-preview" hidden data-preview="${d.id}"></div>` : ''}
          </li>`).join('')}</ul>
          ${a.documents.some((d) => d.mime?.startsWith('image/')) ? `<button type="button" class="btn btn-ghost btn-sm mt-8" data-previews>${icon('eye', 'sm')} Show image previews</button>` : ''}
          <p class="small muted mt-8">${icon('info', 'sm')} Opening or previewing a document is recorded in the activity log.</p>`
          : '<p class="muted small">No documents uploaded.</p>', { ic: 'file' })}
        ${card('History', data.history.length ? `<ol class="adm-timeline">${data.history.map((h) => `<li><div><b>${esc(HISTORY[h.action] || h.action)}</b>${h.detail ? ` <span class="soft">— ${esc(h.detail)}</span>` : ''}</div>
          <div class="small muted">${esc(h.actor || 'System')} · ${esc(fmtDateTime(h.at))} (${esc(fmtAgo(h.at))})</div></li>`).join('')}</ol>` : '<p class="muted small">No history yet.</p>', { ic: 'activity' })}
      </div>

      <div class="stack adm-sticky">
        <section class="card">
          <div class="card-head"><h3><span class="icon-tile sm">${icon('checkCircle')}</span>Verification checks</h3></div>
          <div class="stack" style="--gap:12px">
            <label class="check adm-bigcheck"><input type="checkbox" data-check="documentsVerified" ${a.documentsVerified ? 'checked' : ''} ${open ? '' : 'disabled'}> <span><b>Documents verified</b><br><span class="small muted">ID / GST and business documents are genuine and match the applicant.</span></span></label>
            <label class="check adm-bigcheck"><input type="checkbox" data-check="addressVerified" ${a.addressVerified ? 'checked' : ''} ${open ? '' : 'disabled'}> <span><b>Address verified</b><br><span class="small muted">The business address matches the address proof.</span></span></label>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h3><span class="icon-tile sm">${icon('scale')}</span>Decision</h3>${pill(a.status)}</div>
          <div class="stack" style="--gap:10px" data-actions>
            ${['applied', 'verification_required'].includes(a.status) ? `<button type="button" class="btn btn-secondary btn-block" data-act="review">${icon('play')} Start review</button>` : ''}
            ${open ? `<button type="button" class="btn btn-primary btn-block" data-act="approve">${icon('check')} Approve lister</button>
              <p class="small muted" data-approve-hint></p>
              <button type="button" class="btn btn-secondary btn-block" data-act="correction">${icon('edit')} Request correction</button>
              <button type="button" class="btn btn-danger-outline btn-block" data-act="reject">${icon('x')} Reject</button>` : ''}
            ${a.status === 'approved' ? `<button type="button" class="btn btn-danger-outline btn-block" data-act="suspend">${icon('pause')} Suspend lister</button>
              <p class="small muted">Suspending takes all their active services off the catalogue.</p>` : ''}
            ${a.status === 'suspended' ? `<button type="button" class="btn btn-primary btn-block" data-act="reinstate">${icon('refresh')} Reinstate lister</button>
              <p class="small muted">Services stay inactive until you reactivate them.</p>` : ''}
            ${a.status === 'rejected' ? `<p class="small muted">This application was rejected${a.adminNote ? `: ${esc(a.adminNote)}` : '.'} The applicant can apply again.</p>` : ''}
          </div>
        </section>
        ${card('Verification and agreement', kv([
          ['Verification ID', mono(a.verificationId)],
          ['Agreement', data.agreement ? `<a href="#/agreements/${data.agreement.id}">${agreementPill(data.agreement.status)}</a>` : agreementPill(null)],
          data.agreement ? ['Agreement ID', `<a class="mono" href="#/agreements/${data.agreement.id}">${esc(data.agreement.agreementId)}</a>`] : null,
          data.agreement ? ['Commission', `${data.agreement.commission}%`] : null,
          ['Reviewed', a.reviewedAt ? esc(fmtDateTime(a.reviewedAt)) : null],
        ]), { ic: 'signature' })}
      </div>
    </div>`);

  const state = { documentsVerified: a.documentsVerified, addressVerified: a.addressVerified };
  const approveBtn = $('[data-act=approve]', root);
  const hint = $('[data-approve-hint]', root);
  const syncApprove = () => {
    if (!approveBtn) return;
    const ready = state.documentsVerified && state.addressVerified;
    approveBtn.disabled = !ready;
    const missing = [!state.documentsVerified && 'Documents verified', !state.addressVerified && 'Address verified'].filter(Boolean);
    hint.innerHTML = ready
      ? `${icon('checkCircle', 'sm')} Both checks are done. Approving issues a Verification ID, assigns the Lister role and sends the Lister Agreement for e-signature.`
      : `${icon('lock', 'sm')} Approval unlocks once you tick <b>${missing.join('</b> and <b>')}</b>.`;
  };
  syncApprove();

  on(root, 'change', '[data-check]', async (e, box) => {
    const key = box.dataset.check;
    box.disabled = true;
    try {
      const res = await api.post(`/api/admin/applications/${a.id}/verify`, { [key]: box.checked });
      state.documentsVerified = res.application.documentsVerified;
      state.addressVerified = res.application.addressVerified;
      toast(`${key === 'documentsVerified' ? 'Documents' : 'Address'} marked ${box.checked ? 'verified' : 'not verified'}.`);
    } catch (err) {
      box.checked = !box.checked;
      toast(err.message, 'bad');
    } finally { box.disabled = false; syncApprove(); }
  });

  on(root, 'click', '[data-reveal]', async () => {
    const ok = await confirmAction({ title: 'Reveal sensitive details?', message: 'Full identity, bank account and UPI numbers will be shown. <b>This is recorded in the activity log with your name.</b>', confirm: 'Reveal', tone: 'primary' });
    if (ok) go(`/applications/${a.id}?reveal=1`);
  });

  on(root, 'click', '[data-previews]', (e, btn) => {
    root.querySelectorAll('[data-preview]').forEach((host) => {
      host.hidden = !host.hidden;
      if (!host.hidden && !host.innerHTML) host.innerHTML = `<img src="/api/admin/applications/${a.id}/documents/${host.dataset.preview}" alt="Document preview" loading="lazy">`;
    });
    btn.innerHTML = btn.innerHTML.includes('Show') ? `${icon('eyeOff', 'sm')} Hide image previews` : `${icon('eye', 'sm')} Show image previews`;
  });

  const reload = () => go(`/applications/${a.id}${reveal ? '?reveal=1' : ''}`);
  const post = (path, body) => api.post(`/api/admin/applications/${a.id}/${path}`, body);
  const name = `<b>${esc(a.businessName)}</b>`;

  on(root, 'click', '[data-act]', async (e, btn) => {
    const act = btn.dataset.act;
    let res = null;
    if (act === 'review') {
      if (!(await confirmAction({ title: 'Start the review?', message: `${name} moves to <b>Under review</b> and the applicant is notified.`, confirm: 'Start review', tone: 'primary' }))) return;
      res = await run(btn, () => post('review'), 'Review started.');
    } else if (act === 'approve') {
      res = await modal({
        title: 'Approve this lister?',
        body: `<p>Approving ${name}:</p>
          <ul class="adm-list"><li>issues a <b>Verification ID</b>,</li><li>assigns the <b>Lister role</b> (the applicant is signed out so it applies),</li><li>issues the <b>Lister Agreement</b> for their e-signature.</li></ul>
          <p class="small muted">Their services go live only after the agreement is signed and countersigned.</p>
          <div class="field mt-16"><label for="ap-note">Note <span class="muted">(optional, internal)</span></label><textarea id="ap-note" class="textarea" name="note" rows="2"></textarea></div>`,
        confirm: 'Approve and issue agreement',
        onSubmit: (f) => post('approve', { note: f.elements.note.value.trim() }),
      });
      if (res) toast(`Approved. Verification ID ${res.application.verificationId}.`);
    } else if (act === 'correction') {
      const note = await confirmAction({ title: 'Request a correction?', message: `${name} moves to <b>Verification required</b>. The applicant sees your note and can resubmit.`, confirm: 'Send request', tone: 'primary', reason: true, reasonLabel: 'What needs correcting' });
      if (note === null) return;
      res = await run(btn, () => post('request-correction', { note }), 'Correction requested. The applicant has been notified.');
    } else if (act === 'reject') {
      const note = await confirmAction({ title: 'Reject this application?', message: `${name} is told the application was not approved, with your reason. They may apply again later.`, confirm: 'Reject application', reason: true, reasonLabel: 'Reason shown to the applicant' });
      if (note === null) return;
      res = await run(btn, () => post('reject', { note }), 'Application rejected.');
    } else if (act === 'suspend') {
      const note = await confirmAction({ title: 'Suspend this lister?', message: `${name} is suspended and <b>all their active services are taken off the catalogue</b>. Existing subscriptions are not cancelled.`, confirm: 'Suspend lister', reason: true });
      if (note === null) return;
      res = await run(btn, () => post('suspend', { note }), 'Lister suspended.');
    } else if (act === 'reinstate') {
      if (!(await confirmAction({ title: 'Reinstate this lister?', message: `${name} returns to <b>Approved</b>. Their services stay inactive until you reactivate them.`, confirm: 'Reinstate', tone: 'primary' }))) return;
      res = await run(btn, () => post('reinstate'), 'Lister reinstated.');
    }
    if (res) { scheduleBadgeRefresh(); reload(); }
  });
}
