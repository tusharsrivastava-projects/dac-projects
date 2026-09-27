/*
 * Header and footer for the public pages. Each page has
 *   <div id="site-header"></div> … <div id="site-footer"></div>
 * and calls mountSite({ active: 'explore' }).
 */
import { api, homeFor } from './api.js';
import { $, brand, esc, icon } from './ui.js';
import './pwa.js';

export async function mountSite({ active = '' } = {}) {
  const header = $('#site-header');
  const footer = $('#site-footer');
  let user = null;
  try { ({ user } = await api.me()); } catch { /* signed out */ }

  if (header) {
    header.outerHTML = `
    <header class="site-header">
      <div class="container">
        ${brand('/')}
        <nav class="site-nav" aria-label="Site">
          <a href="/explore" class="${active === 'explore' ? 'active' : ''}">Explore services</a>
          <a href="/#how-it-works">How it works</a>
          <a href="/become-lister" class="${active === 'lister' ? 'active' : ''}">Become a Lister</a>
          <a href="/payment-info" class="${active === 'payment' ? 'active' : ''}">Payments</a>
        </nav>
        <div class="site-actions">
          <button class="btn btn-ghost btn-sm hide-sm" data-action="download-app">${icon('smartphone', 'sm')} Get the app</button>
          ${user
            ? `<a class="btn btn-primary btn-sm" href="${homeFor(user.role)}">${icon('grid', 'sm')} Dashboard</a>`
            : `<a class="btn btn-ghost btn-sm" href="/login">Log in</a><a class="btn btn-primary btn-sm" href="/signup">Sign up</a>`}
          <button class="btn btn-ghost btn-icon btn-sm site-menu-toggle" aria-label="Menu" id="site-menu">${icon('menu')}</button>
        </div>
      </div>
    </header>`;
    $('#site-menu')?.addEventListener('click', () => document.body.classList.toggle('site-nav-open'));
  }

  if (footer) {
    let support = { supportEmail: 'support@subtize.ai', supportPhone: '' };
    try { support = (await api.get('/api/meta')).platform; } catch { /* defaults */ }
    footer.outerHTML = `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            ${brand('/')}
            <p class="soft mt-16" style="max-width:340px">Avail 100+ subscription-based services for a month. Manage and cancel everything from a single platform.</p>
            <div class="row wrap mt-16">
              <button class="btn btn-secondary btn-sm" data-action="download-app">${icon('download', 'sm')} Download App</button>
              <button class="btn btn-secondary btn-sm" data-action="share-app">${icon('share', 'sm')} Share App</button>
            </div>
          </div>
          <div><h4>Subtize.ai</h4><ul>
            <li><a href="/about">About Subtize.ai</a></li>
            <li><a href="/explore">Explore services</a></li>
            <li><a href="/payment-info">Payment information</a></li>
            <li><a href="/contact">Contact</a></li>
          </ul></div>
          <div><h4>Partners</h4><ul>
            <li><a href="/become-lister">Become a Lister</a></li>
            <li><a href="/become-lister#apply">Apply as a Service Provider</a></li>
            <li><a href="/login">Lister login</a></li>
          </ul></div>
          <div><h4>Account</h4><ul>
            <li><a href="${user ? homeFor(user.role) : '/login'}">${user ? 'Dashboard' : 'Login'}</a></li>
            ${user ? '' : '<li><a href="/signup">Create an account</a></li>'}
            <li><a href="/terms">Terms &amp; Conditions</a></li>
            <li><a href="/privacy">Privacy Policy</a></li>
          </ul></div>
        </div>
        <div class="footer-base">
          <span>© ${new Date().getFullYear()} Subtize.ai. All subscription payments go only to the official Subtize.ai account shown at checkout.</span>
          <span>${esc(support.supportEmail)}${support.supportPhone ? ` · ${esc(support.supportPhone)}` : ''}</span>
        </div>
      </div>
    </footer>`;
  }
  return user;
}
