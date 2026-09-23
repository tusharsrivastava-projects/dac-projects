import { api, ApiError } from './api.js';
import {
  $, busy, confirmDialog, el, emptyState, esc, fmtAgo, fmtBytes, fmtClock,
  fmtDate, fmtDateTime, icon, initials, modal, pill, toast,
} from './ui.js';
import { go, mountShell, render, renderLoading, requireUser, setHeader, setNavBadge, startRouter } from './shell.js';
import { AnswerRecorder, countdown, micErrorMessage, recordingSupported } from './recorder.js';

const user = await requireUser('candidate');

const NAV = [
  { items: [
    { label: 'Overview',      path: '/',             icon: 'home' },
    { label: 'Open roles',    path: '/roles',        icon: 'briefcase' },
    { label: 'My applications', path: '/applications', icon: 'file' },
  ] },
  { label: 'Hiring', items: [
    { label: 'Interview',     path: '/interview',    icon: 'mic' },
    { label: 'Offer letter',  path: '/offer',        icon: 'award' },
  ] },
  { label: 'Account', items: [
    { label: 'Profile',       path: '/profile',      icon: 'user' },
  ] },
];

mountShell({ user, nav: NAV, roleLabel: 'Candidate' });

/* ── State ──────────────────────────────────────────────────────────────── */
const state = { applications: [], jobs: [] };

async function loadApplications() {
  const { applications } = await api.get('/api/applications/mine');
  state.applications = applications;
  refreshBadges();
  return applications;
}

const actionable = () => state.applications.filter((a) => a.stage === 'interview');
const withOffer  = () => state.applications.filter((a) => a.offer && a.offer.status !== 'draft');

function refreshBadges() {
  const iv = actionable().length;
  const of = withOffer().filter((a) => a.stage === 'offer_sent').length;
  setNavBadge('/interview', iv || null, iv > 0);
  setNavBadge('/offer', of || null, of > 0);
}

/* ── Small pieces ───────────────────────────────────────────────────────── */

const stagePill = (a) => pill(a.stageLabel, a.stageTone);

const jobMetaTags = (job) => [job.employmentType, job.location, job.stipend]
  .filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('');

function applicationRow(a) {
  return el('div', {
    class: 'app-row',
    role: 'button', tabindex: '0',
    onClick: () => go(`/applications/${a.id}`),
    onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(`/applications/${a.id}`); } },
  }, [
    el('div', { class: 'grow', style: 'min-width:0' }, [
      el('div', { class: 'strong', text: a.job.title }),
      el('div', { class: 'tiny muted', style: 'margin-top:2px',
        text: `Applied ${fmtDate(a.createdAt)} · ${a.job.employmentType}` }),
    ]),
    el('div', { html: stagePill(a) }),
    el('div', { class: 'chev', html: icon('chevron') }),
  ]);
}

/* ── Overview ───────────────────────────────────────────────────────────── */

