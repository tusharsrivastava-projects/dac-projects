import { api, ApiError } from './api.js';
import {
  $, $$, busy, confirmDialog, copyText, el, emptyState, esc, fmtAgo, fmtBytes,
  fmtClock, fmtDate, fmtDateTime, icon, initials, modal, pill, toast,
} from './ui.js';
import { go, mountShell, render, renderLoading, requireUser, setHeader, setNavBadge, startRouter } from './shell.js';

const user = await requireUser('admin');

const NAV = [
  { items: [
    { label: 'Overview',      path: '/',            icon: 'home' },
    { label: 'Applications',  path: '/applications', icon: 'file' },
  ] },
  { label: 'Hiring setup', items: [
    { label: 'Roles',         path: '/roles',       icon: 'briefcase' },
    { label: 'Question bank', path: '/questions',   icon: 'help' },
  ] },
  { label: 'Outcomes', items: [
    { label: 'Offer letters', path: '/offers',      icon: 'award' },
    { label: 'Candidates',    path: '/candidates',  icon: 'users' },
  ] },
  { label: 'System', items: [
    { label: 'Mail outbox',   path: '/outbox',      icon: 'mail' },
    { label: 'Activity',      path: '/activity',    icon: 'activity' },
  ] },
];

mountShell({ user, nav: NAV, roleLabel: 'Admin console' });

const STAGE_LABELS = {
  applied: 'Applied', screening: 'Screening', interview: 'Interview open',
  evaluation: 'Under review', approved: 'Approved', offer_sent: 'Offer sent',
  offer_accepted: 'Offer accepted', offer_declined: 'Offer declined',
  rejected: 'Not selected', withdrawn: 'Withdrawn',
};

const scorePill = (score) => {
  if (score === null || score === undefined) return '<span class="muted-2 tiny">not scored</span>';
  const tone = score >= 7.5 ? 'good' : score >= 5 ? 'warn' : 'bad';
  return `<span class="pill tone-${tone} pill-bare">${score.toFixed(1)} / 10</span>`;
};

/* ── Overview ───────────────────────────────────────────────────────────── */

async function viewOverview() {
  renderLoading();
  const data = await api.get('/api/admin/overview');
  const { totals, pipeline, perRole, recent } = data;

  setNavBadge('/applications', totals.awaitingReview || null, totals.awaitingReview > 0);

  setHeader({
    title: 'Hiring overview',
    sub: totals.openRoles === 0
      ? 'No roles posted yet'
      : `${totals.applications} application${totals.applications === 1 ? '' : 's'} across ${totals.openRoles} open role${totals.openRoles === 1 ? '' : 's'}`,
    actions: [
      data.storage?.folderLink
        ? el('a', {
            class: 'btn btn-ghost', href: data.storage.folderLink, target: '_blank', rel: 'noopener',
            html: `${icon('folder')}Submissions folder`,
          })
        : el('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('help')}Question bank`, onClick: () => go('/questions') }),
      el('button', { class: 'btn btn-primary', type: 'button', html: `${icon('file')}Review applications`, onClick: () => go('/applications') }),
    ],
  });

  const stat = (value, label, hint, cls = '', onClick = null) =>
    el('div', {
      class: `card stat ${cls}`,
      style: onClick ? 'cursor:pointer' : '',
      onClick,
    }, [
      el('div', { class: 'stat-value', text: String(value) }),
      el('div', { class: 'stat-label', text: label }),
      hint ? el('div', { class: 'stat-hint', text: hint }) : null,
    ]);

  const maxStage = Math.max(1, ...pipeline.map((p) => p.count));

  const firstRun = totals.openRoles === 0 && totals.applications === 0;

  render(el('div', { class: 'stack', style: 'gap:18px' }, [
    firstRun ? el('div', { class: 'card card-pad', style: 'border-color:var(--violet-200)' }, [
      el('div', { class: 'eyebrow', style: 'color:var(--violet-500)', text: 'First run' }),
      el('h2', { style: 'margin-top:6px', text: 'Your hiring board is empty' }),
      el('p', { class: 'muted', style: 'margin:8px 0 0;max-width:62ch' },
        'Nothing is shown to candidates until you post a role, so the board starts blank on purpose. Post one, then add the questions you want every applicant to answer on camera-free audio.'),
      el('div', { class: 'row-wrap', style: 'margin-top:16px' }, [
        el('button', { class: 'btn btn-primary', type: 'button', html: `${icon('plus')}Post your first role`,
          onClick: () => go('/roles') }),
        el('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('help')}Set up the question bank`,
          onClick: () => go('/questions') }),
      ]),
    ]) : null,

    storageBanner(data.storage),

    !data.smtpConfigured ? el('div', { class: 'alert alert-violet' }, [
      el('span', { html: icon('mail'), style: 'line-height:0' }),
      el('span', { html: 'No SMTP server is configured, so every letter and notification is being held in the <strong>Mail outbox</strong> instead of going out. Set <code>SMTP_HOST</code> to send for real.' }),
    ]) : null,

    el('div', { class: 'grid grid-4' }, [
      stat(totals.awaitingReview, 'Waiting on you', 'Applications needing a decision', totals.awaitingReview ? 'stat-hot' : '', () => go('/applications')),
      stat(totals.unscored, 'Recordings to score', `${totals.recordings} recorded in total`, totals.unscored ? 'stat-accent' : ''),
      stat(totals.offersOut, 'Offers out', `${totals.offersAccepted} accepted so far`, '', () => go('/offers')),
      stat(totals.candidates, 'Candidates', `${totals.questions} live interview questions`),
    ]),

    el('div', { class: 'grid', style: 'grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr)' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { text: 'Pipeline' })]),
        el('div', { class: 'card-body' }, [
          el('div', { class: 'pipeline-bar' }, pipeline.filter((p) => p.count > 0 || ['applied', 'screening', 'interview', 'evaluation', 'approved'].includes(p.stage)).map((p) =>
            el('div', { class: 'pipeline-row' }, [
              el('span', { class: 'muted', text: p.label }),
              el('div', { class: 'pipeline-track' }, [
                el('span', { style: `width:${Math.round((p.count / maxStage) * 100)}%;background:${
                  p.tone === 'good' ? 'var(--green-600)' : p.tone === 'bad' ? 'var(--red-500)' : 'var(--violet-400)'}` }),
              ]),
              el('span', { class: 'n', text: String(p.count) }),
            ]))),
        ]),
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { text: 'Recent activity' })]),
        el('div', { class: 'card-body' }, [
          recent.length
            ? el('div', { class: 'timeline' }, recent.slice(0, 8).map((r) => el('div', { class: 'timeline-item' }, [
                el('div', { class: 'timeline-dot', html: icon('check') }),
                el('div', [
                  el('div', { style: 'font-size:13.5px;font-weight:550', text: humanAction(r.action) }),
                  el('div', { class: 'tiny muted', text: `${r.actor_name || 'System'} · ${fmtAgo(r.created_at)}${r.detail ? ` · ${r.detail}` : ''}` }),
                ]),
              ])))
            : el('p', { class: 'muted tiny', text: 'Nothing has happened yet.' }),
        ]),
      ]),
    ]),

    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { class: 'grow', text: 'By role' }),
        el('button', { class: 'btn btn-quiet btn-sm', type: 'button', text: 'Manage roles', onClick: () => go('/roles') }),
      ]),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data' }, [
          el('thead', [el('tr', [
            el('th', { text: 'Role' }), el('th', { text: 'Status' }), el('th', { text: 'Openings' }),
            el('th', { text: 'Applications' }), el('th', { text: 'Offers' }), el('th', { text: 'Avg score' }),
          ])]),
          el('tbody', perRole.map((r) => el('tr', { class: 'clickable', onClick: () => go(`/applications?jobId=${r.id}`) }, [
            el('td', { class: 'strong', text: r.title }),
            el('td', { html: pill(r.status, r.status === 'open' ? 'good' : 'muted') }),
            el('td', { text: String(r.openings) }),
            el('td', { text: String(r.applications) }),
            el('td', { text: String(r.offers || 0) }),
            el('td', { html: scorePill(r.avg_score) }),
          ]))),
        ]),
      ]),
    ]),
  ]));
}

