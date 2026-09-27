/* #/payments — every payment with its UTR and verification status. */
import { api } from '../../api.js';
import { emptyState, statTile } from '../../components.js';
import { pageHead } from '../../shell.js';
import { esc, fmtDate, icon, inr, inrShort, pill } from '../../ui.js';
import { mountPage, planLabel } from './common.js';

export async function renderPayments({ view, isCurrent }) {
  const { payments } = await api.get('/api/me/payments');
  if (!isCurrent()) return;
  const verified = payments.filter((p) => p.status === 'verified');
  const paid = verified.reduce((n, p) => n + p.finalAmount, 0);
  const saved = verified.reduce((n, p) => n + p.discount, 0);
  const pending = payments.filter((p) => p.status === 'pending').length;
  const awaiting = payments.filter((p) => p.status === 'awaiting_payment');

  mountPage(view, `
    ${pageHead('Payments', 'All payments go to the official Subtize.ai UPI account. Each one is verified by an admin before a plan starts.')}
    <div class="stats mb-24">
      ${statTile({ label: 'Total paid', value: inrShort(paid), sub: `${verified.length} verified payment${verified.length === 1 ? '' : 's'}`, ic: 'wallet', hero: true })}
      ${statTile({ label: 'Saved with coupons', value: inrShort(saved), ic: 'percent' })}
      ${statTile({ label: 'Pending verification', value: String(pending), ic: 'clock' })}
      ${statTile({ label: 'Awaiting your payment', value: String(awaiting.length), ic: 'qr' })}
    </div>
    ${awaiting.length ? `<div class="panel-note warn mb-16">${icon('qr')}<div><strong>${awaiting.length === 1 ? 'One checkout is' : `${awaiting.length} checkouts are`} waiting for payment.</strong> ${awaiting.map((p) => `<a href="#/payments/${esc(p.id)}">${esc(p.service.name)}</a>`).join(', ')}</div></div>` : ''}
    ${payments.length ? `
      <div class="table-wrap"><table class="table rtable">
        <thead><tr><th>Payment ID</th><th>Service</th><th class="right">Amount</th><th class="right">Discount</th><th class="right">Final</th><th>UTR</th><th>Status</th><th>Dates</th><th><span class="sr-only">Action</span></th></tr></thead>
        <tbody>${payments.map((p) => `<tr>
          <td data-label="Payment ID" class="mono nowrap">${esc(p.id)}</td>
          <td data-label="Service"><a class="cell-title" href="#/subscriptions/${esc(p.subscriptionId)}">${esc(p.service.name)}</a><div class="cell-sub">${planLabel(p.months)}</div></td>
          <td data-label="Amount" class="right num nowrap">${inr(p.amount)}</td>
          <td data-label="Discount" class="right num nowrap">${p.discount ? `− ${inr(p.discount)}${p.couponCode ? `<div class="cell-sub mono">${esc(p.couponCode)}</div>` : ''}` : '—'}</td>
          <td data-label="Final" class="right num nowrap"><b>${inr(p.finalAmount)}</b></td>
          <td data-label="UTR" class="mono">${esc(p.upiTxnId || '—')}</td>
          <td data-label="Status">${pill(p.status)}${p.rejectionReason ? `<div class="cell-sub">${esc(p.rejectionReason)}</div>` : ''}</td>
          <td data-label="Dates" class="small nowrap">
            <div>Created ${fmtDate(p.createdAt)}</div>
            ${p.submittedAt ? `<div class="muted">Submitted ${fmtDate(p.submittedAt)}</div>` : ''}
            ${p.verifiedAt ? `<div class="muted">Verified ${fmtDate(p.verifiedAt)}</div>` : ''}</td>
          <td data-label="Action" class="actions-cell">${p.status === 'awaiting_payment'
    ? `<a class="btn btn-primary btn-sm" href="#/payments/${esc(p.id)}">${icon('qr', 'sm')} Pay now</a>`
    : `<a class="btn btn-ghost btn-sm" href="#/payments/${esc(p.id)}">${icon('eye', 'sm')} View</a>`}</td>
        </tr>`).join('')}</tbody></table></div>`
    : emptyState({ ic: 'wallet', title: 'No payments yet', text: 'When you subscribe, the payment and its verification status show up here.', action: '<a class="btn btn-primary" href="#/explore">Explore services</a>' })}`);
}