async function viewOverview() {
  renderLoading();
  const [apps, { jobs }] = await Promise.all([loadApplications(), api.get('/api/jobs')]);
  state.jobs = jobs;

  setHeader({
    title: `Hello, ${user.fullName.split(' ')[0]}`,
    sub: apps.length
      ? `${apps.length} application${apps.length === 1 ? '' : 's'} on the go`
      : 'Let us find you a role.',
  });

  const open = jobs.filter((j) => !j.myApplication);
  const needsInterview = actionable();
  const offerReady = withOffer().filter((a) => a.stage === 'offer_sent');

  // The single most useful thing to do right now, front and centre.
  let hero;
  if (offerReady.length) {
    const a = offerReady[0];
    hero = el('div', { class: 'hero' }, [
      el('div', { class: 'eyebrow', style: 'color:#c5a6f0', text: 'Your offer is ready' }),
      el('h2', { text: `${a.job.title} at the DGU AI Cell` }),
      el('p', { text: 'The panel approved you. Read the letter and let us know either way.' }),
      el('div', { class: 'row', style: 'margin-top:18px' }, [
        el('button', { class: 'btn btn-primary', type: 'button', html: `${icon('award')}Open my offer letter`,
          onClick: () => go(`/offer/${a.id}`) }),
      ]),
    ]);
  } else if (needsInterview.length) {
    const a = needsInterview[0];
    hero = el('div', { class: 'hero' }, [
      el('div', { class: 'eyebrow', style: 'color:#c5a6f0', text: 'Action needed' }),
      el('h2', { text: 'Your audio interview is open' }),
      el('p', { text: `Read the panel's questions for ${a.job.title} and record your answers. Around 15–20 minutes, whenever suits you.` }),
      el('div', { class: 'row', style: 'margin-top:18px' }, [
        el('button', { class: 'btn btn-primary', type: 'button', html: `${icon('mic')}Start the interview`,
          onClick: () => go(`/interview/${a.id}`) }),
      ]),
    ]);
  } else if (!apps.length && !open.length) {
    // Nothing posted yet. Saying "0 open roles" would read like a fault.
    hero = el('div', { class: 'hero' }, [
      el('div', { class: 'eyebrow', style: 'color:#c5a6f0', text: 'Nothing open yet' }),
      el('h2', { text: 'No roles are accepting applications' }),
      el('p', 'The AI Cell is not hiring at the moment. New roles open every term — this page updates the moment one is posted, so check back.'),
    ]);
  } else if (!apps.length) {
    hero = el('div', { class: 'hero' }, [
      el('div', { class: 'eyebrow', style: 'color:#c5a6f0', text: 'Getting started' }),
      el('h2', { text: 'You have not applied anywhere yet' }),
      el('p', { text: `There ${open.length === 1 ? 'is' : 'are'} ${open.length} open role${open.length === 1 ? '' : 's'} at the AI Cell right now. Applying takes a few minutes.` }),
      el('div', { class: 'row', style: 'margin-top:18px' }, [
        el('button', { class: 'btn btn-primary', type: 'button', html: `${icon('briefcase')}Browse open roles`,
          onClick: () => go('/roles') }),
      ]),
    ]);
  } else {
    hero = el('div', { class: 'hero' }, [
      el('div', { class: 'eyebrow', style: 'color:#c5a6f0', text: 'Where things stand' }),
      el('h2', { text: 'Nothing needs you right now' }),
      el('p', { text: 'Your applications are with the panel. We will email you the moment something moves — and it will show up here too.' }),
      el('div', { class: 'row', style: 'margin-top:18px' }, [
        el('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('file')}See my applications`,
          onClick: () => go('/applications') }),
      ]),
    ]);
  }

  const stat = (value, label, hint, cls = '') =>
    el('div', { class: `card stat ${cls}` }, [
      el('div', { class: 'stat-value', text: String(value) }),
      el('div', { class: 'stat-label', text: label }),
      hint ? el('div', { class: 'stat-hint', text: hint }) : null,
    ]);

  const recent = apps.slice(0, 5);

  render([
    el('div', { class: 'stack', style: 'gap:18px' }, [
      hero,
      el('div', { class: 'grid grid-4' }, [
        stat(apps.length, 'Applications', apps.length ? `Latest ${fmtAgo(apps[0].createdAt)}` : 'None yet'),
        stat(needsInterview.length, 'Interviews open', needsInterview.length ? 'Waiting on your recordings' : 'Nothing to record', needsInterview.length ? 'stat-hot' : ''),
        stat(apps.filter((a) => ['evaluation', 'approved'].includes(a.stage)).length, 'With the panel', 'Being reviewed'),
        stat(open.length, 'Roles you can apply to', 'Open right now', 'stat-accent'),
      ]),

      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { class: 'grow', text: 'Recent applications' }),
          apps.length > 5 ? el('button', { class: 'btn btn-quiet btn-sm', type: 'button', text: 'See all', onClick: () => go('/applications') }) : null,
        ]),
        recent.length
          ? el('div', recent.map(applicationRow))
          : emptyState({ iconName: 'file', title: 'No applications yet', message: 'Once you apply to a role it will show up here with its current stage.' }),
      ]),

      open.length ? el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { class: 'grow', text: 'Open roles' }),
          el('button', { class: 'btn btn-quiet btn-sm', type: 'button', text: 'View all', onClick: () => go('/roles') }),
        ]),
        el('div', { class: 'card-body' }, [
          el('div', { class: 'grid grid-2' }, open.slice(0, 2).map(jobCard)),
        ]),
      ]) : null,
    ]),
  ]);
}

/* ── Open roles ─────────────────────────────────────────────────────────── */

function jobCard(job) {
  return el('div', { class: 'card job-card' }, [
    el('div', { class: 'card-body' }, [
      el('div', { class: 'spread', style: 'align-items:flex-start' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'job-title', text: job.title }),
          el('div', { class: 'tiny muted mono', style: 'margin-top:3px', text: job.code }),
        ]),
        job.myApplication ? el('span', { html: pill('Applied', 'good') }) : null,
      ]),
      el('div', { class: 'job-meta', html: jobMetaTags(job) }),
      job.summary ? el('p', { class: 'job-summary', text: job.summary }) : null,
    ]),
    el('div', { class: 'card-foot row' }, [
      el('span', { class: 'tiny muted grow',
        text: `${job.openings} opening${job.openings === 1 ? '' : 's'} · ${job.questionCount} interview question${job.questionCount === 1 ? '' : 's'}` }),
      job.myApplication
        ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'View application',
            onClick: () => go(`/applications/${job.myApplication.id}`) })
        : el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'View & apply',
            onClick: () => go(`/roles/${job.id}`) }),
    ]),
  ]);
}

async function viewRoles() {
  renderLoading();
  const [{ jobs }] = await Promise.all([api.get('/api/jobs'), loadApplications()]);
  state.jobs = jobs;

  setHeader({ title: 'Open roles', sub: `${jobs.length} role${jobs.length === 1 ? '' : 's'} at the DGU AI Cell` });

  render(jobs.length
    ? el('div', { class: 'grid grid-2' }, jobs.map(jobCard))
    : el('div', { class: 'card' }, [emptyState({
        iconName: 'briefcase', title: 'No roles open',
        message: 'The AI Cell is not hiring at the moment. Check back — new roles open every term.',
      })]));
}

