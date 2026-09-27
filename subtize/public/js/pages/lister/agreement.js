/* #/agreement — the Subtize.ai Lister Agreement: read (English / हिंदी), e-sign, download. */
import { api } from '../../api.js';
import { emptyState } from '../../components.js';
import { pageHead } from '../../shell.js';
import { $, $$, busy, esc, fmtDate, fmtDateTime, icon, pill, showFieldError, toast } from '../../ui.js';
import { fail, setStanding, state } from './common.js';

let lang = 'en';

export async function renderAgreement({ view, isCurrent }) {
  const { agreement: a, application: app, standing } = await api.get('/api/lister/agreement');
  if (!isCurrent()) return;
  setStanding(standing);
  if (a?.commission) state.commission = a.commission;

  if (!a) {
    view.innerHTML = `${pageHead('Lister Agreement')}
      ${emptyState({ ic: 'file', title: 'Your agreement is on its way', text: standing.verified ? 'Subtize.ai has verified your business and is preparing your Lister Agreement. We will notify you when it is ready to sign.' : 'Your agreement is issued once Subtize.ai approves your lister application.' })}
      ${app ? applicationCard(app) : ''}`;
    return;
  }

  const signed = Boolean(a.listerSignedAt);
  view.innerHTML = `
    ${pageHead('Subtize.ai Lister Agreement', `Agreement <span class="mono">${esc(a.agreementId)}</span> · version ${esc(a.version)}`,
      `${pill(a.status, a.statusLabel)}
       <a class="btn btn-secondary" href="/api/lister/agreement/download" download>${icon('download', 'sm')} ${signed ? 'Download signed agreement' : 'Download copy'}</a>`)}

    ${timeline(a)}

    <div class="split mt-24 agreement-split">
      <div class="stack" style="--gap:20px">
        <article class="card agreement-doc" aria-labelledby="agr-title">
          <div class="agreement-doc-head">
            <div>
              <div class="eyebrow">Subtize.ai</div>
              <h2 id="agr-title">${lang === 'hi' ? '<span class="hi">लिस्टर अनुबंध</span>' : 'Lister Agreement'}</h2>
            </div>
            <div class="segmented" role="group" aria-label="Agreement language">
              <button type="button" data-lang="en" class="${lang === 'en' ? 'active' : ''}" aria-pressed="${lang === 'en'}">English</button>
              <button type="button" data-lang="hi" class="hi ${lang === 'hi' ? 'active' : ''}" aria-pressed="${lang === 'hi'}" lang="hi">हिंदी</button>
            </div>
          </div>
          <div id="agr-sections"></div>
          <p class="small muted agreement-note">If the English and Hindi texts differ, the English text prevails. <span class="hi" lang="hi">यदि अंग्रेज़ी और हिंदी पाठ में अंतर हो, तो अंग्रेज़ी पाठ मान्य होगा।</span></p>
        </article>
        ${a.status === 'pending_lister' ? signPanel(a) : signaturesCard(a)}
      </div>
      <aside class="stack" style="--gap:20px">
        <div class="card">
          <div class="card-head"><h3>${icon('fileCheck')} Agreement details</h3></div>
          <dl class="kv">
            <dt>Agreement ID</dt><dd class="mono">${esc(a.agreementId)}</dd>
            <dt>Verification ID</dt><dd class="mono">${esc(a.verificationId || standing.verificationId || '—')}</dd>
            <dt>Status</dt><dd>${pill(a.status, a.statusLabel)}</dd>
            <dt>Business</dt><dd>${esc(a.business || app?.businessName || '—')}</dd>
            <dt>Commission</dt><dd>${a.commission}% platform · ${100 - a.commission}% to you</dd>
            <dt>Issued</dt><dd>${esc(fmtDate(a.createdAt))}</dd>
            <dt>Signed by you</dt><dd>${a.listerSignedAt ? esc(fmtDateTime(a.listerSignedAt)) : '<span class="muted">Not yet</span>'}</dd>
            <dt>Countersigned</dt><dd>${a.adminSignedAt ? esc(fmtDateTime(a.adminSignedAt)) : '<span class="muted">Not yet</span>'}</dd>
            ${a.terminatedAt ? `<dt>Terminated</dt><dd>${esc(fmtDate(a.terminatedAt))}</dd>` : ''}
          </dl>
        </div>
        <div class="card commission-card">
          <div class="commission-figure"><span class="num">${a.commission}%</span><small>Subtize.ai</small></div>
          <div class="commission-figure you"><span class="num">${100 - a.commission}%</span><small>You</small></div>
          <p class="small soft mb-0">Of the total subscription revenue from your services each month. Members pay only the official Subtize.ai QR; your share is settled monthly.</p>
        </div>
        ${app ? applicationCard(app) : ''}
      </aside>
    </div>`;

  renderSections(view, a);
  $$('[data-lang]', view).forEach((b) => b.addEventListener('click', () => {
    lang = b.dataset.lang;
    $$('[data-lang]', view).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    $('#agr-title', view).innerHTML = lang === 'hi' ? '<span class="hi">लिस्टर अनुबंध</span>' : 'Lister Agreement';
    renderSections(view, a);
  }));

  if (a.status === 'pending_lister') wireSignPanel(view, a, app);
}