/**
 * Three states worth telling apart: Drive working, Drive configured but
 * broken, and plain local disk. The middle one used to render the same
 * "set STORAGE_DRIVER=drive" advice even though it was already set.
 */
function storageBanner(storage) {
  if (storage?.driver === 'drive' && storage.ok && storage.folderLink) {
    return el('div', { class: 'alert alert-good' }, [
      el('span', { html: icon('folder'), style: 'line-height:0' }),
      el('span', { class: 'grow' }, [
        el('span', { text: 'Recordings are filed into your Google Drive, one folder per candidate. ' }),
        el('a', { href: storage.folderLink, target: '_blank', rel: 'noopener', text: 'Open the submissions folder' }),
        el('span', { text: ' to listen there instead.' }),
      ]),
    ]);
  }

  if (storage?.driver === 'drive') {
    return el('div', { class: 'alert alert-error' }, [
      el('span', { html: icon('alert'), style: 'line-height:0' }),
      el('span', { class: 'grow' }, [
        el('strong', { text: 'Google Drive is switched on but not working, ' }),
        el('span', { text: 'so recordings are falling back to local disk — which a free instance wipes on restart. ' }),
        storage.error ? el('span', { class: 'mono', style: 'display:block;margin-top:6px', text: storage.error }) : null,
      ]),
    ]);
  }

  return el('div', { class: 'alert alert-warn' }, [
    el('span', { html: icon('alert'), style: 'line-height:0' }),
    el('span', { html: 'Recordings are being written to <strong>local disk</strong>. On a free Render instance that disk is wiped on every restart, so submitted interviews will not survive. Set <code>STORAGE_DRIVER=drive</code> to file them into Google Drive instead.' }),
  ]);
}

const humanAction = (a) => ({
  'account.registered': 'New candidate registered',
  'account.login': 'Signed in',
  'account.logout': 'Signed out',
  'application.submitted': 'Application submitted',
  'application.withdrawn': 'Application withdrawn',
  'interview.submitted': 'Interview submitted',
  'answer.recorded': 'Answer recorded',
  'answer.rerecorded': 'Answer re-recorded',
  'answer.evaluated': 'Answer scored',
  'offer.drafted': 'Offer drafted',
  'offer.sent': 'Offer letter sent',
  'offer.accepted': 'Offer accepted',
  'offer.declined': 'Offer declined',
  'offer.revoked': 'Offer revoked',
  'question.created': 'Question added',
  'question.updated': 'Question edited',
  'question.retired': 'Question retired',
  'question.deleted': 'Question deleted',
  'job.created': 'Role created',
  'job.updated': 'Role updated',
  'job.closed': 'Role closed',
}[a] || a.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));

/* ── Applications ───────────────────────────────────────────────────────── */

const filters = { stage: 'all', jobId: 'all', q: '', sort: 'newest' };

async function viewApplications(_params, query) {
  if (query?.get('jobId')) filters.jobId = query.get('jobId');
  if (query?.get('stage')) filters.stage = query.get('stage');

  renderLoading();
  const { jobs } = await api.get('/api/jobs?all=1');

  const host = el('div', { class: 'stack' });
  const results = el('div');

  const searchInput = el('input', { class: 'input input-sm', placeholder: 'Name, email, role…', value: filters.q, type: 'search' });
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { filters.q = searchInput.value.trim(); load(); }, 260);
  });

  const jobSelect = el('select', { class: 'select input-sm', onChange: (e) => { filters.jobId = e.target.value; load(); } }, [
    el('option', { value: 'all', text: 'All roles' }),
    ...jobs.map((j) => el('option', { value: String(j.id), text: j.title, selected: String(j.id) === filters.jobId })),
  ]);

  const sortSelect = el('select', { class: 'select input-sm', onChange: (e) => { filters.sort = e.target.value; load(); } }, [
    el('option', { value: 'newest', text: 'Newest first' }),
    el('option', { value: 'oldest', text: 'Oldest first' }),
    el('option', { value: 'score', text: 'Highest score' }),
    el('option', { value: 'name', text: 'Name A–Z' }),
  ]);

  const chipRow = el('div', { class: 'chip-row' });

  host.append(
    el('div', { class: 'card card-pad stack-sm' }, [
      el('div', { class: 'filter-bar' }, [
        el('div', { class: 'search-wrap' }, [
          el('span', { html: icon('search') }),
          searchInput,
        ]),
        jobSelect,
        sortSelect,
      ]),
      chipRow,
    ]),
    results,
  );
  render(host);

  async function load() {
    results.innerHTML = '<div class="skeleton" style="height:320px"></div>';
    const params = new URLSearchParams({ stage: filters.stage, jobId: filters.jobId, sort: filters.sort, limit: '100' });
    if (filters.q) params.set('q', filters.q);
    const data = await api.get(`/api/applications?${params}`);

    setHeader({
      title: 'Applications',
      sub: `${data.total} match${data.total === 1 ? '' : 'es'} the current filter`,
    });

    const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
    chipRow.innerHTML = '';
    chipRow.append(el('button', {
      class: `chip${filters.stage === 'all' ? ' is-active' : ''}`, type: 'button',
      html: `All<span class="n">${total}</span>`,
      onClick: () => { filters.stage = 'all'; load(); },
    }));
    for (const [key, label] of Object.entries(STAGE_LABELS)) {
      const n = data.counts[key] || 0;
      if (!n && !['applied', 'evaluation', 'approved'].includes(key)) continue;
      chipRow.append(el('button', {
        class: `chip${filters.stage === key ? ' is-active' : ''}`, type: 'button',
        html: `${esc(label)}<span class="n">${n}</span>`,
        onClick: () => { filters.stage = key; load(); },
      }));
    }

    results.innerHTML = '';
    results.append(el('div', { class: 'card' }, [
      data.applications.length
        ? el('div', { class: 'table-wrap' }, [
            el('table', { class: 'data' }, [
              el('thead', [el('tr', [
                el('th', { text: 'Candidate' }), el('th', { text: 'Role' }), el('th', { text: 'Stage' }),
                el('th', { text: 'Interview' }), el('th', { text: 'Score' }), el('th', { text: 'Applied' }),
              ])]),
              el('tbody', data.applications.map((a) => el('tr', {
                class: 'clickable', onClick: () => go(`/applications/${a.id}`),
              }, [
                el('td', [
                  el('div', { class: 'row', style: 'gap:10px' }, [
                    el('div', { class: 'avatar', style: 'width:30px;height:30px;font-size:11.5px;border-radius:8px', text: initials(a.candidate.fullName) }),
                    el('div', { style: 'min-width:0' }, [
                      el('div', { class: 'strong nowrap', text: a.candidate.fullName }),
                      el('div', { class: 'tiny muted nowrap', text: a.candidate.email }),
                    ]),
                  ]),
                ]),
                el('td', [
                  el('div', { class: 'nowrap', text: a.job.title }),
                  el('div', { class: 'tiny muted mono', text: a.job.code }),
                ]),
                el('td', { html: pill(a.stageLabel, a.stageTone) }),
                el('td', { class: 'tiny', html: a.questionTotal
                  ? `${a.answered}/${a.questionTotal} recorded<br><span class="muted">${a.evaluatedCount}/${a.answered || 0} scored</span>`
                  : '<span class="muted">—</span>' }),
                el('td', { html: scorePill(a.score) }),
                el('td', { class: 'tiny muted nowrap', text: fmtAgo(a.createdAt) }),
              ]))),
            ]),
          ])
        : emptyState({
            iconName: 'search', title: 'Nothing matches',
            message: 'Try a different stage, role or search term.',
          }),
    ]));
  }

  await load();
}