async function viewRole({ id }) {
  renderLoading(2);
  const { job } = await api.get(`/api/jobs/${id}`);

  setHeader({
    title: job.title,
    sub: `${job.code} · ${job.department}`,
    actions: [el('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('back')}All roles`, onClick: () => go('/roles') })],
  });

  const applyBtn = job.myApplication
    ? el('button', { class: 'btn btn-ghost btn-block btn-lg', type: 'button', text: 'View your application',
        onClick: () => go(`/applications/${job.myApplication.id}`) })
    : el('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', html: `${icon('send')}Apply for this role`,
        onClick: () => openApplyForm(job) });

  render(el('div', { class: 'split' }, [
    el('div', { class: 'stack' }, [
      el('div', { class: 'card card-pad' }, [
        el('div', { class: 'job-meta', style: 'margin:0 0 16px', html: jobMetaTags(job) }),
        job.summary ? el('p', { style: 'font-size:16px;color:var(--ink-2);margin-bottom:18px', text: job.summary }) : null,
        el('div', { class: 'prose', text: job.description || 'No further description was provided for this role.' }),
      ]),
    ]),
    el('div', { class: 'stack' }, [
      el('div', { class: 'card card-pad stack' }, [
        job.myApplication ? el('div', { html: pill(job.myApplication.stage.replaceAll('_', ' '), 'good') }) : null,
        applyBtn,
        el('div', { class: 'dl', style: 'margin-top:4px' }, [
          el('dt', { text: 'Openings' }),   el('dd', { text: String(job.openings) }),
          el('dt', { text: 'Engagement' }), el('dd', { text: job.employmentType }),
          el('dt', { text: 'Location' }),   el('dd', { text: job.location }),
          el('dt', { text: 'Compensation' }), el('dd', { text: job.stipend || 'Discussed at offer' }),
          el('dt', { text: 'Posted' }),     el('dd', { text: fmtDate(job.createdAt) }),
        ]),
      ]),
      el('div', { class: 'card card-pad' }, [
        el('div', { class: 'eyebrow', style: 'margin-bottom:8px', text: 'What happens next' }),
        el('p', { class: 'tiny muted', style: 'margin:0',
          text: `Apply here, and if the panel wants to hear more you will get ${job.questionCount} interview question${job.questionCount === 1 ? '' : 's'} to answer with a recording — no call to schedule.` }),
      ]),
    ]),
  ]));
}

function openApplyForm(job) {
  const form = el('form', { class: 'stack', novalidate: true, id: 'apply-form' }, [
    el('div', { class: 'field' }, [
      el('label', { for: 'ap-headline', text: 'One line about you' }),
      el('input', { class: 'input', id: 'ap-headline', name: 'headline', required: true, maxlength: '160',
        placeholder: 'Final-year CS student who has shipped two ML side projects' }),
      el('span', { class: 'field-hint', text: 'This is the first thing a reviewer reads. Make it concrete.' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'ap-skills', text: 'Skills' }),
      el('input', { class: 'input', id: 'ap-skills', name: 'skills', maxlength: '600', placeholder: 'Python, PyTorch, SQL, a bit of React' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'ap-experience', text: 'Relevant experience' }),
      el('textarea', { class: 'textarea', id: 'ap-experience', name: 'experience', maxlength: '3000', rows: '4',
        placeholder: 'Internships, coursework, open source, things you built for fun. Bullets are fine.' }),
    ]),
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'ap-portfolio', text: 'Portfolio or GitHub' }),
        el('input', { class: 'input', id: 'ap-portfolio', name: 'portfolioUrl', type: 'url', placeholder: 'https://github.com/you' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'ap-resume', text: 'Résumé link' }),
        el('input', { class: 'input', id: 'ap-resume', name: 'resumeUrl', type: 'url', placeholder: 'https://drive.google.com/…' }),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'ap-cover', text: 'Why this role?' }),
      el('textarea', { class: 'textarea', id: 'ap-cover', name: 'coverNote', required: true, maxlength: '4000', rows: '5',
        placeholder: 'What draws you to the AI Cell, and what you want to work on here.' }),
      el('span', { class: 'field-hint', text: 'At least a couple of sentences. Twenty characters minimum.' }),
    ]),
    el('div', { id: 'apply-error' }),
  ]);

  const { close } = modal({
    title: `Apply — ${job.title}`,
    subtitle: `${job.code} · ${job.employmentType} · ${job.location}`,
    wide: true,
    body: form,
    footer: (closeFn) => [
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onClick: () => closeFn() }),
      el('button', { class: 'btn btn-primary', type: 'submit', form: 'apply-form', html: `${icon('send')}Submit application` }),
    ],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = form.querySelector('#apply-error');
    errBox.innerHTML = '';

    const submitBtn = document.querySelector('button[form=apply-form]');
    const restore = busy(submitBtn, 'Submitting…');
    try {
      const { application } = await api.post('/api/applications', {
        jobId: job.id,
        headline: form.headline.value,
        skills: form.skills.value,
        experience: form.experience.value,
        portfolioUrl: form.portfolioUrl.value || undefined,
        resumeUrl: form.resumeUrl.value || undefined,
        coverNote: form.coverNote.value,
      });
      close();
      toast('Application in. We have emailed you a confirmation.', 'good');
      await loadApplications();
      go(`/applications/${application.id}`);
    } catch (err) {
      restore();
      errBox.append(el('div', { class: 'alert alert-error' }, [
        el('span', { html: icon('alert'), style: 'line-height:0' }),
        el('span', { text: err instanceof ApiError ? err.message : 'Could not submit. Try again.' }),
      ]));
    }
  });
}

/* ── My applications ────────────────────────────────────────────────────── */