function renderSections(view, a) {
  const list = a.sections[lang] || a.sections.en;
  const host = $('#agr-sections', view);
  host.className = lang === 'hi' ? 'hi agreement-body' : 'agreement-body';
  host.setAttribute('lang', lang);
  host.innerHTML = `<ol class="clauses">${list.map((s) => {
    const key = /commission|कमीशन/i.test(s.heading) && !/settlement|निपटान/i.test(s.heading);
    return `<li class="${key ? 'clause-key' : ''}">
      <h4>${esc(s.heading)}${key ? ` <span class="pill tone-good plain">${a.commission}% ${lang === 'hi' ? 'कमीशन' : 'commission'}</span>` : ''}</h4>
      <p>${esc(s.body)}</p>
    </li>`;
  }).join('')}</ol>`;
}

function timeline(a) {
  const terminated = a.status === 'terminated';
  const steps = [
    { label: 'Issued', when: a.createdAt, done: true },
    { label: 'Signed by you', when: a.listerSignedAt, done: Boolean(a.listerSignedAt) },
    { label: 'Countersigned by Subtize.ai', when: a.adminSignedAt, done: Boolean(a.adminSignedAt) },
    terminated ? { label: 'Terminated', when: a.terminatedAt, done: true, bad: true } : { label: 'Active', when: a.status === 'active' ? a.adminSignedAt : null, done: a.status === 'active' },
  ];
  const currentIdx = steps.findIndex((s) => !s.done);
  return `<ol class="timeline" aria-label="Agreement progress">${steps.map((s, i) => `
    <li class="${s.bad ? 'bad' : s.done ? 'done' : i === currentIdx ? 'current' : ''}">
      <span class="tl-dot">${s.bad ? icon('ban', 'sm') : s.done ? icon('check', 'sm') : i + 1}</span>
      <div><b>${esc(s.label)}</b><small>${s.when && s.done ? esc(fmtDate(s.when)) : i === currentIdx ? (i === 1 ? 'Waiting for you' : 'In progress') : 'Pending'}</small></div>
    </li>`).join('')}</ol>`;
}

function applicationCard(app) {
  return `<div class="card">
    <div class="card-head"><h3>${icon('briefcase')} Your application</h3>${pill(app.status, app.statusLabel)}</div>
    <dl class="kv">
      <dt>Business</dt><dd>${esc(app.businessName)}</dd>
      <dt>Applicant</dt><dd>${esc(app.applicantName)}</dd>
      ${app.category ? `<dt>Category</dt><dd>${esc(app.category.name)}</dd>` : ''}
      <dt>City</dt><dd>${esc(app.city || '—')}</dd>
      <dt>Application</dt><dd class="mono">${esc(app.publicId)}</dd>
      <dt>Verification ID</dt><dd class="mono">${esc(app.verificationId || '—')}</dd>
      ${app.reviewedAt ? `<dt>Approved</dt><dd>${esc(fmtDate(app.reviewedAt))}</dd>` : ''}
    </dl>
  </div>`;
}

function signaturesCard(a) {
  return `<section class="card">
    <div class="card-head"><h3>${icon('signature')} Signatures</h3></div>
    <div class="grid cols-2">
      <div class="sig-box">
        <div class="eyebrow">Lister</div>
        ${a.listerSignature ? `<div class="sig-paper"><img src="${esc(a.listerSignature)}" alt="Your signature"></div>` : '<div class="sig-paper empty"></div>'}
        <b>${esc(a.listerSignedName || '—')}</b>
        <div class="small muted">${a.listerSignedAt ? `Signed ${esc(fmtDateTime(a.listerSignedAt))}` : 'Not signed'}</div>
      </div>
      <div class="sig-box">
        <div class="eyebrow">For Subtize.ai</div>
        <div class="sig-paper ${a.adminSignedAt ? 'stamp' : 'empty'}">${a.adminSignedAt ? `${icon('shield')} <span>Countersigned electronically</span>` : '<span class="muted small">Awaiting countersignature</span>'}</div>
        <b>${esc(a.adminSignedName || 'Subtize.ai')}</b>
        <div class="small muted">${a.adminSignedAt ? `Signed ${esc(fmtDateTime(a.adminSignedAt))}` : 'Usually within one working day'}</div>
      </div>
    </div>
  </section>`;
}

