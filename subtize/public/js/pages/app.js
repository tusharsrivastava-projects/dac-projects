/*
 * Member (Explorer) dashboard entry: guards the session, draws the shell and
 * registers every hash route. Each screen lives in ./app/<screen>.js.
 */
import { api } from '../api.js';
import { icon } from '../ui.js';
import { logout, mountShell, requireRole, route, setBadge, start } from '../shell.js';
import { renderDashboard } from './app/dashboard.js';
import { renderSearch } from './app/search.js';
import { renderExplore } from './app/explore.js';
import { renderService } from './app/service.js';
import { renderCheckout, renderPayment } from './app/checkout.js';
import { renderSubscriptions, renderSubscription } from './app/subscriptions.js';
import { renderManage } from './app/manage.js';
import { renderUsage } from './app/usage.js';
import { renderCoupons } from './app/coupons.js';
import { renderCards, renderCard } from './app/cards.js';
import { renderPayments } from './app/payments.js';
import { renderProfile } from './app/profile.js';
import { renderSettings } from './app/settings.js';
import { applyVoicePreference, setUser } from './app/common.js';

const user = await requireRole(['user', 'lister']);
setUser(user);
const isLister = user.role === 'lister';

const nav = [
  {
    group: null,
    items: [
      { path: '/', label: 'Dashboard', icon: 'home' },
      { path: '/search', label: 'AI Smart Search', icon: 'sparkle' },
      { path: '/explore', label: 'Explore Services', icon: 'compass', match: '/services' },
    ],
  },
  {
    group: 'My plans',
    items: [
      { path: '/subscriptions', label: 'My Subscriptions', icon: 'layers' },
      { path: '/manage', label: 'Manage Subscriptions', icon: 'sliders' },
      { path: '/usage', label: 'Usage', icon: 'gauge' },
      { path: '/coupons', label: 'Coupons', icon: 'ticket' },
      { path: '/cards', label: 'Subscription Cards', icon: 'card' },
    ],
  },
  {
    group: 'Account',
    items: [
      { path: '/profile', label: 'Profile', icon: 'user' },
      { path: '/payments', label: 'Payments', icon: 'wallet' },
      { path: '/settings', label: 'Settings', icon: 'settings' },
      ...(isLister ? [{ href: '/lister', label: 'Lister dashboard', icon: 'store' }] : []),
      { href: '#/logout', label: 'Logout', icon: 'logout', id: 'nav-logout' },
    ],
  },
];

const bottomNav = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/search', label: 'AI Search', icon: 'sparkle' },
  { path: '/explore', label: 'Explore', icon: 'compass', match: '/services' },
  { path: '/subscriptions', label: 'Subscriptions', icon: 'layers' },
  { path: '/profile', label: 'Profile', icon: 'user' },
];

mountShell({
  user,
  roleLabel: isLister ? 'Lister' : 'Explorer',
  nav,
  bottomNav,
  notifications: {
    list: async () => {
      const { notifications = [], unread } = await api.get('/api/me/notifications');
      return { notifications, unread: unread ?? notifications.filter((n) => !n.read).length };
    },
    markRead: () => api.post('/api/me/notifications/read'),
  },
  extraFoot: `
    <div class="row" style="--gap:8px">
      <button type="button" class="btn btn-secondary btn-sm grow" data-action="download-app">${icon('download', 'sm')} Download App</button>
      <button type="button" class="btn btn-secondary btn-sm grow" data-action="share-app">${icon('share', 'sm')} Share App</button>
    </div>`,
});

// The Logout nav item signs out directly instead of routing.
document.getElementById('side-nav')?.addEventListener('click', (e) => {
  if (e.target.closest('#nav-logout')) { e.preventDefault(); logout(); }
});

route('/', renderDashboard, { title: 'Dashboard' });
route('/search', renderSearch, { title: 'AI Smart Search' });
route('/explore', renderExplore, { title: 'Explore services' });
route('/services/:id', renderService, { title: 'Service' });
route('/checkout/:serviceId', renderCheckout, { title: 'Subscribe' });
route('/payments/:id', renderPayment, { title: 'Payment' });
route('/subscriptions', renderSubscriptions, { title: 'My subscriptions' });
route('/subscriptions/:id', renderSubscription, { title: 'Subscription' });
route('/manage', renderManage, { title: 'Manage subscriptions' });
route('/usage', renderUsage, { title: 'Usage' });
route('/coupons', renderCoupons, { title: 'Coupons' });
route('/cards', renderCards, { title: 'Subscription cards' });
route('/cards/:id', renderCard, { title: 'Subscription card' });
route('/profile', renderProfile, { title: 'Profile' });
route('/payments', renderPayments, { title: 'Payments' });
route('/settings', renderSettings, { title: 'Settings' });
route('/logout', async ({ view }) => { view.innerHTML = '<div class="loading">Signing you out…</div>'; await logout(); });
start();

// Small, non-blocking extras: pending badge and the voice preference.
api.get('/api/me/subscriptions').then(({ counts = {} }) => setBadge('/subscriptions', counts.pending || 0)).catch(() => {});
api.get('/api/me/profile').then(({ profile }) => applyVoicePreference(profile.settings?.voiceEnabled !== false)).catch(() => {});
