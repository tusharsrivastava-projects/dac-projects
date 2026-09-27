/*
 * Become a Lister: the pitch, then the application. Guests are sent to sign up;
 * signed-in people either apply (multipart POST) or track the application they
 * already have, and resubmit corrections when an admin asks for them.
 */
import { api } from '../api.js';
import { mountSite } from '../site.js';
import { $, $$, esc, fmtDate, icon, pill, showFieldError, toast } from '../ui.js';

const root = $('#apply-root');
const MAX_MB = 5;
const DOC_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const GOV_ID_TYPES = ['GSTIN', 'Udyam Registration', 'Shop & Establishment licence', 'PAN', 'FSSAI'];
const ADDRESS_TYPES = ['Electricity bill', 'Rent agreement', 'Property tax receipt', 'Aadhaar (business address)'];
const DOC_KIND = { address_proof: 'Address proof', id_proof: 'Business verification', business_doc: 'Business document', payment_qr: 'Payout QR' };

let meta = { categories: [], platform: {} };
let user = null;

/* ── Static marketing content ───────────────────────────────────────────── */

$('#kicker').insertAdjacentHTML('afterbegin', icon('store'));
$('#lock-ic').outerHTML = icon('lock');
$('#why').innerHTML = [
  ['compass', 'Found by members nearby', 'Your services appear in AI and voice search for people close to you, with your open days, hours and price.'],
  ['wallet', 'Paid upfront, verified', 'Members pay Subtize.ai before a plan starts and an admin verifies every payment. No chasing dues or cash.'],
  ['calendar', 'Monthly settlements', 'Your share of subscription revenue is settled to your bank every month, with a clear statement.'],
  ['qr', 'Check-in by card', 'Scan a member\'s digital card to confirm their plan and record a visit. Usage is tracked for you.'],
  ['lock', 'Your details stay private', 'Members see your service, never your name, phone or bank details. Payments and cancellations go through Subtize.ai.'],
  ['chart', 'One dashboard', 'Subscribers, usage, revenue and settlements for every service you list, in one place.'],
].map(([ic, t, d]) => `<article class="feature"><div class="icon-tile">${icon(ic)}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join('');

$('#pay-points').innerHTML = [
  ['checkCircle', 'Only on verified payments', 'Commission applies to subscription payments Subtize.ai has verified for your services.'],
  ['calendar', 'Settled monthly', 'Your share is paid once a month to the bank account or UPI ID verified in your application.'],
  ['receipt', 'Every line visible', 'Your lister dashboard shows gross revenue, commission and payout for each month.'],
].map(([ic, t, d]) => `<li>${icon(ic)}<div><b>${esc(t)}</b><span>${esc(d)}</span></div></li>`).join('');

$('#process').innerHTML = [
  ['Apply', 'Fill in your business, verification and bank details and upload your documents.'],
  ['Review', 'A Subtize.ai admin reviews your application and may ask you to correct something.'],
  ['Verification', 'We verify your documents and business address, then issue your verification ID.'],
  ['Agreement e-sign', 'Sign the Lister Agreement online, available in English and Hindi. Subtize.ai countersigns it.'],
  ['Publish services', 'Add your services with days, hours, usage policy and price. Each listing is reviewed before it goes live.'],
].map(([t, d], i) => `<li><div class="num">${i + 1}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join('');

$('#docs').innerHTML = [
  ['fileCheck', 'Business verification', 'One of: GSTIN, Udyam Registration, Shop & Establishment licence, PAN, or FSSAI licence for food businesses. The number and a copy of the document.'],
  ['home', 'Proof of business address', 'Electricity bill, rent agreement, property tax receipt, or Aadhaar showing the business address. The document number and a copy.'],
  ['wallet', 'Bank account for settlements', 'Account holder name, account number and IFSC. A settlement UPI ID is optional.'],
  ['layers', 'Optional extras', 'Photos, licences, certificates or a menu (up to 4 files), and your own payout QR, which is used only for settlements.'],
].map(([ic, t, d]) => `<li>${icon(ic)}<div><b>${esc(t)}</b><span>${esc(d)}</span></div></li>`).join('');

/* ── Form pieces ────────────────────────────────────────────────────────── */

const reqCls = (req) => (req ? 'req' : '');
const input = (name, label, { type = 'text', req = true, full = false, hint = '', value = '', attrs = '', placeholder = '' } = {}) => `
  <div class="field ${full ? 'full' : ''}"><label for="a-${name}" class="${reqCls(req)}">${label}</label>
    <input class="input" id="a-${name}" name="${name}" type="${type}" value="${esc(value ?? '')}" ${req ? 'required' : ''} ${placeholder ? `placeholder="${esc(placeholder)}"` : ''} ${attrs}>
    ${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
const textarea = (name, label, { req = true, hint = '', value = '', attrs = '' } = {}) => `
  <div class="field full"><label for="a-${name}" class="${reqCls(req)}">${label}</label>
    <textarea class="textarea" id="a-${name}" name="${name}" ${req ? 'required' : ''} ${attrs}>${esc(value ?? '')}</textarea>
    ${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
const select = (name, label, options, { req = true, value = '', hint = '', placeholder = 'Choose…' } = {}) => `
  <div class="field"><label for="a-${name}" class="${reqCls(req)}">${label}</label>
    <select class="select" id="a-${name}" name="${name}" ${req ? 'required' : ''}>
      <option value="">${placeholder}</option>
      ${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}
    </select>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
const fileField = (name, label, { req = false, multiple = false, images = false, hint = '' } = {}) => `
  <div class="field file-field full" data-file="${name}">
    <span class="label ${reqCls(req)}" id="lbl-${name}">${label}</span>
    <label class="dropzone" for="a-${name}">
      <span class="icon-tile">${icon('upload')}</span>
      <span style="min-width:0"><b data-fname>${multiple ? 'Choose files' : 'Choose a file'} or drop ${multiple ? 'them' : 'it'} here</b>
      <small>${hint || (images ? 'PNG, JPG or WebP' : 'PDF, PNG, JPG or WebP')}, up to ${MAX_MB} MB${multiple ? ' each, up to 4 files' : ''}</small></span>
      <input type="file" id="a-${name}" name="${name}" ${multiple ? 'multiple' : ''} accept="${(images ? IMG_TYPES : DOC_TYPES).join(',')}" aria-labelledby="lbl-${name}" data-images="${images ? 1 : 0}">
    </label>
  </div>`;
const section = (n, title, note, body) => `
  <fieldset class="form-section"><legend><span class="n">${n}</span>${title}</legend>
    ${note ? `<p class="section-note">${note}</p>` : ''}<div class="form-grid">${body}</div></fieldset>`;

const keepHint = (masked) => (masked ? `Currently <span class="mono">${esc(masked)}</span>. Leave blank to keep it.` : '');

/**
 * The application form. `mode` 'new' posts a full application; 'edit' sends
 * only what changed (PUT /mine) after an admin asked for corrections.
 */
function appForm({ mode = 'new', app = null, prefill = {} } = {}) {
  const edit = mode === 'edit';
  const v = (k) => (app ? app[k] : prefill[k]) ?? '';
  const req = !edit;
  const cats = meta.categories.map((c) => [c.slug, c.name]);
  const catVal = app?.category?.slug || prefill.category || '';
  const commission = meta.platform?.commissionPercent ?? 20;
  const payout = 100 - commission;
  return `
  <form class="${edit ? 'edit-form' : 'apply-card'}" id="app-form" novalidate>
    ${edit ? `<div class="panel-note warn mb-24">${icon('edit')}<div><strong>Update only what needs fixing.</strong> Fields you leave unchanged, and blank sensitive fields, keep their current values. Upload a corrected document if you were asked for one.</div></div>` : ''}
    ${section(1, 'Applicant', 'The person responsible for this business on Subtize.ai.', `
      ${input('applicantName', 'Full name', { req, value: v('applicantName'), attrs: 'autocomplete="name" maxlength="120"' })}
      ${input('phone', 'Phone', { req, type: 'tel', value: v('phone'), attrs: 'autocomplete="tel" inputmode="tel"', placeholder: '+91 98765 43210' })}
      ${input('email', 'Business email', { req, type: 'email', full: true, value: v('email'), attrs: 'autocomplete="email" inputmode="email"', hint: 'We send application updates here.' })}`)}
    ${section(2, 'Business', 'What members will subscribe to. Your business name is never shown to members.', `
      ${input('businessName', 'Business name', { req, value: v('businessName'), attrs: 'maxlength="160" autocomplete="organization"' })}
      ${select('category', 'Service category', cats, { req, value: catVal })}
      ${textarea('businessAddress', 'Business address', { req, value: v('businessAddress'), attrs: 'rows="2" maxlength="400" autocomplete="street-address"', hint: 'Where the service runs, or your base if you visit members.' })}
      ${input('city', 'City', { req, value: v('city') || meta.platform?.defaultCity || 'Dehradun', attrs: 'maxlength="80" autocomplete="address-level2"' })}
      <div></div>
      ${textarea('serviceDescription', 'Describe your services', { req, value: v('serviceDescription'), attrs: 'rows="4" maxlength="3000"', hint: 'At least 30 characters. Batches, timings, what a monthly plan includes, who it is for.' })}`)}
    ${section(3, 'Verification', 'Used to verify that your business is genuine. Numbers are encrypted and seen only by Subtize.ai admins.', `
      ${select('govIdType', 'Business verification type', GOV_ID_TYPES.map((t) => [t, t]), { req, value: v('govIdType') })}
      ${input('govIdNumber', 'Verification number', { req, value: '', attrs: 'maxlength="40" autocomplete="off" spellcheck="false"', hint: edit ? keepHint(app.govIdNumber) : 'As printed on the document.' })}
      ${select('addressProofType', 'Address proof type', ADDRESS_TYPES.map((t) => [t, t]), { req, value: v('addressProofType') })}
      ${input('addressProofId', 'Address proof number', { req, value: '', attrs: 'maxlength="40" autocomplete="off" spellcheck="false"', hint: edit ? keepHint(app.addressProofId) : 'Consumer number, agreement number, property ID or Aadhaar number.' })}`)}
    ${section(4, 'Banking &amp; settlement', `Your ${payout}% share is settled here every month. Encrypted and seen only by Subtize.ai admins.`, `
      ${input('bankAccountName', 'Account holder name', { req, value: v('bankAccountName'), attrs: 'maxlength="120" autocomplete="off"' })}
      ${input('bankAccountNumber', 'Bank account number', { req, value: '', attrs: 'inputmode="numeric" maxlength="20" autocomplete="off"', hint: edit ? keepHint(app.bankAccountNumber) : 'Digits only.' })}
      ${input('bankIfsc', 'IFSC', { req, value: v('bankIfsc'), attrs: 'maxlength="11" autocomplete="off" spellcheck="false" style="text-transform:uppercase"', placeholder: 'SBIN0001234' })}
      ${input('bankName', 'Bank name', { req: false, value: v('bankName'), attrs: 'maxlength="80"' })}
      ${input('settlementUpi', 'Settlement UPI ID <span class="muted">(optional)</span>', { req: false, full: true, value: '', attrs: 'maxlength="60" autocomplete="off" spellcheck="false"', placeholder: 'yourname@okbank', hint: edit ? keepHint(app.settlementUpi) || 'Optional.' : 'Optional. Used for settlements if you prefer UPI.' })}`)}
    ${section(5, 'Documents', edit ? 'Upload only new or corrected documents. Existing uploads stay on file.' : 'Clear photos or scans. Every document is stored privately.', `
      ${fileField('addressProof', 'Address proof document', { req })}
      ${fileField('idProof', 'Business verification document', { req, hint: 'GST certificate, Udyam certificate, licence, PAN or FSSAI licence' })}
      ${fileField('businessDocs', 'Other business documents <span class="muted">(optional)</span>', { multiple: true, hint: 'Photos, licences, certificates or a menu' })}
      ${fileField('paymentQr', 'Your payout QR <span class="muted">(optional)</span>', { images: true, hint: 'Your own UPI QR for settlements. Used only for payouts to you and never shown to members' })}`)}
    ${edit ? '' : `
    <fieldset class="form-section"><legend><span class="n">6</span>Agreement</legend>
      <div class="agree-box">
        <blockquote>“Subtize.ai will retain ${commission}% of the total subscription revenue generated through the Lister's services on the platform during a month. The remaining ${payout}% will be payable to the Lister according to the applicable monthly settlement process.”</blockquote>
        <div class="field"><label class="check" for="a-agreementAck"><input type="checkbox" id="a-agreementAck" name="agreementAck" value="true">
          <span>I confirm the details above are correct, and I have read and accept the Lister Agreement terms, including the ${commission}% platform commission and ${payout}% monthly settlement. I will sign the full agreement (English and Hindi) after approval.</span></label></div>
        <p class="muted small mt-8" style="margin-bottom:0">Read the <a href="/terms#t-listers" target="_blank" rel="noopener">lister terms</a> and <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.</p>
      </div>
    </fieldset>`}
    <div class="form-error mt-24" hidden></div>
    <div class="row between wrap mt-24">
      ${edit ? '<button type="button" class="btn btn-ghost" id="cancel-edit">Cancel</button>' : '<span class="muted small">You can track your application on this page after submitting.</span>'}
      <button type="submit" class="btn btn-primary btn-lg">${edit ? 'Resubmit for review' : 'Submit application'}</button>
    </div>
  </form>`;
}

/* ── Form behaviour ─────────────────────────────────────────────────────── */

function formError(form, err) {
  const box = $('.form-error', form);
  $$('.file-field.is-bad', form).forEach((n) => n.classList.remove('is-bad'));
  const field = err?.details?.field;
  if (field && form.elements[field]?.type === 'file') form.elements[field].closest('.file-field')?.classList.add('is-bad');
  if (showFieldError(form, err)) {
    box.hidden = true;
    const target = form.elements[field];
    (target?.type === 'file' ? target.closest('.file-field') : target)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  box.hidden = false;
  box.innerHTML = `<div class="panel-note danger">${icon('alert')}<div>${esc(err.message)}</div></div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
const fieldErr = (field, message) => ({ message, details: { field } });

function wireFiles(form) {
  $$('input[type=file]', form).forEach((inp) => {
    const zone = inp.closest('.dropzone');
    const nameEl = $('[data-fname]', zone);
    const initial = nameEl.textContent;
    const show = () => {
      const files = [...inp.files];
      const wrap = inp.closest('.file-field');
      wrap.classList.remove('is-bad');
      wrap.querySelector('.error[data-auto]')?.remove();
      zone.classList.toggle('has-file', files.length > 0);
      nameEl.textContent = files.length ? files.map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`).join(', ') : initial;
    };
    inp.addEventListener('change', show);
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      if (!e.dataTransfer?.files?.length) return;
      const dt = new DataTransfer();
      [...e.dataTransfer.files].slice(0, inp.multiple ? 4 : 1).forEach((f) => dt.items.add(f));
      inp.files = dt.files;
      show();
    });
  });
  const ifsc = form.elements.bankIfsc;
  ifsc.addEventListener('input', () => { ifsc.value = ifsc.value.toUpperCase().replace(/\s/g, ''); });
}

function checkFiles(form) {
  for (const inp of $$('input[type=file]', form)) {
    const files = [...inp.files];
    if (inp.multiple && files.length > 4) return fieldErr(inp.name, 'Upload up to 4 business documents.');
    const allowed = inp.dataset.images === '1' ? IMG_TYPES : DOC_TYPES;
    for (const f of files) {
      if (!allowed.includes(f.type)) return fieldErr(inp.name, `${f.name} is not a ${inp.dataset.images === '1' ? 'PNG, JPG or WebP image' : 'PDF, PNG, JPG or WebP file'}.`);
      if (f.size > MAX_MB * 1024 * 1024) return fieldErr(inp.name, `${f.name} is larger than ${MAX_MB} MB.`);
    }
  }
  return null;
}

const TEXT_FIELDS = ['applicantName', 'businessName', 'email', 'phone', 'businessAddress', 'city', 'category', 'serviceDescription',
  'govIdType', 'govIdNumber', 'addressProofType', 'addressProofId', 'bankAccountName', 'bankAccountNumber', 'bankIfsc', 'bankName', 'settlementUpi'];
const SENSITIVE = ['govIdNumber', 'addressProofId', 'bankAccountNumber', 'settlementUpi'];
const FILE_FIELDS = ['addressProof', 'idProof', 'businessDocs', 'paymentQr'];

function mountNewForm(prefill) {
  root.innerHTML = appForm({ mode: 'new', prefill });
  const form = $('#app-form');
  wireFiles(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    for (const name of TEXT_FIELDS) {
      if (f[name].required && !f[name].value.trim()) return formError(form, fieldErr(name, 'This field is required.'));
    }
    if (f.serviceDescription.value.trim().length < 30) return formError(form, fieldErr('serviceDescription', 'Describe your services in at least 30 characters.'));
    if (!/^\d{6,20}$/.test(f.bankAccountNumber.value.replace(/\s+/g, ''))) return formError(form, fieldErr('bankAccountNumber', 'Bank account number should be 6 to 20 digits.'));
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.bankIfsc.value.trim())) return formError(form, fieldErr('bankIfsc', 'IFSC should look like SBIN0001234 (11 characters).'));
    if (!f.addressProof.files.length) return formError(form, fieldErr('addressProof', 'Upload an address proof document.'));
    if (!f.idProof.files.length) return formError(form, fieldErr('idProof', 'Upload your business verification document.'));
    const bad = checkFiles(form);
    if (bad) return formError(form, bad);
    if (!f.agreementAck.checked) return formError(form, fieldErr('agreementAck', `Please confirm you accept the Lister Agreement terms, including the ${meta.platform?.commissionPercent ?? 20}% platform commission.`));

    const fd = new FormData();
    for (const name of TEXT_FIELDS) fd.append(name, f[name].value.trim());
    fd.append('agreementAck', 'true');
    for (const name of FILE_FIELDS) for (const file of f[name].files) fd.append(name, file, file.name);
    await send(form, () => api.upload('/api/applications', fd), 'Application submitted. We will review it shortly.');
  });
}

function mountEditForm(app) {
  const host = $('#edit-host');
  host.innerHTML = appForm({ mode: 'edit', app });
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const form = $('#app-form');
  wireFiles(form);
  $('#cancel-edit').addEventListener('click', () => { host.innerHTML = ''; $('#edit-open')?.focus(); });
  const original = {
    applicantName: app.applicantName, businessName: app.businessName, email: app.email, phone: app.phone,
    businessAddress: app.businessAddress, city: app.city, category: app.category?.slug || '', serviceDescription: app.serviceDescription,
    govIdType: app.govIdType, addressProofType: app.addressProofType, bankAccountName: app.bankAccountName, bankIfsc: app.bankIfsc, bankName: app.bankName || '',
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const fd = new FormData();
    let changes = 0;
    for (const name of TEXT_FIELDS) {
      const val = f[name].value.trim();
      if (SENSITIVE.includes(name) ? val : val && val !== String(original[name] ?? '')) { fd.append(name, val); changes++; }
    }
    if (f.serviceDescription.value.trim() !== original.serviceDescription && f.serviceDescription.value.trim().length < 30) {
      return formError(form, fieldErr('serviceDescription', 'Describe your services in at least 30 characters.'));
    }
    const bad = checkFiles(form);
    if (bad) return formError(form, bad);
    for (const name of FILE_FIELDS) for (const file of f[name].files) { fd.append(name, file, file.name); changes++; }
    if (!changes) return formError(form, { message: 'Change at least one field or upload a corrected document before resubmitting.' });
    await send(form, () => api.upload('/api/applications/mine', fd, 'PUT'), 'Resubmitted. Your application is back under review.');
  });
}

async function send(form, call, okMsg) {
  const btn = $('button[type=submit]', form);
  btn.classList.add('is-loading');
  try {
    const { application } = await call();
    toast(okMsg);
    renderStatus(application);
    $('#apply').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    formError(form, err);
  } finally { btn.classList.remove('is-loading'); }
}

/* ── Status view ────────────────────────────────────────────────────────── */

const TRACK = [['applied', 'Applied'], ['under_review', 'Under review'], ['verification_required', 'Verification required'], ['approved', 'Approved']];

function tracker(status) {
  const pos = { applied: 0, under_review: 1, verification_required: 2, approved: 3, rejected: 3, suspended: 3 }[status] ?? 0;
  const terminal = status === 'rejected' || status === 'suspended';
  return `<ol class="tracker" aria-label="Application progress">${TRACK.map(([, label], i) => {
    let cls = '';
    let dot = String(i + 1);
    let sub = '';
    let text = label;
    if (i === 3 && terminal) { cls = 'bad'; dot = icon('close'); text = status === 'rejected' ? 'Rejected' : 'Suspended'; }
    else if (i === 2 && status !== 'verification_required') { sub = 'Only if needed'; if (i < pos) { cls = 'skip'; dot = icon('minus'); } }
    else if (i < pos || status === 'approved') { cls = 'done'; dot = icon('check'); }
    else if (i === pos) { cls = status === 'verification_required' ? 'current warn' : 'current'; sub = 'Current step'; }
    return `<li class="${cls}" ${i === pos ? 'aria-current="step"' : ''}><div class="dot">${dot}</div><div><b>${esc(text)}</b>${sub ? `<small>${sub}</small>` : ''}</div></li>`;
  }).join('')}</ol>`;
}

function statusCopy(a) {
  switch (a.status) {
    case 'applied': return { tone: '', ic: 'inbox', title: 'Application received', text: 'Thanks. A Subtize.ai admin will start reviewing it shortly. You will get an email and a notification whenever the status changes.' };
    case 'under_review': return { tone: '', ic: 'clock', title: 'Under review', text: 'An admin is checking your business details, documents and address. Most reviews finish within a few working days.' };
    case 'verification_required': return { tone: 'warn', ic: 'alert', title: 'Action needed: verification required', text: 'An admin needs you to correct or add something before your application can be approved.' };
    case 'approved': return { tone: 'good', ic: 'checkCircle', title: 'Approved, welcome to Subtize.ai', text: 'Your business is verified. Next, sign your Lister Agreement (English and Hindi) in the lister dashboard. Once Subtize.ai countersigns it, you can publish services.' };
    case 'rejected': return { tone: 'danger', ic: 'x', title: 'Application not approved', text: 'This application was not approved. You can fix the issue and apply again.' };
    case 'suspended': return { tone: 'danger', ic: 'ban', title: 'Lister account suspended', text: 'Your lister account is suspended. Contact Subtize.ai support to understand why and what can be done.' };
    default: return { tone: '', ic: 'info', title: a.statusLabel || a.status, text: '' };
  }
}

function renderStatus(a) {
  const c = statusCopy(a);
  const cat = a.category?.name || '—';
  const docs = a.documents || [];
  const note = a.correctionNote ? `<div class="panel-note ${a.status === 'rejected' ? 'danger' : 'warn'} mt-16">${icon('edit')}<div><strong>Note from Subtize.ai:</strong> ${esc(a.correctionNote)}</div></div>` : '';
  let actions = '';
  if (a.status === 'verification_required') actions = `<button type="button" class="btn btn-primary" id="edit-open">${icon('edit', 'sm')} Update and resubmit</button>`;
  else if (a.status === 'approved') actions = `<a class="btn btn-primary" href="/lister">${icon('signature', 'sm')} Open lister dashboard to sign your agreement</a>`
    + (user?.role !== 'lister' ? '<p class="muted small mt-8" style="width:100%;margin-bottom:0">Your role changed on approval, so you may need to log in again.</p>' : '');
  else if (a.status === 'rejected') actions = `<button type="button" class="btn btn-primary" id="reapply">${icon('refresh', 'sm')} Start a new application</button>`;
  else if (a.status === 'suspended') actions = '<a class="btn btn-secondary" href="/contact">Contact support</a>';

  root.innerHTML = `
    <div class="apply-card">
      <div class="row between wrap top">
        <div><div class="eyebrow">Application <span class="mono">${esc(a.publicId)}</span></div>
          <h3 style="font-size:22px;margin-top:6px">${esc(a.businessName)}</h3></div>
        ${pill(a.status, a.statusLabel)}
      </div>
      <div class="mt-24">${tracker(a.status)}</div>
      <div class="panel-note ${c.tone} mt-24">${icon(c.ic)}<div><strong>${esc(c.title)}.</strong> ${esc(c.text)}</div></div>
      ${note}
      ${a.verificationId ? `<div class="panel-note good mt-16">${icon('shield')}<div>Verification ID <strong class="mono">${esc(a.verificationId)}</strong></div></div>` : ''}
      ${actions ? `<div class="row wrap mt-16">${actions}</div>` : ''}
      <div id="edit-host" class="mt-24"></div>

      <details class="mt-24" ${a.status === 'verification_required' ? 'open' : ''}>
        <summary class="label" style="cursor:pointer">Submitted details</summary>
        <div class="grid cols-2 mt-16" style="--gap:20px">
          <dl class="kv">
            <dt>Applicant</dt><dd>${esc(a.applicantName)}</dd>
            <dt>Email</dt><dd>${esc(a.email)}</dd>
            <dt>Phone</dt><dd>${esc(a.phone)}</dd>
            <dt>Category</dt><dd>${esc(cat)}</dd>
            <dt>City</dt><dd>${esc(a.city)}</dd>
            <dt>Submitted</dt><dd>${esc(fmtDate(a.createdAt))}</dd>
            <dt>Last updated</dt><dd>${esc(fmtDate(a.updatedAt))}</dd>
          </dl>
          <dl class="kv">
            <dt>${esc(a.govIdType)}</dt><dd class="mono">${esc(a.govIdNumber)}</dd>
            <dt>${esc(a.addressProofType)}</dt><dd class="mono">${esc(a.addressProofId)}</dd>
            <dt>Bank account</dt><dd class="mono">${esc(a.bankAccountNumber)}</dd>
            <dt>IFSC</dt><dd class="mono">${esc(a.bankIfsc)}${a.bankName ? ` · ${esc(a.bankName)}` : ''}</dd>
            <dt>Settlement UPI</dt><dd class="mono">${esc(a.settlementUpi || '—')}</dd>
            <dt>Checks</dt><dd class="row wrap" style="--gap:6px">${a.documentsVerified ? '<span class="pill tone-good">Documents verified</span>' : '<span class="pill tone-neutral">Documents pending</span>'}${a.addressVerified ? '<span class="pill tone-good">Address verified</span>' : '<span class="pill tone-neutral">Address pending</span>'}</dd>
          </dl>
        </div>
        <div class="label mt-24 mb-8">Documents (${docs.length})</div>
        <div class="doc-links">${docs.length ? docs.map((d) => `<a class="tag" href="/api/applications/mine/documents/${d.id}" target="_blank" rel="noopener">${icon(d.kind === 'payment_qr' ? 'qr' : 'file')} ${esc(DOC_KIND[d.kind] || d.kind)}: ${esc(d.name)}</a>`).join('') : '<span class="muted small">No documents on file.</span>'}</div>
        <p class="muted small mt-16" style="margin-bottom:0">${icon('lock', 'sm').replace('<svg', '<svg style="display:inline;vertical-align:-3px"')} Sensitive numbers are shown masked. Only Subtize.ai admins can see them in full.</p>
      </details>
    </div>`;

  $('#edit-open')?.addEventListener('click', () => mountEditForm(a));
  $('#reapply')?.addEventListener('click', () => {
    mountNewForm({
      applicantName: a.applicantName, businessName: a.businessName, email: a.email, phone: a.phone, businessAddress: a.businessAddress,
      city: a.city, category: a.category?.slug, serviceDescription: a.serviceDescription, govIdType: a.govIdType,
      addressProofType: a.addressProofType, bankAccountName: a.bankAccountName, bankIfsc: a.bankIfsc, bankName: a.bankName,
    });
    root.insertAdjacentHTML('afterbegin', `<div class="panel-note mb-16">${icon('info')}<div>We copied your previous details. Re-enter the verification and bank numbers and upload your documents again.</div></div>`);
  });
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

function guestView() {
  const next = encodeURIComponent('/become-lister#apply');
  root.innerHTML = `
    <div class="apply-card center">
      <div class="icon-tile" style="margin:0 auto 14px">${icon('user')}</div>
      <h3 style="font-size:20px">Create a free account to apply</h3>
      <p class="soft" style="max-width:520px;margin:10px auto 20px">Your application is linked to your Subtize.ai account, so you can track its status, answer correction requests and, once approved, open your lister dashboard with the same login.</p>
      <div class="row wrap" style="justify-content:center">
        <a class="btn btn-primary btn-lg" href="/signup?next=${next}">Sign up to apply</a>
        <a class="btn btn-secondary btn-lg" href="/login?next=${next}">I already have an account</a>
      </div>
    </div>`;
}

(async () => {
  const [u, m] = await Promise.all([mountSite({ active: 'lister' }), api.get('/api/meta').catch(() => null)]);
  user = u;
  if (m) meta = m;
  const commission = meta.platform?.commissionPercent ?? 20;
  $$('[data-commission]').forEach((n) => { n.textContent = commission; });
  $$('[data-payout]').forEach((n) => { n.textContent = 100 - commission; });

  if (!user) { guestView(); return; }
  if (user.role === 'admin') {
    root.innerHTML = `<div class="panel-note warn">${icon('info')}<div><strong>Admin accounts cannot apply as listers.</strong> Review incoming applications in the <a href="/admin">admin console</a>.</div></div>`;
    return;
  }
  try {
    const { application } = await api.get('/api/applications/mine');
    if (application) renderStatus(application);
    else if (user.role === 'lister') {
      root.innerHTML = `<div class="apply-card"><div class="panel-note good">${icon('checkCircle')}<div><strong>You are already a Subtize.ai lister.</strong> Manage your services, agreement and settlements from your dashboard.</div></div><div class="row mt-16"><a class="btn btn-primary" href="/lister">Open lister dashboard</a></div></div>`;
    } else {
      mountNewForm({ applicantName: user.fullName, email: user.email, phone: user.phone || '' });
    }
  } catch (e) {
    if (e.status === 401) { guestView(); return; }
    root.innerHTML = `<div class="panel-note danger">${icon('alert')}<div><strong>Could not load your application.</strong> ${esc(e.message)}</div></div>`;
  }
  if (location.hash === '#apply') setTimeout(() => $('#apply').scrollIntoView({ block: 'start' }), 50);
})();
