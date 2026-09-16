import { config } from '../config.js';
import { offerReference } from './ids.js';

export const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export const prettyDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** Absolute URL for the candidate-facing offer page. */
export function offerUrl(token, req = null) {
  if (config.baseUrl) return `${config.baseUrl}/offer/${token}`;
  if (req) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    return `${proto}://${req.get('host')}/offer/${token}`;
  }
  return `http://localhost:${config.port}/offer/${token}`;
}

const row = (label, value) => `
  <tr>
    <td style="padding:9px 16px 9px 0;color:#6b6480;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
    <td style="padding:9px 0;color:#1b1626;font-size:14px;font-weight:600;">${esc(value || '—')}</td>
  </tr>`;

/**
 * The letter body itself — shared by the public offer page and the email.
 * Kept to inline styles and tables so mail clients render it the same way.
 */
export function renderLetterBody({ offer, application, candidate, job }) {
  const ref = offerReference(application.id);
  const terms = String(offer.extra_terms || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return `
<div style="font-family:Georgia,'Times New Roman',serif;color:#1b1626;line-height:1.65;">
  <p style="margin:0 0 6px;color:#6b6480;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">
    Ref ${esc(ref)} &nbsp;•&nbsp; ${esc(prettyDate(offer.sent_at || offer.created_at))}
  </p>

  <p style="margin:22px 0 0;font-size:16px;">Dear ${esc(candidate.full_name)},</p>

  <p style="margin:16px 0 0;font-size:15px;">
    Thank you for the time you gave us through the ${esc(job.title)} process — the written application
    and the recorded interview both went to the panel, and we liked what we heard.
  </p>

  <p style="margin:14px 0 0;font-size:15px;">
    We are pleased to offer you the position of <strong>${esc(offer.position_title)}</strong>
    at ${esc(config.org.name)}${config.org.parent ? `, ${esc(config.org.parent)}` : ''}.
    The terms are set out below.
  </p>

  <table role="presentation" cellpadding="0" cellspacing="0"
         style="width:100%;margin:22px 0 0;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;
                background:#faf8ff;border:1px solid #e6dcf7;border-radius:10px;padding:6px 18px;">
    ${row('Position', offer.position_title)}
    ${row('Team', offer.department)}
    ${row('Engagement', offer.employment_type)}
    ${row('Location', offer.location)}
    ${row('Compensation', offer.compensation)}
    ${row('Start date', prettyDate(offer.start_date))}
    ${row('Reporting to', offer.reporting_to)}
    ${offer.expires_on ? row('Offer valid until', prettyDate(offer.expires_on)) : ''}
  </table>

  ${terms.length
    ? `<div style="margin:22px 0 0;font-size:14.5px;">
         <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.08em;
                   text-transform:uppercase;color:#6b6480;">Additional terms</p>
         ${terms.map((p) => `<p style="margin:0 0 10px;">${esc(p)}</p>`).join('')}
       </div>`
    : ''}

  <p style="margin:20px 0 0;font-size:15px;">
    This offer is made on the strength of the information you shared with us. Accepting it confirms that
    the details in your application are accurate and that you are free to take up the role on the date above.
  </p>

  <p style="margin:14px 0 0;font-size:15px;">
    Use the button on this page to accept or decline. If anything here needs adjusting, reply to this
    letter's sender before you respond and we will talk it through.
  </p>

  <p style="margin:26px 0 0;font-size:15px;">Warm regards,</p>
  <p style="margin:6px 0 0;font-size:15px;">
    <strong>${esc(config.org.signatoryName)}</strong><br>
    <span style="color:#6b6480;font-size:13.5px;">${esc(config.org.signatory)}, ${esc(config.org.name)}</span><br>
    <span style="color:#6b6480;font-size:13.5px;">${esc(config.org.address)}</span>
  </p>
</div>`;
}

/** Full HTML email wrapper around the letter body. */
export function renderOfferEmail({ offer, application, candidate, job, link }) {
  const body = renderLetterBody({ offer, application, candidate, job });
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f0fa;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0fa;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0"
             style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;
                    box-shadow:0 10px 40px rgba(40,16,72,.12);">
        <tr>
          <td style="background:linear-gradient(120deg,#1a0b2e,#3d1670 55%,#6a2bb0);padding:26px 32px;">
            <div style="font-family:Arial,Helvetica,sans-serif;color:#fff;font-size:22px;font-weight:800;letter-spacing:.14em;">
              D<span style="color:#c58bff;">A</span>C
            </div>
            <div style="font-family:Arial,Helvetica,sans-serif;color:#cdb6ef;font-size:11px;letter-spacing:.22em;margin-top:4px;">
              ( DGU AI CELL )
            </div>
          </td>
        </tr>
        <tr><td style="padding:32px;">${body}
          <div style="text-align:center;margin:30px 0 6px;">
            <a href="${esc(link)}"
               style="display:inline-block;background:#6a2bb0;color:#fff;font-family:Arial,Helvetica,sans-serif;
                      font-size:15px;font-weight:700;text-decoration:none;padding:14px 30px;border-radius:10px;">
              View &amp; respond to your offer
            </a>
          </div>
          <p style="text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a82a0;margin:10px 0 0;word-break:break-all;">
            ${esc(link)}
          </p>
        </td></tr>
        <tr>
          <td style="background:#faf8ff;padding:18px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#8a82a0;border-top:1px solid #ece4f8;">
            This link is personal to you. Please do not forward it.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Dear ${candidate.full_name},`,
    '',
    `We are pleased to offer you the position of ${offer.position_title} at ${config.org.name}.`,
    '',
    `Position:     ${offer.position_title}`,
    `Team:         ${offer.department || '—'}`,
    `Engagement:   ${offer.employment_type || '—'}`,
    `Location:     ${offer.location || '—'}`,
    `Compensation: ${offer.compensation || '—'}`,
    `Start date:   ${prettyDate(offer.start_date)}`,
    offer.expires_on ? `Valid until:  ${prettyDate(offer.expires_on)}` : '',
    '',
    'View and respond to your offer here:',
    link,
    '',
    `— ${config.org.signatoryName}, ${config.org.signatory}`,
    config.org.name,
  ].filter((l) => l !== '').join('\n');

  return {
    subject: `Your offer from ${config.org.shortName} — ${offer.position_title}`,
    html,
    text,
  };
}