async function viewApplications() {
  renderLoading();
  const apps = await loadApplications();

  setHeader({
    title: 'My applications',
    sub: apps.length ? `${apps.length} total` : '',
    actions: [el('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('briefcase')}Browse roles`, onClick: () => go('/roles') })],
  });

  render(el('div', { class: 'card' }, [
    apps.length
      ? el('div', apps.map(applicationRow))
      : emptyState({
          iconName: 'file', title: 'No applications yet',
          message: 'Apply to a role and you will be able to track every stage from here.',
          action: el('button', { class: 'btn btn-primary', style: 'margin-top:16px', type: 'button', text: 'Browse open roles', onClick: () => go('/roles') }),
        }),
  ]));
}

const TIMELINE = [
  { key: 'applied',    label: 'Application received' },
  { key: 'screening',  label: 'Being screened' },
  { key: 'interview',  label: 'Audio interview' },
  { key: 'evaluation', label: 'Panel review' },
  { key: 'approved',   label: 'Approved' },
  { key: 'offer_sent', label: 'Offer letter issued' },
];

function timelineFor(a) {
  const order = TIMELINE.map((t) => t.key);
  let reached = order.indexOf(a.stage);
  if (a.stage === 'offer_accepted' || a.stage === 'offer_declined') reached = order.length - 1;
  if (a.stage === 'rejected' || a.stage === 'withdrawn') reached = Math.max(0, order.indexOf('evaluation'));

  return el('div', { class: 'timeline' }, TIMELINE.map((step, i) => el('div', {
    class: 'timeline-item',
    style: i > reached ? 'opacity:.42' : '',
  }, [
    el('div', { class: 'timeline-dot', html: i <= reached ? icon('check') : '' }),
    el('div', [
      el('div', { class: 'strong', style: 'font-size:14px', text: step.label }),
      el('div', { class: 'tiny muted', text: i === reached ? 'Current stage' : i < reached ? 'Done' : 'Not yet' }),
    ]),
  ])));
}

async function viewApplication({ id }) {
  renderLoading(2);
  const { application: a, answers } = await api.get(`/api/applications/${id}`);

  setHeader({
    title: a.job.title,
    sub: `Applied ${fmtDate(a.createdAt)} · ${a.job.code}`,
    actions: [el('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('back')}All applications`, onClick: () => go('/applications') })],
  });

  const canWithdraw = !['rejected', 'withdrawn', 'offer_accepted', 'offer_declined'].includes(a.stage);

  const sideActions = [];
  if (a.stage === 'interview') {
    sideActions.push(el('button', { class: 'btn btn-primary btn-block', type: 'button', html: `${icon('mic')}Record your interview`, onClick: () => go(`/interview/${a.id}`) }));
  }
  if (a.offer && a.offer.status !== 'draft') {
    sideActions.push(el('button', { class: 'btn btn-primary btn-block', type: 'button', html: `${icon('award')}View offer letter`, onClick: () => go(`/offer/${a.id}`) }));
  }
  if (canWithdraw) {
    sideActions.push(el('button', {
      class: 'btn btn-danger-ghost btn-block btn-sm', type: 'button', text: 'Withdraw application',
      onClick: async () => {
        const yes = await confirmDialog({
          title: 'Withdraw this application?',
          message: 'This closes your application for the role. You will not be able to reopen it yourself.',
          confirmLabel: 'Withdraw', danger: true,
        });
        if (!yes) return;
        await api.post(`/api/applications/${a.id}/withdraw`);
        toast('Application withdrawn.');
        await loadApplications();
        go('/applications');
      },
    }));
  }

  render(el('div', { class: 'split' }, [
    el('div', { class: 'stack' }, [
      el('div', { class: 'card card-pad' }, [
        el('div', { class: 'spread', style: 'align-items:flex-start;margin-bottom:14px' }, [
          el('div', { html: stagePill(a) }),
          el('div', { class: 'tiny muted', text: `Updated ${fmtAgo(a.updatedAt)}` }),
        ]),
        el('p', { style: 'font-size:15px;color:var(--ink-2);margin:0', text: a.stageBlurb }),
        a.stage === 'rejected' && a.rejectReason
          ? el('div', { class: 'alert alert-warn', style: 'margin-top:14px' }, [
              el('span', { html: icon('info'), style: 'line-height:0' }),
              el('span', { text: a.rejectReason }),
            ])
          : null,
      ]),

      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { text: 'What you sent' })]),
        el('div', { class: 'card-body stack' }, [
          el('div', [el('div', { class: 'eyebrow', text: 'Headline' }), el('p', { style: 'margin-top:5px', text: a.headline || '—' })]),
          a.skills ? el('div', [el('div', { class: 'eyebrow', text: 'Skills' }), el('p', { style: 'margin-top:5px', text: a.skills })]) : null,
          a.experience ? el('div', [el('div', { class: 'eyebrow', text: 'Experience' }), el('div', { class: 'prose', style: 'margin-top:5px', text: a.experience })]) : null,
          el('div', [el('div', { class: 'eyebrow', text: 'Why this role' }), el('div', { class: 'prose', style: 'margin-top:5px', text: a.coverNote || '—' })]),
          (a.portfolioUrl || a.resumeUrl) ? el('div', { class: 'row-wrap' }, [
            a.portfolioUrl ? el('a', { class: 'btn btn-ghost btn-sm', href: a.portfolioUrl, target: '_blank', rel: 'noopener', text: 'Portfolio' }) : null,
            a.resumeUrl ? el('a', { class: 'btn btn-ghost btn-sm', href: a.resumeUrl, target: '_blank', rel: 'noopener', text: 'Résumé' }) : null,
          ]) : null,
        ]),
      ]),

      answers.length ? el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { class: 'grow', text: 'Your recorded answers' }),
          el('span', { class: 'tiny muted', text: `${answers.length} recording${answers.length === 1 ? '' : 's'}` }),
        ]),
        el('div', { class: 'card-body stack' }, answers.map((ans, i) => el('div', { class: 'answer-block' }, [
          el('div', { class: 'answer-head' }, [
            el('div', { class: 'eyebrow', text: `Question ${i + 1}` }),
            el('div', { style: 'margin-top:4px;font-weight:600;font-size:14.5px', text: ans.prompt }),
          ]),
          el('div', { class: 'answer-body stack-sm' }, [
            el('audio', { controls: true, preload: 'none', src: ans.audioUrl }),
            el('div', { class: 'tiny muted', text: `${fmtClock(ans.durationSeconds)} · ${fmtBytes(ans.sizeBytes)} · recorded ${fmtAgo(ans.createdAt)}` }),
          ]),
        ]))),
      ]) : null,
    ]),

    el('div', { class: 'stack' }, [
      sideActions.length ? el('div', { class: 'card card-pad stack-sm' }, sideActions) : null,
      el('div', { class: 'card card-pad' }, [
        el('div', { class: 'eyebrow', style: 'margin-bottom:14px', text: 'Progress' }),
        timelineFor(a),
      ]),
      el('div', { class: 'card card-pad' }, [
        el('div', { class: 'eyebrow', style: 'margin-bottom:10px', text: 'Role' }),
        el('div', { class: 'dl' }, [
          el('dt', { text: 'Title' }),      el('dd', { text: a.job.title }),
          el('dt', { text: 'Reference' }),  el('dd', { class: 'mono', text: a.job.code }),
          el('dt', { text: 'Engagement' }), el('dd', { text: a.job.employmentType }),
          el('dt', { text: 'Team' }),       el('dd', { text: a.job.department }),
        ]),
      ]),
    ]),
  ]));
}