async function viewApplication({ id }) {
  renderLoading(2);
  const { application: a, answers } = await api.get(`/api/applications/${id}`);

  const reload = () => go(`/applications/${a.id}`);

  setHeader({
    title: a.candidate.fullName,
    sub: `${a.job.title} · applied ${fmtDate(a.createdAt)}`,
    actions: [el('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('back')}All applications`, onClick: () => go('/applications') })],
  });

  /* Stage controls */
  const stageButtons = a.nextStages.map((next) => el('button', {
    class: `btn btn-sm ${next === 'approved' ? 'btn-good' : next === 'rejected' ? 'btn-danger-ghost' : 'btn-ghost'}`,
    type: 'button',
    text: `Move to ${STAGE_LABELS[next]}`,
    onClick: () => moveStage(a, next, reload),
  }));

  /* Notes */
  const notesArea = el('textarea', {
    class: 'textarea', rows: '5', placeholder: 'Private notes for the panel. The candidate never sees these.',
    value: a.adminNotes || '',
  });
  const saveNotes = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', text: 'Save notes',
    onClick: async (e) => {
      const restore = busy(e.currentTarget, 'Saving…');
      try {
        await api.patch(`/api/applications/${a.id}/notes`, { adminNotes: notesArea.value });
        toast('Notes saved.', 'good');
      } catch (err) { toast(err.message, 'error'); } finally { restore(); }
    },
  });

  /* Offer panel */
  let offerPanel;
  if (a.offer) {
    const o = await api.get(`/api/offers/${a.offer.id}`).then((r) => r.offer);
    offerPanel = el('div', { class: 'card card-pad stack-sm' }, [
      el('div', { class: 'spread' }, [
        el('div', { class: 'eyebrow', text: 'Offer letter' }),
        el('span', { html: pill(o.status, o.status === 'accepted' ? 'good' : o.status === 'declined' || o.status === 'revoked' ? 'bad' : 'action') }),
      ]),
      el('div', { class: 'dl', style: 'margin:6px 0' }, [
        el('dt', { text: 'Position' }),     el('dd', { text: o.positionTitle }),
        el('dt', { text: 'Compensation' }), el('dd', { text: o.compensation }),
        el('dt', { text: 'Starts' }),       el('dd', { text: fmtDate(o.startDate) }),
      ]),
      o.status === 'draft'
        ? el('button', { class: 'btn btn-primary btn-block btn-sm', type: 'button', html: `${icon('send')}Send to candidate`,
            onClick: () => sendOffer(o, reload) })
        : el('button', { class: 'btn btn-ghost btn-block btn-sm', type: 'button', text: 'Copy offer link',
            onClick: async () => toast(await copyText(o.link) ? 'Link copied.' : 'Could not copy.', 'good') }),
      ['draft', 'sent'].includes(o.status)
        ? el('div', { class: 'row', style: 'gap:8px' }, [
            el('button', { class: 'btn btn-ghost btn-sm grow', type: 'button', text: 'Edit', onClick: () => openOfferForm(a, o, reload) }),
            el('button', { class: 'btn btn-danger-ghost btn-sm grow', type: 'button', text: 'Revoke',
              onClick: async () => {
                if (!await confirmDialog({ title: 'Revoke this offer?', message: 'The link stops working and the application goes back to Approved.', confirmLabel: 'Revoke', danger: true })) return;
                await api.post(`/api/offers/${o.id}/revoke`);
                toast('Offer revoked.');
                reload();
              } }),
          ])
        : null,
    ]);
  } else if (a.stage === 'approved') {
    offerPanel = el('div', { class: 'card card-pad stack-sm' }, [
      el('div', { class: 'eyebrow', text: 'Offer letter' }),
      el('p', { class: 'tiny muted', style: 'margin:0', text: 'Approved and ready. Draft the letter, then send it — the candidate gets a private link to accept or decline.' }),
      el('button', { class: 'btn btn-primary btn-block', type: 'button', html: `${icon('award')}Draft offer letter`,
        onClick: () => openOfferForm(a, null, reload) }),
    ]);
  }

  render(el('div', { class: 'split' }, [
    el('div', { class: 'stack' }, [
      el('div', { class: 'card card-pad' }, [
        el('div', { class: 'spread', style: 'align-items:flex-start' }, [
          el('div', { class: 'row', style: 'gap:13px' }, [
            el('div', { class: 'avatar', style: 'width:46px;height:46px;font-size:17px;border-radius:12px', text: initials(a.candidate.fullName) }),
            el('div', [
              el('div', { style: 'font-size:17px;font-weight:700', text: a.candidate.fullName }),
              el('div', { class: 'tiny muted', text: `${a.candidate.email}${a.candidate.phone ? ` · ${a.candidate.phone}` : ''}` }),
            ]),
          ]),
          el('div', { style: 'text-align:right' }, [
            el('div', { html: pill(a.stageLabel, a.stageTone) }),
            el('div', { class: 'tiny muted', style: 'margin-top:5px', text: `Updated ${fmtAgo(a.updatedAt)}` }),
          ]),
        ]),
        a.headline ? el('p', { style: 'margin:16px 0 0;font-size:15.5px;font-weight:550', text: a.headline }) : null,
      ]),

      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { text: 'Application' })]),
        el('div', { class: 'card-body stack' }, [
          a.skills ? el('div', [el('div', { class: 'eyebrow', text: 'Skills' }), el('p', { style: 'margin-top:5px', text: a.skills })]) : null,
          a.experience ? el('div', [el('div', { class: 'eyebrow', text: 'Experience' }), el('div', { class: 'prose', style: 'margin-top:5px', text: a.experience })]) : null,
          el('div', [el('div', { class: 'eyebrow', text: 'Why this role' }), el('div', { class: 'prose', style: 'margin-top:5px', text: a.coverNote || '—' })]),
          (a.portfolioUrl || a.resumeUrl) ? el('div', { class: 'row-wrap' }, [
            a.portfolioUrl ? el('a', { class: 'btn btn-ghost btn-sm', href: a.portfolioUrl, target: '_blank', rel: 'noopener', text: 'Portfolio ↗' }) : null,
            a.resumeUrl ? el('a', { class: 'btn btn-ghost btn-sm', href: a.resumeUrl, target: '_blank', rel: 'noopener', text: 'Résumé ↗' }) : null,
          ]) : null,
        ]),
      ]),

      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { class: 'grow', text: 'Recorded interview' }),
          a.driveFolderLink
            ? el('a', {
                class: 'btn btn-ghost btn-sm', href: a.driveFolderLink, target: '_blank', rel: 'noopener',
                html: `${icon('folder')}Open in Drive`,
              })
            : null,
          answers.length ? el('span', { class: 'tiny muted', text: `${a.evaluatedCount}/${answers.length} scored` }) : null,
        ]),
        answers.length
          ? el('div', { class: 'card-body stack' }, answers.map((ans, i) => answerBlock(ans, i, a, Boolean(a.driveFolderLink))))
          : emptyState({
              iconName: 'mic', title: 'No recordings yet',
              message: a.stage === 'interview'
                ? 'The interview is open — the candidate has not recorded anything yet.'
                : 'Move this application to "Interview open" to let the candidate record their answers.',
            }),
      ]),
    ]),

    el('div', { class: 'stack' }, [
      el('div', { class: 'card card-pad stack-sm' }, [
        el('div', { class: 'eyebrow', text: 'Move this application' }),
        ...(stageButtons.length ? stageButtons : [el('p', { class: 'tiny muted', style: 'margin:0', text: 'This application is closed. Nothing left to move.' })]),
      ]),
      offerPanel,
      el('div', { class: 'card card-pad stack-sm' }, [
        el('div', { class: 'eyebrow', text: 'Panel notes' }),
        notesArea,
        saveNotes,
      ]),
      el('div', { class: 'card card-pad' }, [
        el('div', { class: 'eyebrow', style: 'margin-bottom:10px', text: 'Record' }),
        el('div', { class: 'dl' }, [
          el('dt', { text: 'Role' }),        el('dd', { text: a.job.title }),
          el('dt', { text: 'Reference' }),   el('dd', { class: 'mono', text: a.job.code }),
          el('dt', { text: 'Applied' }),     el('dd', { text: fmtDateTime(a.createdAt) }),
          a.interviewUnlockedAt ? el('dt', { text: 'Interview opened' }) : null,
          a.interviewUnlockedAt ? el('dd', { text: fmtDateTime(a.interviewUnlockedAt) }) : null,
          a.interviewSubmittedAt ? el('dt', { text: 'Interview in' }) : null,
          a.interviewSubmittedAt ? el('dd', { text: fmtDateTime(a.interviewSubmittedAt) }) : null,
          a.reviewedBy ? el('dt', { text: 'Last moved by' }) : null,
          a.reviewedBy ? el('dd', { text: a.reviewedBy }) : null,
        ]),
      ]),
    ]),
  ]));
}

