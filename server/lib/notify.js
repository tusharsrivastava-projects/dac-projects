import { config } from '../config.js';
import { sendMail } from './mailer.js';
import { esc } from './offerLetter.js';

const shell = (heading, paragraphs, cta = null) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f3f0fa;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:26px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#fff;border-radius:14px;overflow:hidden;
                    box-shadow:0 8px 32px rgba(40,16,72,.10);">
        <tr><td style="background:linear-gradient(120deg,#1a0b2e,#3d1670 55%,#6a2bb0);padding:22px 28px;">
          <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:.14em;">D<span style="color:#c58bff;">A</span>C</div>
          <div style="color:#cdb6ef;font-size:10.5px;letter-spacing:.22em;margin-top:3px;">( DGU AI CELL )</div>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 14px;font-size:19px;color:#1b1626;">${esc(heading)}</h1>
          ${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:14.5px;line-height:1.65;color:#3c3450;">${p}</p>`).join('')}
          ${cta ? `<div style="margin:24px 0 4px;">
             <a href="${esc(cta.href)}" style="display:inline-block;background:#6a2bb0;color:#fff;font-size:14.5px;
                font-weight:700;text-decoration:none;padding:12px 26px;border-radius:9px;">${esc(cta.label)}</a>
           </div>` : ''}
        </td></tr>
        <tr><td style="background:#faf8ff;padding:15px 28px;font-size:11.5px;color:#8a82a0;border-top:1px solid #ece4f8;">
          ${esc(config.org.name)} · ${esc(config.org.address)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const dispatch = (to, toName, subject, heading, paragraphs, cta, kind, relatedId) =>
  sendMail({
    to, toName, subject,
    html: shell(heading, paragraphs, cta),
    text: `${heading}\n\n${paragraphs.map(strip).join('\n\n')}${cta ? `\n\n${cta.label}: ${cta.href}` : ''}`,
    kind, relatedId,
  });

export const notifyApplicationReceived = ({ candidate, job, application, link }) =>
  dispatch(
    candidate.email, candidate.full_name,
    `We have your application — ${job.title}`,
    `Thanks, ${esc(candidate.full_name.split(' ')[0])}.`,
    [
      `Your application for <strong>${esc(job.title)}</strong> reached us on ${new Date().toLocaleDateString('en-IN')}.`,
      'A reviewer from the AI Cell will read it shortly. If they want to take it further you will get an audio interview to complete, right inside your dashboard.',
      'Nothing to do from your side until then.',
    ],
    link ? { label: 'Open your dashboard', href: link } : null,
    'application.received', application.id,
  );

export const notifyInterviewUnlocked = ({ candidate, job, application, link }) =>
  dispatch(
    candidate.email, candidate.full_name,
    `Your audio interview is open — ${job.title}`,
    'Your interview is ready.',
    [
      `Good news — your application for <strong>${esc(job.title)}</strong> cleared the first read.`,
      'The next step is a short recorded interview. You will see each question on screen, get a moment to think, then record your answer straight from the browser. No scheduling, no call.',
      'Find a quiet room and give yourself twenty minutes.',
    ],
    link ? { label: 'Start your interview', href: link } : null,
    'interview.unlocked', application.id,
  );

export const notifyUnderReview = ({ candidate, job, application, link }) =>
  dispatch(
    candidate.email, candidate.full_name,
    `Interview received — ${job.title}`,
    'We have your answers.',
    [
      `All of your recorded answers for <strong>${esc(job.title)}</strong> are in and queued for the panel.`,
      'Each answer gets listened to and scored by a person. Expect to hear back within a week.',
    ],
    link ? { label: 'Track your application', href: link } : null,
    'application.under_review', application.id,
  );

export const notifyApproved = ({ candidate, job, application, link }) =>
  dispatch(
    candidate.email, candidate.full_name,
    `Approved — ${job.title}`,
    'The panel said yes.',
    [
      `Your application for <strong>${esc(job.title)}</strong> has been approved by the DAC review panel.`,
      'Your formal offer letter is being prepared and will land in your inbox shortly, with a link to accept or decline.',
    ],
    link ? { label: 'Open your dashboard', href: link } : null,
    'application.approved', application.id,
  );

export const notifyRejected = ({ candidate, job, application, reason }) =>
  dispatch(
    candidate.email, candidate.full_name,
    `Update on your application — ${job.title}`,
    'An update from the AI Cell.',
    [
      `We have finished reviewing your application for <strong>${esc(job.title)}</strong>, and we will not be moving ahead this time.`,
      reason ? `<em>${esc(reason)}</em>` : 'The field was strong and these calls are rarely clear-cut.',
      'Your profile stays with us. Please do apply again when something closer to your work opens up.',
    ],
    null, 'application.rejected', application.id,
  );

export const notifyOfferResponded = ({ admins, candidate, job, offer, accepted, reason }) =>
  Promise.all(admins.map((admin) => dispatch(
    admin.email, admin.full_name,
    `${accepted ? 'Offer accepted' : 'Offer declined'} — ${candidate.full_name}, ${job.title}`,
    accepted ? 'An offer was accepted.' : 'An offer was declined.',
    [
      `<strong>${esc(candidate.full_name)}</strong> ${accepted ? 'accepted' : 'declined'} the offer for <strong>${esc(offer.position_title)}</strong>.`,
      reason ? `Reason given: <em>${esc(reason)}</em>` : '',
      `Responded at ${new Date().toLocaleString('en-IN')}.`,
    ].filter(Boolean),
    null, accepted ? 'offer.accepted' : 'offer.declined', offer.id,
  )));