/* ── Interview picker ───────────────────────────────────────────────────── */

async function viewInterviewList() {
  renderLoading();
  const apps = await loadApplications();
  const open = apps.filter((a) => a.stage === 'interview');
  const done = apps.filter((a) => a.interviewSubmittedAt);

  setHeader({ title: 'Interview', sub: open.length ? 'Ready when you are' : 'Nothing to record right now' });

  render(el('div', { class: 'stack' }, [
    open.length ? el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: 'Open interviews' })]),
      el('div', open.map((a) => el('div', { class: 'app-row', onClick: () => go(`/interview/${a.id}`) }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'strong', text: a.job.title }),
          el('div', { class: 'tiny muted', style: 'margin-top:2px',
            text: `${a.answered}/${a.questionTotal} answered · unlocked ${fmtAgo(a.interviewUnlockedAt)}` }),
        ]),
        el('span', { html: pill('Record now', 'action') }),
        el('div', { class: 'chev', html: icon('chevron') }),
      ]))),
    ]) : el('div', { class: 'card' }, [emptyState({
      iconName: 'mic', title: 'No interview open',
      message: 'When the panel wants to hear from you, the interview unlocks here and we email you.',
    })]),

    done.length ? el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: 'Already submitted' })]),
      el('div', done.map((a) => el('div', { class: 'app-row', onClick: () => go(`/applications/${a.id}`) }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'strong', text: a.job.title }),
          el('div', { class: 'tiny muted', style: 'margin-top:2px', text: `Submitted ${fmtDateTime(a.interviewSubmittedAt)}` }),
        ]),
        el('div', { html: stagePill(a) }),
        el('div', { class: 'chev', html: icon('chevron') }),
      ]))),
    ]) : null,
  ]));
}

/* ── The interview itself ───────────────────────────────────────────────── */