function answerBlock(ans, i, application, driveExpected = false) {
  const scoreInput = el('input', {
    class: 'input input-sm score-input', type: 'number', min: '0', max: '10', step: '0.5',
    value: ans.score ?? '', placeholder: '–',
  });
  const feedbackInput = el('textarea', {
    class: 'textarea', rows: '2', placeholder: 'What stood out, good or bad.', value: ans.feedback || '',
  });

  const save = el('button', {
    class: 'btn btn-primary btn-sm', type: 'button', text: ans.score === null ? 'Save score' : 'Update score',
    onClick: async (e) => {
      if (scoreInput.value === '') { toast('Put a score in first.', 'error'); scoreInput.focus(); return; }
      const restore = busy(e.currentTarget, 'Saving…');
      try {
        const res = await api.post(`/api/interview/answers/${ans.id}/evaluate`, {
          score: Number(scoreInput.value), feedback: feedbackInput.value,
        });
        toast(`Scored ${res.score}/10 · application average now ${res.applicationScore}`, 'good');
        e.currentTarget.textContent = 'Update score';
      } catch (err) { toast(err.message, 'error'); } finally { restore(); }
    },
  });

  return el('div', { class: 'answer-block' }, [
    el('div', { class: 'answer-head' }, [
      el('div', { class: 'spread' }, [
        el('div', { class: 'eyebrow', text: `Question ${i + 1}` }),
        el('span', { html: scorePill(ans.score) }),
      ]),
      el('div', { style: 'margin-top:5px;font-weight:600;font-size:14.5px', text: ans.prompt }),
    ]),
    el('div', { class: 'answer-body stack-sm' }, [
      el('audio', { controls: true, preload: 'none', src: ans.audioUrl }),
      el('div', { class: 'row-wrap', style: 'gap:8px' }, [
        el('span', { class: 'tiny muted grow', text: `${fmtClock(ans.durationSeconds)} · ${fmtBytes(ans.sizeBytes)} · recorded ${fmtAgo(ans.createdAt)}${ans.evaluatedBy ? ` · scored by ${ans.evaluatedBy}` : ''}` }),
        ans.driveLink
          ? el('a', { class: 'tiny', href: ans.driveLink, target: '_blank', rel: 'noopener', text: 'Open in Drive ↗' })
          : null,
        ans.storage === 'local' && driveExpected
          ? el('span', {
              class: 'pill tone-warn',
              title: 'The Drive upload failed for this one, so it is only on the server disk. Download it before the next restart.',
              text: 'on disk only',
            })
          : null,
      ]),
      feedbackInput,
      el('div', { class: 'row' }, [
        el('label', { class: 'label', for: '', text: 'Score' }),
        scoreInput,
        el('span', { class: 'tiny muted grow', text: 'out of 10' }),
        save,
      ]),
    ]),
  ]);
}

function moveStage(a, next, reload) {
  const needsReason = next === 'rejected';
  const reasonArea = el('textarea', {
    class: 'textarea', rows: '3',
    placeholder: 'This goes to the candidate in the email. Be brief and kind.',
  });

  modal({
    title: `Move to ${STAGE_LABELS[next]}?`,
    subtitle: `${a.candidate.fullName} · ${a.job.title}`,
    body: el('div', { class: 'stack' }, [
      el('p', { class: 'muted', text: {
        screening: 'Marks the application as being read. No email goes out.',
        interview: 'Unlocks the audio interview and emails the candidate a link to record their answers.',
        evaluation: 'Moves the application to the review queue without waiting for the candidate.',
        approved: 'Tells the candidate the panel said yes, and lets you draft their offer letter.',
        rejected: 'Closes the application and emails the candidate with your reason.',
        applied: 'Puts the application back at the start of the queue.',
      }[next] || 'Moves the application to this stage.' }),
      needsReason ? el('div', { class: 'field' }, [
        el('label', { text: 'Reason for the candidate' }),
        reasonArea,
      ]) : null,
    ]),
    footer: (close) => [
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onClick: () => close() }),
      el('button', {
        class: `btn ${next === 'rejected' ? 'btn-danger' : 'btn-primary'}`, type: 'button',
        text: `Move to ${STAGE_LABELS[next]}`,
        onClick: async (e) => {
          if (needsReason && !reasonArea.value.trim()) { toast('Give the candidate a reason.', 'error'); reasonArea.focus(); return; }
          const restore = busy(e.currentTarget, 'Moving…');
          try {
            await api.patch(`/api/applications/${a.id}/stage`, { stage: next, reason: reasonArea.value || undefined });
            close();
            toast(`Moved to ${STAGE_LABELS[next]}.`, 'good');
            reload();
          } catch (err) {
            restore();
            toast(err instanceof ApiError ? err.message : 'Could not move this application.', 'error');
          }
        },
      }),
    ],
  });
}

/* ── Offer form ─────────────────────────────────────────────────────────── */

