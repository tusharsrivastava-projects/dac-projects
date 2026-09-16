import { api, ApiError } from './api.js';
import { $, busy, el, icon, modal, toast } from './ui.js';

const token = window.location.pathname.split('/offer/')[1] || '';
const root = $('#offer-root');

const gate = (iconName, title, message) =>
  el('div', { class: 'offer-gate' }, [
    el('div', { html: icon(iconName), style: 'line-height:0' }),
    el('h2', { text: title }),
    el('p', { class: 'muted', style: 'margin-top:8px', text: message }),
    el('a', { class: 'btn btn-ghost', href: '/', style: 'margin-top:20px', text: 'Go to DAC Talent' }),
  ]);

async function load() {
  try {
    const data = await api.get(`/api/public/offers/${encodeURIComponent(token)}`);
    paint(data);
  } catch (err) {
    root.innerHTML = '';
    root.append(gate(
      err?.status === 409 ? 'alert' : 'lock',
      err?.status === 409 ? 'This offer is no longer active' : 'We cannot open this letter',
      err instanceof ApiError ? err.message : 'Something went wrong. Try the link again, or contact the AI Cell office.',
    ));
  }
}

function paint(data) {
  const { offer, candidate, letterHtml, expired } = data;
  document.title = `Offer — ${offer.positionTitle} — DAC`;

  const banner = (() => {
    if (offer.status === 'accepted') {
      return el('div', { class: 'offer-banner is-accepted' }, [
        el('span', { html: icon('check'), style: 'line-height:0' }),
        el('div', [
          el('h2', { text: 'You accepted this offer' }),
          el('p', { text: `Accepted on ${new Date(offer.acceptedAt).toLocaleString('en-IN')}. The AI Cell office will be in touch about onboarding.` }),
        ]),
      ]);
    }
    if (offer.status === 'declined') {
      return el('div', { class: 'offer-banner is-declined' }, [
        el('span', { html: icon('info'), style: 'line-height:0' }),
        el('div', [
          el('h2', { text: 'You declined this offer' }),
          el('p', { text: 'Thanks for letting us know. The letter stays here for your records.' }),
        ]),
      ]);
    }
    if (expired) {
      return el('div', { class: 'offer-banner is-dead' }, [
        el('span', { html: icon('clock'), style: 'line-height:0' }),
        el('div', [
          el('h2', { text: 'This offer has lapsed' }),
          el('p', { text: `It was valid until ${data.expiresOnLabel}. Contact the AI Cell office if you would still like to take it up.` }),
        ]),
      ]);
    }
    return el('div', { class: 'offer-banner is-open' }, [
      el('span', { html: icon('award'), style: 'line-height:0' }),
      el('div', [
        el('h2', { text: `Congratulations, ${candidate.fullName.split(' ')[0]}.` }),
        el('p', { text: offer.expiresOn
          ? `Read the letter below, then accept or decline. Please respond by ${data.expiresOnLabel}.`
          : 'Read the letter below, then accept or decline.' }),
      ]),
    ]);
  })();

  const letter = el('div');
  letter.innerHTML = letterHtml; // server-rendered and escaped

  const canRespond = offer.status === 'sent' && !expired;

  const actions = el('div', { class: 'offer-actions no-print' }, canRespond ? [
    el('button', { class: 'btn btn-ghost btn-lg', type: 'button', text: 'Decline', onClick: () => respond('decline') }),
    el('button', { class: 'btn btn-good btn-lg', type: 'button', html: `${icon('check')}Accept this offer`, onClick: () => respond('accept') }),
  ] : [
    el('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('download')}Save as PDF`, onClick: () => window.print() }),
  ]);

  root.innerHTML = '';
  root.append(el('div', { class: 'offer-sheet' }, [banner, letter, actions]));
}

function respond(decision) {
  const accepting = decision === 'accept';
  const reasonArea = el('textarea', {
    class: 'textarea', rows: '3',
    placeholder: 'Optional — it genuinely helps us improve.',
  });

  modal({
    title: accepting ? 'Accept this offer?' : 'Decline this offer?',
    body: el('div', { class: 'stack' }, [
      el('p', { class: 'muted', text: accepting
        ? 'This confirms you are taking the role on the terms in the letter. The AI Cell office is notified straight away, and this cannot be undone from here.'
        : 'We will let the panel know. This cannot be undone from here.' }),
      accepting ? null : el('div', { class: 'field' }, [
        el('label', { text: 'Anything you would like to tell us?' }),
        reasonArea,
      ]),
    ]),
    footer: (close) => [
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Go back', onClick: () => close() }),
      el('button', {
        class: `btn ${accepting ? 'btn-good' : 'btn-danger'}`, type: 'button',
        text: accepting ? 'Yes, I accept' : 'Decline the offer',
        onClick: async (e) => {
          const restore = busy(e.currentTarget, 'Sending…');
          try {
            await api.post(`/api/public/offers/${encodeURIComponent(token)}/respond`, {
              decision, reason: reasonArea.value || undefined,
            });
            close();
            toast(accepting ? 'Accepted. Welcome to the DGU AI Cell.' : 'Thanks for letting us know.', 'good', 6000);
            load();
          } catch (err) {
            restore();
            toast(err instanceof ApiError ? err.message : 'Could not record your response.', 'error');
          }
        },
      }),
    ],
  });
}

load();
