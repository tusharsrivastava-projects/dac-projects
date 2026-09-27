import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from '../config.js';
import { db, logActivity, notify, tx } from '../db/index.js';
import { mask, open, seal } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, wrap } from '../lib/http.js';
import { applicationPublicId } from '../lib/ids.js';
import * as v from '../lib/validate.js';
import { privateDocs, rel } from '../middleware/uploads.js';
import { requireAuth } from '../middleware/session.js';

export const applicationsRouter = express.Router();
applicationsRouter.use(requireAuth);

export const APPLICATION_STATUS = {
  applied: 'Applied',
  under_review: 'Under review',
  verification_required: 'Verification required',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

const DOC_FIELDS = [
  { name: 'addressProof', maxCount: 1 },
  { name: 'idProof', maxCount: 1 },
  { name: 'businessDocs', maxCount: 4 },
  { name: 'paymentQr', maxCount: 1 },
];
const KIND = { addressProof: 'address_proof', idProof: 'id_proof', businessDocs: 'business_doc', paymentQr: 'payment_qr' };

/**
 * One projection for everyone who may see an application. Sensitive numbers
 * come back masked unless `reveal` is set, which only the admin console asks
 * for (and which is logged).
 */
export function applicationView(row, { reveal = false } = {}) {
  const docs = db.prepare('SELECT id, kind, original_name, mime, size, created_at FROM application_documents WHERE application_id = ? ORDER BY id').all(row.id);
  const show = (sealed) => (reveal ? open(sealed) : mask(open(sealed)));
  const cat = row.category_id ? db.prepare('SELECT slug, name FROM categories WHERE id = ?').get(row.category_id) : null;
  return {
    id: row.id,
    publicId: row.public_id,
    userId: row.user_id,
    applicantName: row.applicant_name,
    businessName: row.business_name,
    email: row.email,
    phone: row.phone,
    businessAddress: row.business_address,
    city: row.city,
    category: cat,
    serviceDescription: row.service_description,
    govIdType: row.gov_id_type,
    govIdNumber: show(row.gov_id_number_enc),
    addressProofType: row.address_proof_type,
    addressProofId: show(row.address_proof_id_enc),
    bankAccountName: row.bank_account_name,
    bankAccountNumber: show(row.bank_account_no_enc),
    bankIfsc: row.bank_ifsc,
    bankName: row.bank_name,
    settlementUpi: show(row.settlement_upi_enc),
    agreementAck: Boolean(row.agreement_ack),
    status: row.status,
    statusLabel: APPLICATION_STATUS[row.status],
    documentsVerified: Boolean(row.documents_verified),
    addressVerified: Boolean(row.address_verified),
    correctionNote: row.correction_note,
    adminNote: reveal ? row.admin_note : undefined,
    verificationId: row.verification_id,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revealed: reveal,
    documents: docs.map((d) => ({ id: d.id, kind: d.kind, name: d.original_name, mime: d.mime, size: d.size, uploadedAt: d.created_at })),
  };
}

function readFields(b, { partial = false } = {}) {
  const req = !partial;
  const out = {
    applicant_name: v.str(b.applicantName, 'Applicant name', { required: req, min: 2, max: 120 }),
    business_name: v.str(b.businessName, 'Business name', { required: req, min: 2, max: 160 }),
    email: b.email || req ? v.email(b.email, 'Business email') : null,
    phone: v.phone(b.phone, 'Phone', { required: req }),
    business_address: v.str(b.businessAddress, 'Business address', { required: req, min: 8, max: 400 }),
    city: v.str(b.city, 'City', { required: req, max: 80 }),
    service_description: v.str(b.serviceDescription, 'Service description', { required: req, min: 30, max: 3000 }),
    gov_id_type: v.str(b.govIdType, 'Business verification type', { required: req, max: 60 }),
    gov_id_number: v.str(b.govIdNumber, 'Business verification number', { required: req, min: 5, max: 40 }),
    address_proof_type: v.str(b.addressProofType, 'Address proof type', { required: req, max: 60 }),
    address_proof_id: v.str(b.addressProofId, 'Address proof ID', { required: req, min: 4, max: 40 }),
    bank_account_name: v.str(b.bankAccountName, 'Account holder name', { required: req, max: 120 }),
    bank_account_no: b.bankAccountNumber || req ? v.str(b.bankAccountNumber, 'Bank account number', { min: 6, max: 20 }).replace(/\s+/g, '') : null,
    bank_ifsc: b.bankIfsc || req ? v.ifsc(b.bankIfsc, 'IFSC') : null,
    bank_name: v.str(b.bankName, 'Bank name', { required: false, max: 80 }),
    settlement_upi: v.vpa(b.settlementUpi, 'Settlement UPI ID', { required: false }),
  };
  if (out.bank_account_no && !/^\d{6,20}$/.test(out.bank_account_no)) throw badRequest('Bank account number should be digits only.', { field: 'bankAccountNumber' });
  const slug = v.str(b.category, 'Service category', { required: req, max: 40 });
  if (slug) {
    const cat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    if (!cat) throw badRequest('Pick a service category from the list.', { field: 'category' });
    out.category_id = cat.id;
  }
  return out;
}

function saveDocs(appId, files) {
  const ins = db.prepare('INSERT INTO application_documents (application_id, kind, path, original_name, mime, size) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [field, list] of Object.entries(files || {})) {
    for (const f of list) ins.run(appId, KIND[field], rel(f), f.originalname.slice(0, 200), f.mimetype, f.size);
  }
}

const discard = (files) => {
  for (const list of Object.values(files || {})) for (const f of list) fs.rm(f.path, { force: true }, () => {});
};

applicationsRouter.get('/mine', (req, res) => {
  const row = db.prepare('SELECT * FROM lister_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  res.json({ application: row ? applicationView(row) : null });
});

applicationsRouter.post('/', privateDocs.fields(DOC_FIELDS), wrap((req, res) => {
  try {
    if (req.user.role === 'admin') throw forbidden('Admin accounts cannot apply as listers.');
    const existing = db.prepare("SELECT status FROM lister_applications WHERE user_id = ? AND status NOT IN ('rejected') ORDER BY id DESC LIMIT 1").get(req.user.id);
    if (existing) throw conflict(`You already have an application (${APPLICATION_STATUS[existing.status]}).`);
    const f = readFields(req.body);
    if (!v.bool(req.body.agreementAck)) throw badRequest('Please confirm you have read the Lister Agreement terms, including the 20% platform commission.', { field: 'agreementAck' });
    if (!req.files?.addressProof?.length) throw badRequest('Upload an address proof document.', { field: 'addressProof' });
    if (!req.files?.idProof?.length) throw badRequest('Upload your business or government verification document.', { field: 'idProof' });

    const id = tx(() => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM lister_applications').get().n + 1;
      const appId = db.prepare(
        `INSERT INTO lister_applications (public_id, user_id, applicant_name, business_name, email, phone, business_address, city,
            category_id, service_description, gov_id_type, gov_id_number_enc, address_proof_type, address_proof_id_enc,
            bank_account_name, bank_account_no_enc, bank_ifsc, bank_name, settlement_upi_enc, agreement_ack)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(applicationPublicId(n), req.user.id, f.applicant_name, f.business_name, f.email, f.phone, f.business_address, f.city,
        f.category_id, f.service_description, f.gov_id_type, seal(f.gov_id_number), f.address_proof_type, seal(f.address_proof_id),
        f.bank_account_name, seal(f.bank_account_no), f.bank_ifsc, f.bank_name, seal(f.settlement_upi)).lastInsertRowid;
      saveDocs(appId, req.files);
      return appId;
    })();

    for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all()) {
      notify(a.id, { title: 'New lister application', body: `${f.business_name} · ${f.city}`, link: `/admin#/applications/${id}` });
    }
    logActivity({ actor: req.user, action: 'application.submitted', entity: 'application', entityId: id });
    res.status(201).json({ application: applicationView(db.prepare('SELECT * FROM lister_applications WHERE id = ?').get(id)) });
  } catch (err) {
    discard(req.files);
    throw err;
  }
}));

/** Resubmission after an admin asked for corrections. */
applicationsRouter.put('/mine', privateDocs.fields(DOC_FIELDS), wrap((req, res) => {
  try {
    const row = db.prepare('SELECT * FROM lister_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
    if (!row) throw notFound('You have not applied yet.');
    if (!['verification_required', 'applied'].includes(row.status)) throw conflict('This application can no longer be edited.');
    const f = readFields(req.body, { partial: true });
    const sets = [];
    const vals = [];
    const put = (col, val) => { if (val != null) { sets.push(`${col} = ?`); vals.push(val); } };
    for (const col of ['applicant_name', 'business_name', 'email', 'phone', 'business_address', 'city', 'category_id', 'service_description',
      'gov_id_type', 'address_proof_type', 'bank_account_name', 'bank_ifsc', 'bank_name']) put(col, f[col]);
    put('gov_id_number_enc', f.gov_id_number && seal(f.gov_id_number));
    put('address_proof_id_enc', f.address_proof_id && seal(f.address_proof_id));
    put('bank_account_no_enc', f.bank_account_no && seal(f.bank_account_no));
    put('settlement_upi_enc', f.settlement_upi && seal(f.settlement_upi));
    tx(() => {
      db.prepare(`UPDATE lister_applications SET ${[...sets, "status = 'under_review'", "updated_at = datetime('now')"].join(', ')} WHERE id = ?`)
        .run(...vals, row.id);
      saveDocs(row.id, req.files);
    })();
    for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all()) {
      notify(a.id, { title: 'Application resubmitted', body: row.business_name, link: `/admin#/applications/${row.id}` });
    }
    logActivity({ actor: req.user, action: 'application.resubmitted', entity: 'application', entityId: row.id });
    res.json({ application: applicationView(db.prepare('SELECT * FROM lister_applications WHERE id = ?').get(row.id)) });
  } catch (err) {
    discard(req.files);
    throw err;
  }
}));

applicationsRouter.get('/mine/documents/:docId', (req, res, next) => {
  const doc = db.prepare(
    `SELECT d.* FROM application_documents d JOIN lister_applications a ON a.id = d.application_id
      WHERE d.id = ? AND a.user_id = ?`,
  ).get(req.params.docId, req.user.id);
  if (!doc) return next(notFound('Document not found.'));
  sendDoc(res, doc);
});

export function sendDoc(res, doc) {
  const file = path.join(config.uploadDir, doc.path);
  if (!file.startsWith(config.uploadDir) || !fs.existsSync(file)) return res.status(404).json({ error: 'File missing.' });
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Disposition', `inline; filename="${doc.original_name.replace(/["\\]/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(file).pipe(res);
}