function openOfferForm(application, existing, reload) {
  const today = new Date();
  const inWeeks = (n) => new Date(today.getTime() + n * 7 * 864e5).toISOString().slice(0, 10);

  const form = el('form', { class: 'stack', id: 'offer-form', novalidate: true }, [
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'of-title', text: 'Position title' }),
        el('input', { class: 'input', id: 'of-title', name: 'positionTitle', required: true,
          value: existing?.positionTitle || application.job.title }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'of-type', text: 'Engagement' }),
        el('input', { class: 'input', id: 'of-type', name: 'employmentType',
          value: existing?.employmentType || application.job.employmentType }),
      ]),
    ]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'of-dept', text: 'Team' }),
        el('input', { class: 'input', id: 'of-dept', name: 'department', value: existing?.department || application.job.department }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'of-loc', text: 'Location' }),
        el('input', { class: 'input', id: 'of-loc', name: 'location', value: existing?.location || 'Dehradun, IN (hybrid)' }),
      ]),
    ]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'of-comp', text: 'Compensation' }),
        el('input', { class: 'input', id: 'of-comp', name: 'compensation', required: true,
          value: existing?.compensation || '', placeholder: '₹15,000 / month' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'of-report', text: 'Reporting to' }),
        el('input', { class: 'input', id: 'of-report', name: 'reportingTo', value: existing?.reportingTo || '', placeholder: 'Lead, Applied ML' }),
      ]),
    ]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'of-start', text: 'Start date' }),
        el('input', { class: 'input', id: 'of-start', name: 'startDate', type: 'date', required: true,
          value: existing?.startDate || inWeeks(4) }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'of-exp', text: 'Offer valid until' }),
        el('input', { class: 'input', id: 'of-exp', name: 'expiresOn', type: 'date',
          value: existing?.expiresOn || inWeeks(2) }),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'of-terms', text: 'Additional terms' }),
      el('textarea', { class: 'textarea', id: 'of-terms', name: 'extraTerms', rows: '4',
        value: existing?.extraTerms || '', placeholder: 'One paragraph per term. Blank line between them.' }),
      el('span', { class: 'field-hint', text: 'Optional. These appear as their own section in the letter.' }),
    ]),
    el('div', { id: 'offer-error' }),
  ]);

  const { close } = modal({
    title: existing ? 'Edit offer letter' : 'Draft offer letter',
    subtitle: `${application.candidate.fullName} · ${application.job.title}`,
    wide: true,
    body: form,
    footer: (closeFn) => [
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onClick: () => closeFn() }),
      el('button', { class: 'btn btn-primary', type: 'submit', form: 'offer-form',
        html: `${icon('award')}${existing ? 'Save changes' : 'Create draft'}` }),
    ],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = form.querySelector('#offer-error');
    errBox.innerHTML = '';
    const btn = document.querySelector('button[form=offer-form]');
    const restore = busy(btn, 'Saving…');
    const payload = {
      applicationId: application.id,
      positionTitle: form.positionTitle.value,
      employmentType: form.employmentType.value,
      department: form.department.value,
      location: form.location.value,
      compensation: form.compensation.value,
      reportingTo: form.reportingTo.value,
      startDate: form.startDate.value,
      expiresOn: form.expiresOn.value,
      extraTerms: form.extraTerms.value,
    };
    try {
      if (existing) await api.patch(`/api/offers/${existing.id}`, payload);
      else await api.post('/api/offers', payload);
      close();
      toast(existing ? 'Offer updated.' : 'Offer drafted. Send it when you are ready.', 'good');
      reload();
    } catch (err) {
      restore();
      errBox.append(el('div', { class: 'alert alert-error' }, [
        el('span', { html: icon('alert'), style: 'line-height:0' }),
        el('span', { text: err instanceof ApiError ? err.message : 'Could not save the offer.' }),
      ]));
    }
  });
}

function sendOffer(offer, reload) {
  modal({
    title: 'Send this offer letter?',
    subtitle: offer.candidate ? `${offer.candidate.fullName} · ${offer.candidate.email}` : undefined,
    body: el('div', { class: 'stack' }, [
      el('p', { class: 'muted', text: 'The candidate gets the full letter by email with a private link to accept or decline. The application moves to "Offer sent".' }),
      el('div', { class: 'alert alert-info' }, [
        el('span', { html: icon('info'), style: 'line-height:0' }),
        el('span', { text: 'Without SMTP configured the letter is held in the Mail outbox — you can still copy the link and send it yourself.' }),
      ]),
    ]),
    footer: (close) => [
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Not yet', onClick: () => close() }),
      el('button', {
        class: 'btn btn-primary', type: 'button', html: `${icon('send')}Send offer letter`,
        onClick: async (e) => {
          const restore = busy(e.currentTarget, 'Sending…');
          try {
            const res = await api.post(`/api/offers/${offer.id}/send`);
            close();
            toast(res.emailDelivered ? 'Offer letter emailed.' : 'Offer issued and queued in the outbox.', 'good', 5200);
            reload();
          } catch (err) {
            restore();
            toast(err.message, 'error');
          }
        },
      }),
    ],
  });
}

/* ── Roles ──────────────────────────────────────────────────────────────── */

let showArchivedRoles = false;

async function viewRoles() {
  renderLoading();
  const { jobs, archivedCount } = await api.get(`/api/jobs?all=1${showArchivedRoles ? '&archived=1' : ''}`);

  const live = jobs.filter((j) => !j.archived);
  const archived = jobs.filter((j) => j.archived);
  const openings = live.filter((j) => j.status === 'open').reduce((n, j) => n + j.openings, 0);

  setHeader({
    title: 'Roles',
    sub: live.length
      ? `${openings} opening${openings === 1 ? '' : 's'} across ${live.filter((j) => j.status === 'open').length} open role${live.filter((j) => j.status === 'open').length === 1 ? '' : 's'}`
      : 'No roles posted yet',
    actions: [
      archivedCount ? el('button', {
        class: 'btn btn-ghost', type: 'button',
        text: showArchivedRoles ? 'Hide archived' : `Show archived (${archivedCount})`,
        onClick: () => { showArchivedRoles = !showArchivedRoles; viewRoles(); },
      }) : null,
      el('button', { class: 'btn btn-primary', type: 'button', html: `${icon('plus')}New role`, onClick: () => openRoleForm(null) }),
    ].filter(Boolean),
  });

  const table = (rows, { isArchive = false } = {}) => el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data' }, [
      el('thead', [el('tr', [
        el('th', { text: 'Role' }), el('th', { text: 'Engagement' }), el('th', { text: 'Status' }),
        el('th', { text: 'Openings' }), el('th', { text: 'Applications' }), el('th', { text: 'Questions' }), el('th', { text: '' }),
      ])]),
      el('tbody', rows.map((j) => el('tr', { style: isArchive ? 'opacity:.72' : '' }, [
        el('td', [
          el('div', { class: 'strong', text: j.title }),
          el('div', { class: 'tiny muted mono', text: j.code }),
        ]),
        el('td', { class: 'tiny', text: j.employmentType }),
        el('td', [el('span', {
          html: pill(isArchive ? 'archived' : j.status,
            isArchive ? 'muted' : j.status === 'open' ? 'good' : j.status === 'draft' ? 'warn' : 'muted'),
        })]),
        el('td', { text: String(j.openings) }),
        el('td', [j.applicationCount
          ? el('button', { class: 'linkish', style: 'font-size:14px', type: 'button', text: String(j.applicationCount),
              onClick: () => go(`/applications?jobId=${j.id}`) })
          : el('span', { class: 'muted', text: '0' })]),
        el('td', { class: 'tiny muted', text: String(j.questionCount) }),
        el('td', [el('div', { class: 'row', style: 'gap:6px;justify-content:flex-end' }, isArchive ? [
          el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', text: 'Restore',
            onClick: async () => {
              await api.post(`/api/jobs/${j.id}/restore`);
              toast(`${j.title} is back on the board, closed to new applications.`, 'good');
              viewRoles();
            },
          }),
        ] : [
          el('button', { class: 'btn btn-quiet btn-sm', type: 'button', html: icon('edit'), title: 'Edit', onClick: () => openRoleForm(j) }),
          el('button', {
            class: 'btn btn-quiet btn-sm', type: 'button', html: icon('trash'),
            title: j.applicationCount ? 'Archive' : 'Delete',
            onClick: async () => {
              if (!await confirmDialog({
                title: j.applicationCount ? `Archive "${j.title}"?` : `Delete "${j.title}"?`,
                message: j.applicationCount
                  ? `It comes off the roles section and candidates stop seeing it. The ${j.applicationCount} application${j.applicationCount === 1 ? '' : 's'} already in are untouched and stay reviewable, and you can restore the role at any time.`
                  : 'Nobody has applied, so this role is deleted outright.',
                confirmLabel: j.applicationCount ? 'Archive role' : 'Delete role', danger: true,
              })) return;
              const res = await api.del(`/api/jobs/${j.id}`);
              toast(res.message || 'Role removed.', 'good');
              viewRoles();
            },
          }),
        ])]),
      ]))),
    ]),
  ]);

  render(el('div', { class: 'stack' }, [
    el('div', { class: 'card' }, [
      live.length ? table(live) : emptyState({
        iconName: 'briefcase', title: 'No roles on the board',
        message: 'Nothing is shown to candidates until you post a role.',
        action: el('button', { class: 'btn btn-primary', style: 'margin-top:16px', type: 'button',
          text: 'Post the first role', onClick: () => openRoleForm(null) }),
      }),
    ]),

    showArchivedRoles && archived.length ? el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { class: 'grow', text: 'Archived' }),
        el('span', { class: 'tiny muted', text: 'Off the board and hidden from candidates. Their applications are still reviewable.' }),
      ]),
      table(archived, { isArchive: true }),
    ]) : null,
  ]));
}

