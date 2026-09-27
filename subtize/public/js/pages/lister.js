/* Lister (service provider) dashboard: entry point, shell, routes and the onboarding gate. */
import { api } from '../api.js';
import { currentRoute, logout, mountShell, requireRole, route, setBadge, start } from '../shell.js';
import { $, icon } from '../ui.js';
import { bannerHtml, onStanding, setStanding, state } from './lister/common.js';
import { renderDashboard } from './lister/dashboard.js';
import { renderServices, renderNewService, renderServiceDetail } from './lister/services.js';
import { renderSubscribers, renderCancellations } from './lister/subscribers.js';
import { renderCheckin } from './lister/checkin.js';
import { renderRevenue, renderSettlements } from './lister/money.js';
import { renderAgreement } from './lister/agreement.js';
import { renderProfile } from './lister/profile.js';

const user = await requireRole(['lister']);
state.user = user;

const nav = [
  {
    group: 'Business',
    items: [
      { path: '/', label: 'Dashboard', icon: 'home' },
      { path: '/services', label: 'My Services', icon: 'layers' },
      { path: '/subscribers', label: 'Subscribers', icon: 'users' },
      { path: '/cancellations', label: 'Cancellations', icon: 'ban' },
      { path: '/checkin', label: 'Check-in', icon: 'qr' },
    ],
  },
  {
    group: 'Money',
    items: [
      { path: '/revenue', label: 'Monthly Revenue', icon: 'chart' },
      { path: '/settlements', label: 'Settlement', icon: 'wallet' },
    ],
  },
  {
    group: 'Account',
    items: [
      { path: '/agreement', label: 'Agreement', icon: 'signature' },
      { path: '/profile', label: 'Profile', icon: 'user' },
      { href: '/app', label: 'Explorer view', icon: 'compass', id: 'nav-explorer' },
      { href: '#logout', label: 'Logout', icon: 'logout', id: 'nav-logout' },
    ],
  },
];

const extraFoot = `<div class="lister-foot-actions">
  <button type="button" class="btn btn-secondary btn-sm" data-action="download-app">${icon('download', 'sm')} Download App</button>
  <button type="button" class="btn btn-secondary btn-sm" data-action="share-app">${icon('share', 'sm')} Share App</button>
</div>`;

state.shell = mountShell({
  user,
  roleLabel: 'Lister',
  nav,
  extraFoot,
  notifications: {
    list: async () => {
      const { notifications = [] } = await api.get('/api/me/notifications');
      return { notifications: notifications.slice(0, 15), unread: notifications.filter((n) => !n.read).length };
    },
    markRead: () => api.post('/api/me/notifications/read'),
  },
});

document.addEventListener('click', (e) => {
  if (e.target.closest('#nav-logout')) { e.preventDefault(); logout(); }
  const sign = e.target.closest('[data-go-sign]');
  if (sign && currentRoute().path === '/agreement') {
    e.preventDefault();
    document.getElementById('sign-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

/* Onboarding banner lives above the view so every route shows it. */
const bannerHost = document.createElement('div');
bannerHost.className = 'lister-banner-host';
bannerHost.id = 'lister-banner';
bannerHost.hidden = true;
$('#view').before(bannerHost);

onStanding((standing) => {
  bannerHost.innerHTML = bannerHtml(standing);
  bannerHost.hidden = !bannerHost.innerHTML.trim();
  setBadge('/agreement', standing.nextStep === 'sign_agreement' ? '1' : null);
});

// Standing decides the landing route, so load it before the router starts.
try {
  const { standing, metrics } = await api.get('/api/lister/overview');
  if (metrics?.commissionPercent) state.commission = metrics.commissionPercent;
  setStanding(standing);
  // Until the agreement is signed, it is the landing page (replaceState: no extra hashchange render).
  if (standing.nextStep === 'sign_agreement' && !location.hash.replace(/^#\/?/, '')) {
    history.replaceState(null, '', '#/agreement');
  }
} catch { /* the dashboard route shows the error */ }

route('/', renderDashboard, { title: 'Dashboard' });
route('/services', renderServices, { title: 'My Services' });
route('/services/new', renderNewService, { title: 'Add a service' });
route('/services/:id', renderServiceDetail, { title: 'Service' });
route('/subscribers', renderSubscribers, { title: 'Subscribers' });
route('/cancellations', renderCancellations, { title: 'Cancellations' });
route('/checkin', renderCheckin, { title: 'Check-in' });
route('/revenue', renderRevenue, { title: 'Monthly Revenue' });
route('/settlements', renderSettlements, { title: 'Settlement' });
route('/agreement', renderAgreement, { title: 'Lister Agreement' });
route('/profile', renderProfile, { title: 'Profile' });
start();