async function viewInterview({ id }) {
  renderLoading(2);
  const data = await api.get(`/api/interview/${id}`);
  const { application: a, questions } = data;

  setHeader({
    title: 'Audio interview',
    sub: a.job.title,
    actions: [el('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('back')}Back`, onClick: () => go(`/applications/${a.id}`) })],
  });

  if (!data.open) {
    render(el('div', { class: 'card' }, [emptyState({
      iconName: 'lock',
      title: a.interviewSubmittedAt ? 'Already submitted' : 'Interview not open',
      message: a.interviewSubmittedAt
        ? `You submitted this on ${fmtDateTime(a.interviewSubmittedAt)}. The panel is listening to your answers now.`
        : 'This interview is not open yet. We will email you the moment it is.',
      action: el('button', { class: 'btn btn-ghost', style: 'margin-top:16px', type: 'button', text: 'Back to application', onClick: () => go(`/applications/${a.id}`) }),
    })]));
    return;
  }

  if (!recordingSupported()) {
    render(el('div', { class: 'card card-pad' }, [
      el('div', { class: 'alert alert-error' }, [
        el('span', { html: icon('alert'), style: 'line-height:0' }),
        el('span', { text: 'This browser cannot record audio. Open the interview in a recent Chrome, Edge, Firefox or Safari — on a device with a microphone.' }),
      ]),
    ]));
    return;
  }

  runInterview(a, questions);
}

function runInterview(application, questions) {
  let index = questions.findIndex((q) => !q.answer);
  if (index < 0) index = 0;

  const host = el('div', { class: 'iv-shell' });
  render(host);

  const answeredCount = () => questions.filter((q) => q.answer).length;

  function paintChrome() {
    const done = answeredCount();
    const pct = Math.round((done / questions.length) * 100);
    return el('div', { class: 'stack', style: 'margin-bottom:18px' }, [
      el('div', { class: 'iv-progress' }, [
        el('span', { class: 'tiny strong nowrap', text: `${done} of ${questions.length} answered` }),
        el('div', { class: 'progress' }, [el('span', { style: `width:${pct}%` })]),
      ]),
      el('div', { class: 'q-strip' }, questions.map((q, i) => el('button', {
        class: `q-dot${q.answer ? ' is-done' : ''}${i === index ? ' is-current' : ''}`,
        type: 'button', title: `Question ${i + 1}`,
        text: String(i + 1),
        onClick: () => { index = i; paint(); },
      }))),
    ]);
  }

  /** Renders the current question's card in whatever phase it is in. */
  function paint(phase = 'ready', extra = {}) {
    const q = questions[index];
    host.innerHTML = '';
    host.append(paintChrome());

    const card = el('div', { class: 'card iv-card' });
    card.append(
      el('div', { class: 'iv-qnum', text: `Question ${index + 1} of ${questions.length}${q.scope === 'role' ? ' · role specific' : ''}` }),
      el('p', { class: 'iv-prompt', text: q.prompt }),
      q.hint ? el('div', { class: 'iv-hint', text: q.hint }) : null,
    );

    const stage = el('div', { class: 'iv-stage' });
    card.append(stage);

    if (phase === 'ready') {
      if (q.answer) {
        stage.append(
          el('div', { class: 'playback stack-sm', style: 'text-align:left' }, [
            el('div', { class: 'row' }, [
              el('span', { html: pill('Answer recorded', 'good') }),
              el('span', { class: 'tiny muted grow', text: `${fmtClock(q.answer.durationSeconds)} · ${fmtBytes(q.answer.sizeBytes)}` }),
            ]),
            el('audio', { controls: true, preload: 'none', src: `${q.answer.audioUrl}?t=${Date.now()}` }),
          ]),
          el('div', { class: 'iv-actions' }, [
            el('button', { class: 'btn btn-ghost', type: 'button', text: 'Record it again', onClick: () => startFlow(q) }),
            index < questions.length - 1
              ? el('button', { class: 'btn btn-primary', type: 'button', html: `Next question${icon('chevron')}`, onClick: () => { index += 1; paint(); } })
              : el('button', { class: 'btn btn-good', type: 'button', html: `${icon('check')}Review & submit`, onClick: reviewAndSubmit }),
          ]),
        );
      } else {
        stage.append(
          el('div', { class: 'iv-big', text: fmtClock(q.answerSeconds) }),
          el('div', { class: 'iv-note', text: `You get ${q.thinkSeconds} second${q.thinkSeconds === 1 ? '' : 's'} to think, then up to ${fmtClock(q.answerSeconds)} to answer. Recording stops on its own at the limit.` }),
          el('div', { class: 'iv-actions' }, [
            el('button', { class: 'btn btn-record', type: 'button', html: `${icon('mic')}I'm ready — start`, onClick: () => startFlow(q) }),
          ]),
        );
      }
    }

    if (phase === 'thinking') {
      stage.append(
        el('div', { class: 'eyebrow', text: 'Think about it' }),
        el('div', { class: 'iv-big', id: 'think-clock', text: String(extra.left ?? q.thinkSeconds) }),
        el('div', { class: 'iv-note', text: 'Recording starts automatically when this hits zero.' }),
        el('div', { class: 'iv-actions' }, [
          el('button', { class: 'btn btn-record', type: 'button', html: `${icon('mic')}Start recording now`, onClick: extra.onSkip }),
        ]),
      );
    }

    if (phase === 'recording') {
      stage.append(
        el('div', { class: 'row', style: 'justify-content:center;gap:9px' }, [
          el('span', { class: 'rec-dot' }),
          el('span', { class: 'eyebrow', style: 'color:var(--red-500)', text: 'Recording' }),
        ]),
        el('div', { class: 'rec-timer', id: 'rec-clock', style: 'margin-top:10px', text: '00:00' }),
        el('div', { class: 'level-meter', id: 'level', style: 'margin-top:12px' },
          Array.from({ length: 21 }, () => el('i'))),
        el('div', { class: 'iv-note', id: 'rec-note', text: `Limit ${fmtClock(q.answerSeconds)}` }),
        el('div', { class: 'iv-actions' }, [
          el('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('stop')}Stop & keep this take`, onClick: extra.onStop }),
        ]),
      );
    }

    if (phase === 'uploading') {
      stage.append(
        el('div', { class: 'row', style: 'justify-content:center;gap:10px' }, [
          el('span', { class: 'spinner', style: 'color:var(--violet-500)' }),
          el('span', { class: 'strong', text: 'Saving your answer…' }),
        ]),
      );
    }

    host.append(card);
  }

  async function startFlow(q) {
    const rec = new AnswerRecorder({ maxSeconds: q.answerSeconds });
    try {
      await rec.arm();
    } catch (err) {
      toast(micErrorMessage(err), 'error', 7000);
      paint();
      return;
    }

    // Think phase — skippable.
    let skipped = false;
    const timer = countdown(q.thinkSeconds, (left) => {
      const clock = $('#think-clock');
      if (clock) clock.textContent = String(left);
    });
    paint('thinking', { left: q.thinkSeconds, onSkip: () => { skipped = true; timer.cancel(); } });
    await timer.promise;
    if (skipped) { /* straight into recording */ }

    // Record phase.
    rec.addEventListener('tick', ({ detail }) => {
      const clock = $('#rec-clock');
      if (clock) clock.textContent = fmtClock(detail.elapsed);
      const note = $('#rec-note');
      if (note && detail.remaining <= 15) {
        note.textContent = `${Math.ceil(detail.remaining)}s left`;
        note.style.color = 'var(--red-500)';
      }
    });
    rec.addEventListener('level', ({ detail }) => {
      const meter = $('#level');
      if (!meter) return;
      const bars = meter.children;
      for (let i = 0; i < bars.length; i += 1) {
        // Centre bars react most, so it reads like a waveform rather than a bar chart.
        const weight = 1 - Math.abs(i - (bars.length - 1) / 2) / ((bars.length - 1) / 2);
        bars[i].style.height = `${4 + detail.level * 30 * (0.35 + weight * 0.65)}px`;
      }
    });
    rec.addEventListener('limit', () => toast('Time is up — we kept what you recorded.', 'info'));

    const finished = new Promise((resolve) => rec.addEventListener('complete', ({ detail }) => resolve(detail)));
    paint('recording', { onStop: () => rec.stop() });
    rec.start();

    const { blob, seconds } = await finished;
    if (!blob || blob.size < 512) {
      toast('That recording came out empty. Check your microphone and try again.', 'error', 6000);
      paint();
      return;
    }

    paint('uploading');
    const fd = new FormData();
    fd.append('audio', blob, rec.filename());
    fd.append('durationSeconds', String(Math.round(seconds * 10) / 10));

    try {
      const res = await api.post(`/api/interview/${application.id}/answers/${q.id}`, fd);
      q.answer = {
        id: res.answer.id, audioUrl: res.answer.audioUrl,
        durationSeconds: res.answer.durationSeconds, sizeBytes: res.answer.sizeBytes,
      };
      toast('Answer saved.', 'good', 2200);
      paint();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save that recording.', 'error', 6000);
      paint();
    }
  }

  function reviewAndSubmit() {
    const missing = questions.filter((q) => !q.answer);
    modal({
      title: 'Submit your interview?',
      subtitle: `${application.job.title} · ${answeredCount()} of ${questions.length} answered`,
      body: el('div', { class: 'stack' }, [
        missing.length
          ? el('div', { class: 'alert alert-warn' }, [
              el('span', { html: icon('alert'), style: 'line-height:0' }),
              el('span', { text: `Still to record: ${missing.map((q, i) => `Q${questions.indexOf(q) + 1}`).join(', ')}. Every question needs an answer before you can submit.` }),
            ])
          : el('div', { class: 'alert alert-info' }, [
              el('span', { html: icon('info'), style: 'line-height:0' }),
              el('span', { text: 'Once you submit, your recordings go to the panel and you cannot re-record. Give anything you are unsure about one more listen first.' }),
            ]),
        el('div', { class: 'stack-sm' }, questions.map((q, i) => el('div', { class: 'row', style: 'gap:10px;align-items:flex-start' }, [
          el('span', { class: `q-dot${q.answer ? ' is-done' : ''}`, style: 'cursor:default', text: String(i + 1) }),
          el('div', { class: 'grow' }, [
            el('div', { style: 'font-size:13.5px;font-weight:550', text: q.prompt }),
            el('div', { class: 'tiny muted', text: q.answer ? `Recorded · ${fmtClock(q.answer.durationSeconds)}` : 'Not recorded' }),
          ]),
        ]))),
      ]),
      footer: (close) => [
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Keep editing', onClick: () => close() }),
        el('button', {
          class: 'btn btn-good', type: 'button', disabled: missing.length > 0,
          html: `${icon('send')}Submit for evaluation`,
          onClick: async (e) => {
            const restore = busy(e.currentTarget, 'Submitting…');
            try {
              await api.post(`/api/interview/${application.id}/submit`);
              close();
              toast('Interview submitted. The panel will listen and get back to you.', 'good', 5000);
              await loadApplications();
              go(`/applications/${application.id}`);
            } catch (err) {
              restore();
              toast(err instanceof ApiError ? err.message : 'Could not submit.', 'error');
            }
          },
        }),
      ],
    });
  }

  paint();
}

/* ── Offer ──────────────────────────────────────────────────────────────── */

async function viewOfferList() {
  renderLoading();
  const apps = await loadApplications();
  const offers = apps.filter((a) => a.offer && a.offer.status !== 'draft');

  setHeader({ title: 'Offer letter', sub: offers.length ? `${offers.length} on record` : '' });

  render(el('div', { class: 'card' }, [
    offers.length
      ? el('div', offers.map((a) => el('div', { class: 'app-row', onClick: () => go(`/offer/${a.id}`) }, [
          el('div', { class: 'grow' }, [
            el('div', { class: 'strong', text: a.job.title }),
            el('div', { class: 'tiny muted', style: 'margin-top:2px', text: `Offer ${a.offer.status}` }),
          ]),
          el('div', { html: stagePill(a) }),
          el('div', { class: 'chev', html: icon('chevron') }),
        ])))
      : emptyState({
          iconName: 'award', title: 'No offer yet',
          message: 'When the panel approves you, your offer letter lands here — and in your inbox, with a link to accept or decline.',
        }),
  ]));
}

async function viewOffer({ id }) {
  renderLoading(2);
  const { application: a } = await api.get(`/api/applications/${id}`);
  if (!a.offer || a.offer.status === 'draft') {
    setHeader({ title: 'Offer letter' });
    render(el('div', { class: 'card' }, [emptyState({
      iconName: 'award', title: 'No offer on this application yet',
      message: 'We will email you the moment it is issued.',
      action: el('button', { class: 'btn btn-ghost', style: 'margin-top:16px', type: 'button', text: 'Back to application', onClick: () => go(`/applications/${id}`) }),
    })]));
    return;
  }

  const { offer } = await api.get(`/api/offers/${a.offer.id}`);
  setHeader({
    title: 'Your offer letter',
    sub: `${offer.positionTitle} · ${offer.status}`,
    actions: [el('a', { class: 'btn btn-primary', href: offer.link, target: '_blank', rel: 'noopener', html: `${icon('award')}Open full letter` })],
  });

  render(el('div', { class: 'split' }, [
    el('div', { class: 'card card-pad stack' }, [
      el('div', { html: pill(`Offer ${offer.status}`, offer.status === 'accepted' ? 'good' : offer.status === 'declined' ? 'muted' : 'action') }),
      el('h2', { text: offer.positionTitle }),
      el('div', { class: 'dl' }, [
        el('dt', { text: 'Team' }),         el('dd', { text: offer.department || '—' }),
        el('dt', { text: 'Engagement' }),   el('dd', { text: offer.employmentType || '—' }),
        el('dt', { text: 'Location' }),     el('dd', { text: offer.location || '—' }),
        el('dt', { text: 'Compensation' }), el('dd', { text: offer.compensation || '—' }),
        el('dt', { text: 'Start date' }),   el('dd', { text: fmtDate(offer.startDate) }),
        el('dt', { text: 'Reporting to' }), el('dd', { text: offer.reportingTo || '—' }),
        offer.expiresOn ? el('dt', { text: 'Valid until' }) : null,
        offer.expiresOn ? el('dd', { text: fmtDate(offer.expiresOn) }) : null,
      ]),
      offer.extraTerms ? el('div', [
        el('div', { class: 'eyebrow', style: 'margin:6px 0 6px', text: 'Additional terms' }),
        el('div', { class: 'prose', text: offer.extraTerms }),
      ]) : null,
    ]),
    el('div', { class: 'stack' }, [
      el('div', { class: 'card card-pad stack-sm' }, [
        el('div', { class: 'eyebrow', text: 'Respond' }),
        el('p', { class: 'tiny muted', style: 'margin:4px 0 8px',
          text: offer.status === 'sent'
            ? 'Open the full letter to read every term and accept or decline.'
            : `You ${offer.status} this offer on ${fmtDate(offer.acceptedAt || offer.declinedAt)}.` }),
        el('a', { class: 'btn btn-primary btn-block', href: offer.link, target: '_blank', rel: 'noopener',
          text: offer.status === 'sent' ? 'Read & respond' : 'View letter' }),
      ]),
      el('div', { class: 'card card-pad' }, [
        el('div', { class: 'eyebrow', style: 'margin-bottom:8px', text: 'Your link' }),
        el('div', { class: 'mono', style: 'word-break:break-all;color:var(--ink-3)', text: offer.link }),
        el('button', {
          class: 'btn btn-ghost btn-sm btn-block', style: 'margin-top:10px', type: 'button', text: 'Copy link',
          onClick: async (e) => {
            const { copyText } = await import('./ui.js');
            toast(await copyText(offer.link) ? 'Link copied.' : 'Could not copy — select it by hand.', 'good');
          },
        }),
      ]),
    ]),
  ]));
}

/* ── Profile ────────────────────────────────────────────────────────────── */

async function viewProfile() {
  setHeader({ title: 'Profile', sub: 'Your details and password' });

  const detailsForm = el('form', { class: 'stack' }, [
    el('div', { class: 'form-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'pf-name', text: 'Full name' }),
        el('input', { class: 'input', id: 'pf-name', name: 'fullName', required: true, value: user.fullName }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'pf-phone', text: 'Phone' }),
        el('input', { class: 'input', id: 'pf-phone', name: 'phone', value: user.phone || '' }),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Email' }),
      el('input', { class: 'input', value: user.email, disabled: true }),
      el('span', { class: 'field-hint', text: 'Your email is your sign-in. Contact the AI Cell office to change it.' }),
    ]),
    el('div', [el('button', { class: 'btn btn-primary', type: 'submit', text: 'Save changes' })]),
  ]);

  detailsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const restore = busy(e.target.querySelector('button[type=submit]'), 'Saving…');
    try {
      await api.patch('/api/auth/me', { fullName: detailsForm.fullName.value, phone: detailsForm.phone.value });
      user.fullName = detailsForm.fullName.value.trim();
      user.phone = detailsForm.phone.value.trim();
      $('#side-name').textContent = user.fullName;
      $('#side-avatar').textContent = initials(user.fullName);
      toast('Profile updated.', 'good');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      restore();
    }
  });

  const passForm = el('form', { class: 'stack' }, [
    el('div', { class: 'field' }, [
      el('label', { for: 'pf-cur', text: 'Current password' }),
      el('input', { class: 'input', id: 'pf-cur', name: 'currentPassword', type: 'password', required: true, autocomplete: 'current-password' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'pf-new', text: 'New password' }),
      el('input', { class: 'input', id: 'pf-new', name: 'newPassword', type: 'password', required: true, autocomplete: 'new-password' }),
      el('span', { class: 'field-hint', text: 'Eight characters or more, with at least one letter and one number. Signing out every other device.' }),
    ]),
    el('div', [el('button', { class: 'btn btn-ghost', type: 'submit', text: 'Change password' })]),
  ]);

  passForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const restore = busy(e.target.querySelector('button[type=submit]'), 'Updating…');
    try {
      await api.post('/api/auth/me/password', {
        currentPassword: passForm.currentPassword.value,
        newPassword: passForm.newPassword.value,
      });
      passForm.reset();
      toast('Password changed.', 'good');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      restore();
    }
  });

  render(el('div', { class: 'grid grid-2' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: 'Your details' })]),
      el('div', { class: 'card-body' }, [detailsForm]),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: 'Password' })]),
      el('div', { class: 'card-body' }, [passForm]),
    ]),
  ]));
}

/* ── Routes ─────────────────────────────────────────────────────────────── */

startRouter({
  '/': viewOverview,
  '/roles': viewRoles,
  '/roles/:id': viewRole,
  '/applications': viewApplications,
  '/applications/:id': viewApplication,
  '/interview': viewInterviewList,
  '/interview/:id': viewInterview,
  '/offer': viewOfferList,
  '/offer/:id': viewOffer,
  '/profile': viewProfile,
});