function openRoleForm(job) {
  const form = el('form', { class: 'stack', id: 'role-form', novalidate: true }, [
    el('div', { class: 'field' }, [
      el('label', { for: 'rl-title', text: 'Title' }),
      el('input', { class: 'input', id: 'rl-title', name: 'title', required: true, value: job?.title || '', placeholder: 'Machine Learning Intern' }),
    ]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'rl-type', text: 'Engagement' }),
        el('select', { class: 'select', id: 'rl-type', name: 'employmentType' },
          ['Internship', 'Full-time', 'Part-time', 'Contract', 'Research Fellowship'].map((t) =>
            el('option', { value: t, text: t, selected: job?.employmentType === t }))),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'rl-status', text: 'Status' }),
        el('select', { class: 'select', id: 'rl-status', name: 'status' },
          [['open', 'Open — accepting applications'], ['draft', 'Draft — hidden'], ['closed', 'Closed']].map(([v, t]) =>
            el('option', { value: v, text: t, selected: (job?.status || 'open') === v }))),
      ]),
    ]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'rl-dept', text: 'Team' }),
        el('input', { class: 'input', id: 'rl-dept', name: 'department', value: job?.department || 'DGU AI Cell' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'rl-loc', text: 'Location' }),
        el('input', { class: 'input', id: 'rl-loc', name: 'location', value: job?.location || 'Dehradun, IN (hybrid)' }),
      ]),
    ]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'rl-stipend', text: 'Compensation shown to candidates' }),
        el('input', { class: 'input', id: 'rl-stipend', name: 'stipend', value: job?.stipend || '', placeholder: '₹15,000 / month' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'rl-openings', text: 'Openings' }),
        el('input', { class: 'input', id: 'rl-openings', name: 'openings', type: 'number', min: '1', max: '500', value: String(job?.openings || 1) }),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'rl-interview', text: 'When candidates record their interview' }),
      el('select', { class: 'select', id: 'rl-interview', name: 'interviewMode' }, [
        el('option', { value: 'at_application', text: 'As part of applying — they finish in one sitting',
          selected: (job?.interviewMode || 'at_application') === 'at_application' }),
        el('option', { value: 'after_screening', text: 'After you screen them — you unlock it by hand',
          selected: job?.interviewMode === 'after_screening' }),
      ]),
      el('span', { class: 'field-hint', text: 'Recording at application time gets you more completed interviews; screening first means you only listen to people you already like on paper.' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'rl-summary', text: 'One-line summary' }),
      el('input', { class: 'input', id: 'rl-summary', name: 'summary', maxlength: '400', value: job?.summary || '' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'rl-desc', text: 'Full description' }),
      el('textarea', { class: 'textarea', id: 'rl-desc', name: 'description', rows: '9', value: job?.description || '' }),
      el('span', { class: 'field-hint', text: 'Plain text. Line breaks are kept as you type them.' }),
    ]),
    el('div', { id: 'role-error' }),
  ]);

  const { close } = modal({
    title: job ? `Edit — ${job.title}` : 'New role',
    wide: true,
    body: form,
    footer: (closeFn) => [
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onClick: () => closeFn() }),
      el('button', { class: 'btn btn-primary', type: 'submit', form: 'role-form', text: job ? 'Save role' : 'Create role' }),
    ],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = form.querySelector('#role-error');
    errBox.innerHTML = '';
    const restore = busy(document.querySelector('button[form=role-form]'), 'Saving…');
    const payload = {
      title: form.title.value, employmentType: form.employmentType.value, status: form.status.value,
      department: form.department.value, location: form.location.value, stipend: form.stipend.value,
      openings: Number(form.openings.value), summary: form.summary.value, description: form.description.value,
      interviewMode: form.interviewMode.value,
    };
    try {
      if (job) await api.patch(`/api/jobs/${job.id}`, payload);
      else await api.post('/api/jobs', payload);
      close();
      toast(job ? 'Role updated.' : 'Role created.', 'good');
      viewRoles();
    } catch (err) {
      restore();
      errBox.append(el('div', { class: 'alert alert-error' }, [
        el('span', { html: icon('alert'), style: 'line-height:0' }),
        el('span', { text: err.message }),
      ]));
    }
  });
}

/* ── Question bank ──────────────────────────────────────────────────────── */

let questionFilter = 'all';

async function viewQuestions() {
  renderLoading();
  const [{ questions }, { jobs }] = await Promise.all([
    api.get('/api/questions'),
    api.get('/api/jobs?all=1'),
  ]);

  setHeader({
    title: 'Question bank',
    sub: 'What every candidate reads and answers on camera-free audio',
    actions: [el('button', { class: 'btn btn-primary', type: 'button', html: `${icon('plus')}Add question`, onClick: () => openQuestionForm(null, jobs) })],
  });

  const shown = questions.filter((q) => {
    if (questionFilter === 'all') return true;
    if (questionFilter === 'general') return q.jobId === null;
    return String(q.jobId) === questionFilter;
  });

  const general = shown.filter((q) => q.jobId === null);
  const roleSpecific = shown.filter((q) => q.jobId !== null);

  const chip = (value, label, n) => el('button', {
    class: `chip${questionFilter === value ? ' is-active' : ''}`, type: 'button',
    html: `${esc(label)}<span class="n">${n}</span>`,
    onClick: () => { questionFilter = value; viewQuestions(); },
  });

  render(el('div', { class: 'stack' }, [
    el('div', { class: 'alert alert-violet' }, [
      el('span', { html: icon('info'), style: 'line-height:0' }),
      el('span', { html: 'Questions marked <strong>every role</strong> are asked of all candidates. Role-specific ones are added on top, for that role only. Candidates see them in the order below.' }),
    ]),

    el('div', { class: 'card card-pad' }, [
      el('div', { class: 'chip-row' }, [
        chip('all', 'All', questions.length),
        chip('general', 'Every role', questions.filter((q) => q.jobId === null).length),
        ...jobs.map((j) => chip(String(j.id), j.title, questions.filter((q) => q.jobId === j.id).length)),
      ]),
    ]),

    questionSection('Asked of every candidate', general, jobs),
    roleSpecific.length ? questionSection('Role specific', roleSpecific, jobs) : null,

    !shown.length ? el('div', { class: 'card' }, [emptyState({
      iconName: 'help', title: 'No questions here yet',
      message: 'Add a question and it shows up in the interview for matching candidates straight away.',
      action: el('button', { class: 'btn btn-primary', style: 'margin-top:16px', type: 'button', text: 'Add the first question', onClick: () => openQuestionForm(null, jobs) }),
    })]) : null,
  ]));
}

