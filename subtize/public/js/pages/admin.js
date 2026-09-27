/* Subtize.ai admin console: shell, navigation and routes. */
import { api } from '../api.js';
import { logout, mountShell, requireRole, route, start } from '../shell.js';
import { copyText } from '../ui.js';
import { refreshBadges } from './admin/common.js';
import { renderDashboard } from './admin/dashboard.js';
import { renderChangeRequests, renderServiceDetail, renderServiceForm, renderServices } from './admin/services.js';
import { renderUserDetail, renderUsers } from './admin/users.js';
import { renderListers } from './admin/listers.js';
import { renderApplication, renderApplications } from './admin/applications.js';
import { renderPayments } from './admin/payments.js';
import { renderSubscriptionDetail, renderSubscriptions } from './admin/subscriptions.js';
import { renderCoupons } from './admin/coupons.js';
import { renderUsage } from './admin/usage.js';
import { renderReports } from './admin/reports.js';
import { renderAgreement, renderAgreements } from './admin/agreements.js';
import { renderRevenue } from './admin/revenue.js';
import { renderSettings } from './admin/settings.js';

const user = await requireRole(['admin']);

mountShell({
  user,
  roleLabel: 'Admin',
  nav: [{
    items: [
      { path: '/', label: 'Dashboard', icon: 'grid' },
      { path: '/services', label: 'Service Management', icon: 'store' },
      { path: '/users', label: 'User Management', icon: 'users' },
      { path: '/listers', label: 'Lister Management', icon: 'briefcase' },
      { path: '/applications', label: 'Applications', icon: 'fileCheck' },
      { path: '/payments', label: 'Payment Verification', icon: 'shield' },
      { path: '/subscriptions', label: 'Subscription Management', icon: 'layers' },
      { path: '/coupons', label: 'Coupon Management', icon: 'tag' },
      { path: '/usage', label: 'Usage Management', icon: 'gauge' },
      { path: '/reports', label: 'Reports', icon: 'chart' },
      { path: '/agreements', label: 'Agreements', icon: 'signature' },
      { path: '/revenue', label: 'Revenue', icon: 'wallet' },
      { path: '/settings', label: 'Settings', icon: 'settings' },
      { path: '/logout', label: 'Logout', icon: 'logout' },
    ],
  }],
  notifications: {
    list: () => api.get('/api/admin/notifications'),
    markRead: () => api.post('/api/admin/notifications/read'),
  },
});
document.body.classList.add('admin-console');

// Copy buttons anywhere in the console (UTRs, IDs, UPI URIs).
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (b) { e.preventDefault(); copyText(b.dataset.copy, 'Copied to clipboard'); }
});

const ctx = { user };

route('/', (a) => renderDashboard({ ...a, ctx }), { title: 'Dashboard' });
route('/services', (a) => renderServices({ ...a, ctx }), { title: 'Service Management' });
route('/services/new', (a) => renderServiceForm({ ...a, ctx }), { title: 'Add service' });
route('/services/changes', (a) => renderChangeRequests({ ...a, ctx }), { title: 'Change requests' });
route('/services/:id/edit', (a) => renderServiceForm({ ...a, ctx }), { title: 'Edit service' });
route('/services/:id', (a) => renderServiceDetail({ ...a, ctx }), { title: 'Service' });
route('/users', (a) => renderUsers({ ...a, ctx }), { title: 'User Management' });
route('/users/:id', (a) => renderUserDetail({ ...a, ctx }), { title: 'User' });
route('/listers', (a) => renderListers({ ...a, ctx }), { title: 'Lister Management' });
route('/applications', (a) => renderApplications({ ...a, ctx }), { title: 'Applications' });
route('/applications/:id', (a) => renderApplication({ ...a, ctx }), { title: 'Application review' });
route('/payments', (a) => renderPayments({ ...a, ctx }), { title: 'Payment Verification' });
route('/subscriptions', (a) => renderSubscriptions({ ...a, ctx }), { title: 'Subscription Management' });
route('/subscriptions/:id', (a) => renderSubscriptionDetail({ ...a, ctx }), { title: 'Subscription' });
route('/coupons', (a) => renderCoupons({ ...a, ctx }), { title: 'Coupon Management' });
route('/usage', (a) => renderUsage({ ...a, ctx }), { title: 'Usage Management' });
route('/reports', (a) => renderReports({ ...a, ctx }), { title: 'Reports' });
route('/agreements', (a) => renderAgreements({ ...a, ctx }), { title: 'Agreements' });
route('/agreements/:id', (a) => renderAgreement({ ...a, ctx }), { title: 'Agreement' });
route('/revenue', (a) => renderRevenue({ ...a, ctx }), { title: 'Revenue' });
route('/settings', (a) => renderSettings({ ...a, ctx }), { title: 'Settings' });
route('/logout', async ({ view }) => { view.innerHTML = '<div class="loading">Signing out…</div>'; await logout(); }, { title: 'Signing out' });

start();
refreshBadges();
setInterval(() => refreshBadges(), 60_000);