function signPanel(a) {
  return `<form class="card sign-panel" id="sign-panel" novalidate>
    <div class="card-head"><h3>${icon('signature')} Sign electronically</h3><span class="pill tone-warn">Action needed</span></div>
    <p class="soft">Read the agreement above in English or हिंदी. Then draw your signature, type your full legal name and accept. Your electronic signature is as binding as a handwritten one.</p>
    <div class="field">
      <div class="row between"><span class="label" id="sig-label">Your signature</span><button type="button" class="btn btn-ghost btn-sm" id="sig-clear">${icon('refresh', 'sm')} Clear</button></div>
      <div class="sig-pad-wrap" id="sig-wrap">
        <canvas id="sig-pad" class="sig-pad" aria-labelledby="sig-label" role="img"></canvas>
        <div class="sig-hint" id="sig-hint">Draw your signature here with a mouse, finger or stylus</div>
        <div class="sig-line" aria-hidden="true"></div>
      </div>
      <input type="hidden" name="signature">
    </div>
    <div class="field mt-16"><label class="req" for="sig-name">Full legal name</label>
      <input class="input" id="sig-name" name="signedName" autocomplete="name" maxlength="120" value="" placeholder="As on your verification documents">
      <div class="hint">For ${esc(a.business || 'your business')}</div></div>
    <div class="field mt-16"><label class="check accept-check"><input type="checkbox" name="accept" id="sig-accept">
      <span>I have read and accept the Subtize.ai Lister Agreement <span class="mono">${esc(a.agreementId)}</span>, including the <b>${a.commission}% platform commission</b> on the total subscription revenue from my services each month, with the remaining ${100 - a.commission}% paid to me through monthly settlement.</span></label></div>
    <button class="btn btn-primary btn-lg btn-block mt-24" type="submit">${icon('signature', 'sm')} Sign agreement</button>
  </form>`;
}

/* ── Signature pad ──────────────────────────────────────────────────────── */

function signaturePad(canvas, onChange) {
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let hasInk = false;
  let last = null;
  let strokes = [];

  const ink = () => getComputedStyle(canvas).getPropertyValue('--ink').trim() || '#03130a';
  const size = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink();
    redraw();
  };
  const redraw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(s);
  };
  const drawStroke = (pts) => {
    if (!pts.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) { ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1); }
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.lineWidth = 2.4;
    ctx.stroke();
  };
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    drawing = true;
    last = [point(e)];
    strokes.push(last);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents?.() || [e];
    for (const ev of evs) last.push(point(ev));
    redraw();
    if (!hasInk && last.length > 2) { hasInk = true; onChange(true); }
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    if (!hasInk && strokes.length) { hasInk = true; onChange(true); }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);

  const ro = new ResizeObserver(() => size());
  ro.observe(canvas);
  size();

  return {
    clear() { strokes = []; hasInk = false; redraw(); onChange(false); },
    isEmpty: () => !hasInk,
    /** PNG with transparent background and dark ink, trimmed and capped in size. */
    toDataURL() {
      const src = canvas;
      const out = document.createElement('canvas');
      const scale = Math.min(1, 900 / src.width);
      out.width = Math.round(src.width * scale);
      out.height = Math.round(src.height * scale);
      out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
  };
}

function wireSignPanel(view, a, app) {
  const form = $('#sign-panel', view);
  const hint = $('#sig-hint', form);
  const wrap = $('#sig-wrap', form);
  const pad = signaturePad($('#sig-pad', form), (inked) => { hint.hidden = inked; wrap.classList.remove('is-invalid'); });
  $('#sig-clear', form).addEventListener('click', () => pad.clear());
  const name = $('#sig-name', form);
  if (!name.value && app?.applicantName) name.placeholder = `e.g. ${app.applicantName}`;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $$('.field .error[data-auto]', form).forEach((n) => n.remove());
    if (pad.isEmpty()) {
      wrap.classList.add('is-invalid');
      toast('Draw your signature in the box before signing.', 'bad');
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const signedName = name.value.trim();
    if (signedName.length < 2) { showFieldError(form, { message: 'Type your full legal name.', details: { field: 'signedName' } }); return; }
    if (!$('#sig-accept', form).checked) { showFieldError(form, { message: `Tick the box to accept the agreement, including the ${a.commission}% platform commission.`, details: { field: 'accept' } }); return; }
    const signature = pad.toDataURL();
    await busy($('button[type=submit]', form), async () => {
      try {
        const res = await api.post('/api/lister/agreement/sign', { signedName, signature, accept: true });
        setStanding(res.standing);
        toast('Agreement signed. Subtize.ai will countersign it shortly.');
        await renderAgreement({ view, isCurrent: () => true });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        const map = { 'Full name': 'signedName', signature: 'signature', accept: 'accept' };
        const f = map[err.details?.field];
        if (f === 'signature') { wrap.classList.add('is-invalid'); fail(err); } else if (!(f && showFieldError(form, { message: err.message, details: { field: f } }))) fail(err);
      }
    });
  });
}