function questionSection(title, questions, jobs) {
  if (!questions.length) return null;
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'grow', text: title }),
      el('span', { class: 'tiny muted', text: `${questions.length} question${questions.length === 1 ? '' : 's'}` }),
    ]),
    el('div', { class: 'card-body stack' }, questions.map((q) => el('div', { class: 'answer-block' }, [
      el('div', { class: 'answer-head' }, [
        el('div', { class: 'spread', style: 'align-items:flex-start' }, [
          el('div', { class: 'grow' }, [
            el('div', { class: 'row-wrap', style: 'gap:6px;margin-bottom:6px' }, [
              el('span', { class: 'tag', text: q.jobTitle || 'Every role' }),
              el('span', { class: 'tag', text: `${q.thinkSeconds}s think` }),
              el('span', { class: 'tag', text: `${fmtClock(q.answerSeconds)} to answer` }),
              !q.active ? el('span', { html: pill('Retired', 'muted') }) : null,
              q.answerCount ? el('span', { class: 'tag', text: `${q.answerCount} answer${q.answerCount === 1 ? '' : 's'}` }) : null,
            ]),
            el('div', { style: 'font-weight:600;font-size:14.5px', text: q.prompt }),
            q.hint ? el('div', { class: 'tiny muted', style: 'margin-top:4px', text: `Hint: ${q.hint}` }) : null,
          ]),
          el('div', { class: 'row', style: 'gap:6px' }, [
            el('button', { class: 'btn btn-quiet btn-sm', type: 'button', html: icon('edit'), title: 'Edit', onClick: () => openQuestionForm(q, jobs) }),
            el('button', {
              class: 'btn btn-quiet btn-sm', type: 'button', html: icon('trash'), title: 'Remove',
              onClick: async () => {
                if (!await confirmDialog({
                  title: 'Remove this question?',
                  message: q.answerCount
                    ? `${q.answerCount} candidate answer(s) reference it, so it will be retired instead of deleted — those recordings stay intact.`
                    : 'Nobody has answered it, so it will be deleted outright.',
                  confirmLabel: q.answerCount ? 'Retire question' : 'Delete question', danger: true,
                })) return;
                const res = await api.del(`/api/questions/${q.id}`);
                toast(res.message || 'Question deleted.', 'good');
                viewQuestions();
              },
            }),
          ]),
        ]),
      ]),
    ]))),
  ]);
}

function openQuestionForm(question, jobs) {
  const form = el('form', { class: 'stack', id: 'q-form', novalidate: true }, [
    el('div', { class: 'field' }, [
      el('label', { for: 'q-prompt', text: 'Question' }),
      el('textarea', { class: 'textarea', id: 'q-prompt', name: 'prompt', required: true, rows: '3',
        value: question?.prompt || '', placeholder: 'Tell us about a project you finished. What broke, and how did you fix it?' }),
      el('span', { class: 'field-hint', text: 'This is read out on screen exactly as you write it. Ten characters minimum.' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'q-hint', text: 'Hint for the candidate' }),
      el('input', { class: 'input', id: 'q-hint', name: 'hint', maxlength: '400', value: question?.hint || '',
        placeholder: 'Optional nudge, e.g. "Be specific — a real bug beats a polished summary."' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'q-job', text: 'Who gets asked this' }),
      el('select', { class: 'select', id: 'q-job', name: 'jobId' }, [
        el('option', { value: 'general', text: 'Every role', selected: !question?.jobId }),
        ...jobs.map((j) => el('option', { value: String(j.id), text: `Only: ${j.title}`, selected: question?.jobId === j.id })),
      ]),
    ]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'q-think', text: 'Thinking time (seconds)' }),
        el('input', { class: 'input', id: 'q-think', name: 'thinkSeconds', type: 'number', min: '0', max: '300',
          value: String(question?.thinkSeconds ?? 30) }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'q-answer', text: 'Answer limit (seconds)' }),
        el('input', { class: 'input', id: 'q-answer', name: 'answerSeconds', type: 'number', min: '15', max: '900',
          value: String(question?.answerSeconds ?? 120) }),
      ]),
    ]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'q-pos', text: 'Order' }),
        el('input', { class: 'input', id: 'q-pos', name: 'position', type: 'number', min: '0', max: '999',
          value: String(question?.position ?? 0) }),
        el('span', { class: 'field-hint', text: 'Lower numbers come first.' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Live' }),
        el('label', { class: 'check', style: 'margin-top:9px' }, [
          el('input', { type: 'checkbox', name: 'active', checked: question ? question.active : true }),
          el('span', { text: 'Ask this question in new interviews' }),
        ]),
      ]),
    ]),
    el('div', { id: 'q-error' }),
  ]);

  const { close } = modal({
    title: question ? 'Edit question' : 'Add a question',
    wide: true,
    body: form,
    footer: (closeFn) => [
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onClick: () => closeFn() }),
      el('button', { class: 'btn btn-primary', type: 'submit', form: 'q-form', text: question ? 'Save question' : 'Add question' }),
    ],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = form.querySelector('#q-error');
    errBox.innerHTML = '';
    const restore = busy(document.querySelector('button[form=q-form]'), 'Saving…');
    const payload = {
      prompt: form.prompt.value,
      hint: form.hint.value,
      jobId: form.jobId.value === 'general' ? null : Number(form.jobId.value),
      thinkSeconds: Number(form.thinkSeconds.value),
      answerSeconds: Number(form.answerSeconds.value),
      position: Number(form.position.value),
      active: form.active.checked,
    };
    try {
      if (question) await api.patch(`/api/questions/${question.id}`, payload);
      else await api.post('/api/questions', payload);
      close();
      toast(question ? 'Question updated.' : 'Question added to the bank.', 'good');
      viewQuestions();
    } catch (err) {
      restore();
      errBox.append(el('div', { class: 'alert alert-error' }, [
        el('span', { html: icon('alert'), style: 'line-height:0' }),
        el('span', { text: err.message }),
      ]));
    }
  });
}

/* ── Offers ─────────────────────────────────────────────────────────────── */

async function viewOffers() {
  renderLoading();
  const { offers } = await api.get('/api/offers');

  setHeader({
    title: 'Offer letters',
    sub: `${offers.filter((o) => o.status === 'accepted').length} accepted · ${offers.filter((o) => o.status === 'sent').length} awaiting a reply`,
  });

  render(el('div', { class: 'card' }, [
    offers.length ? el('div', { class: 'table-wrap' }, [
      el('table', { class: 'data' }, [
        el('thead', [el('tr', [
          el('th', { text: 'Candidate' }), el('th', { text: 'Position' }), el('th', { text: 'Compensation' }),
          el('th', { text: 'Starts' }), el('th', { text: 'Status' }), el('th', { text: '' }),
        ])]),
        el('tbody', offers.map((o) => el('tr', [
          el('td', [
            el('div', { class: 'strong', text: o.candidate?.fullName || '—' }),
            el('div', { class: 'tiny muted', text: o.candidate?.email || '' }),
          ]),
          el('td', { text: o.positionTitle }),
          el('td', { class: 'tiny', text: o.compensation || '—' }),
          el('td', { class: 'tiny', text: fmtDate(o.startDate) }),
          el('td', [
            el('span', { html: pill(o.status, o.status === 'accepted' ? 'good' : o.status === 'declined' || o.status === 'revoked' ? 'bad' : o.status === 'sent' ? 'action' : 'neutral') }),
            o.declineReason ? el('div', { class: 'tiny muted', style: 'margin-top:4px', text: o.declineReason }) : null,
          ]),
          el('td', [el('div', { class: 'row', style: 'gap:6px;justify-content:flex-end' }, [
            el('button', { class: 'btn btn-quiet btn-sm', type: 'button', text: 'Copy link',
              onClick: async () => toast(await copyText(o.link) ? 'Link copied.' : 'Could not copy.', 'good') }),
            el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Open application',
              onClick: () => go(`/applications/${o.applicationId}`) }),
          ])]),
        ]))),
      ]),
    ]) : emptyState({
      iconName: 'award', title: 'No offers yet',
      message: 'Approve an application and you can draft its offer letter from the application page.',
    }),
  ]));
}

/* ── Candidates ─────────────────────────────────────────────────────────── */

async function viewCandidates() {
  renderLoading();
  const search = el('input', { class: 'input input-sm', type: 'search', placeholder: 'Name or email…' });
  const results = el('div');

  const load = async () => {
    results.innerHTML = '<div class="skeleton" style="height:280px"></div>';
    const { candidates } = await api.get(`/api/admin/candidates${search.value.trim() ? `?q=${encodeURIComponent(search.value.trim())}` : ''}`);
    setHeader({ title: 'Candidates', sub: `${candidates.length} registered` });
    results.innerHTML = '';
    results.append(el('div', { class: 'card' }, [
      candidates.length ? el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data' }, [
          el('thead', [el('tr', [
            el('th', { text: 'Name' }), el('th', { text: 'Contact' }),
            el('th', { text: 'Applications' }), el('th', { text: 'Last applied' }), el('th', { text: 'Joined' }),
          ])]),
          el('tbody', candidates.map((c) => el('tr', [
            el('td', [el('div', { class: 'row', style: 'gap:10px' }, [
              el('div', { class: 'avatar', style: 'width:30px;height:30px;font-size:11.5px;border-radius:8px', text: initials(c.full_name) }),
              el('span', { class: 'strong', text: c.full_name }),
            ])]),
            el('td', { class: 'tiny' }, [
              el('div', { text: c.email }),
              c.phone ? el('div', { class: 'muted', text: c.phone }) : null,
            ]),
            el('td', { text: String(c.applications) }),
            el('td', { class: 'tiny muted', text: c.last_applied ? fmtAgo(c.last_applied) : '—' }),
            el('td', { class: 'tiny muted', text: fmtDate(c.created_at) }),
          ]))),
        ]),
      ]) : emptyState({ iconName: 'users', title: 'No candidates', message: 'Nobody matches that search.' }),
    ]));
  };

  let debounce;
  search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(load, 260); });

  render(el('div', { class: 'stack' }, [
    el('div', { class: 'card card-pad' }, [
      el('div', { class: 'search-wrap' }, [el('span', { html: icon('search') }), search]),
    ]),
    results,
  ]));
  await load();
}

/* ── Outbox ─────────────────────────────────────────────────────────────── */

async function viewOutbox() {
  renderLoading();
  const { messages, smtpConfigured } = await api.get('/api/admin/outbox');

  setHeader({ title: 'Mail outbox', sub: smtpConfigured ? 'SMTP is configured — mail goes out for real' : 'No SMTP configured — everything is held here' });

  render(el('div', { class: 'stack' }, [
    !smtpConfigured ? el('div', { class: 'alert alert-warn' }, [
      el('span', { html: icon('alert'), style: 'line-height:0' }),
      el('span', { html: 'Nothing is actually being delivered. Set <code>SMTP_HOST</code>, <code>SMTP_USER</code> and <code>SMTP_PASS</code> to send mail, or copy offer links by hand from here.' }),
    ]) : null,
    el('div', { class: 'card' }, [
      messages.length ? el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data' }, [
          el('thead', [el('tr', [
            el('th', { text: 'To' }), el('th', { text: 'Subject' }), el('th', { text: 'Kind' }),
            el('th', { text: 'Status' }), el('th', { text: 'When' }), el('th', { text: '' }),
          ])]),
          el('tbody', messages.map((m) => el('tr', [
            el('td', { class: 'tiny' }, [
              el('div', { class: 'strong', text: m.to_name || m.to_email }),
              m.to_name ? el('div', { class: 'muted', text: m.to_email }) : null,
            ]),
            el('td', { text: m.subject }),
            el('td', { class: 'tiny muted mono', text: m.kind || '—' }),
            el('td', [
              el('span', { html: pill(m.status, m.status === 'sent' ? 'good' : m.status === 'failed' ? 'bad' : 'warn') }),
              m.error ? el('div', { class: 'tiny muted', style: 'margin-top:3px', text: m.error }) : null,
            ]),
            el('td', { class: 'tiny muted nowrap', text: fmtAgo(m.created_at) }),
            el('td', [el('button', {
              class: 'btn btn-quiet btn-sm', type: 'button', text: 'Preview',
              onClick: async () => {
                const { message } = await api.get(`/api/admin/outbox/${m.id}`);
                const frame = el('iframe', {
                  style: 'width:100%;height:60vh;border:1px solid var(--line);border-radius:10px;background:#fff',
                  sandbox: '', title: 'Email preview',
                });
                modal({ title: message.subject, subtitle: `To ${message.to_email}`, wide: true, body: frame });
                frame.srcdoc = message.body_html;
              },
            })]),
          ]))),
        ]),
      ]) : emptyState({ iconName: 'mail', title: 'Outbox is empty', message: 'Notifications and offer letters show up here as they are generated.' }),
    ]),
  ]));
}

/* ── Activity ───────────────────────────────────────────────────────────── */

async function viewActivity() {
  renderLoading();
  const { activity } = await api.get('/api/admin/activity?limit=150');
  setHeader({ title: 'Activity', sub: 'Everything that has happened, newest first' });

  render(el('div', { class: 'card' }, [
    activity.length ? el('div', { class: 'card-body' }, [
      el('div', { class: 'timeline' }, activity.map((r) => el('div', { class: 'timeline-item' }, [
        el('div', { class: 'timeline-dot', html: icon('check') }),
        el('div', [
          el('div', { style: 'font-size:14px;font-weight:550', text: humanAction(r.action) }),
          el('div', { class: 'tiny muted', text: `${r.actor_name || 'System'} · ${fmtDateTime(r.created_at)}${r.detail ? ` · ${r.detail}` : ''}` }),
        ]),
      ]))),
    ]) : emptyState({ iconName: 'activity', title: 'Nothing logged yet', message: 'Actions across the platform are recorded here.' }),
  ]));
}

/* ── Routes ─────────────────────────────────────────────────────────────── */

startRouter({
  '/': viewOverview,
  '/applications': viewApplications,
  '/applications/:id': viewApplication,
  '/roles': viewRoles,
  '/questions': viewQuestions,
  '/offers': viewOffers,
  '/candidates': viewCandidates,
  '/outbox': viewOutbox,
  '/activity': viewActivity,
});
