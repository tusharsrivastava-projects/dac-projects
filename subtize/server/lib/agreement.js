/**
 * The Subtize.ai Lister Agreement, in English and Hindi. Sections are data so
 * the lister dashboard, the admin console and the downloadable signed copy
 * all render exactly the same words.
 */

export function agreementSections({ commission = 20, business = '', listerName = '', agreementId = '', verificationId = '' }) {
  const payout = 100 - commission;
  const en = [
    ['Parties', `This Lister Agreement ("Agreement") is made between Subtize.ai ("Subtize.ai", "the Platform") and ${listerName || 'the Lister'}${business ? `, trading as ${business}` : ''} ("the Lister"). Agreement ID ${agreementId}; Lister Verification ID ${verificationId}.`],
    ['Purpose', 'The Lister offers subscription-based services to members of the public through the Platform. The Platform lists those services, collects subscription payments through its official payment accounts, verifies each payment, and activates subscriptions for members.'],
    ['Platform commission', `Subtize.ai will retain ${commission}% of the total subscription revenue generated through the Lister's services on the platform during a month. The remaining ${payout}% will be payable to the Lister according to the applicable monthly settlement process.`],
    ['Monthly settlement', `At the end of each calendar month the Platform totals the verified subscription payments for the Lister's services, deducts the ${commission}% platform commission, and settles the remaining ${payout}% to the bank account verified during onboarding. Settlement statements are available in the Lister Dashboard.`],
    ['Official payments only', 'All subscription payments must be made to the official Subtize.ai payment QR or UPI account shown at checkout. The Lister must not collect payment for Platform subscriptions directly, share a personal payment QR with members, or ask members to pay outside the Platform.'],
    ['Service delivery', "The Lister will honour every active subscription according to the service's published availability days, usage policy, restrictions and rules, and will verify members by their Subtize.ai digital subscription card."],
    ['Pricing and financial settings', "Subscription prices, the official payment QR, the commission rate and settlement configuration can only be changed by the Platform. The Lister may request a change through the Lister Dashboard; it takes effect only once approved by Subtize.ai."],
    ['Privacy', "The Platform does not show the Lister's name, personal details, banking information, identity documents or verification data to members. The Lister will use member information only to deliver the subscribed service and will not share it with anyone else."],
    ['Cancellations', 'Members may cancel a subscription through the Platform. Cancellations and any adjustments are reflected in the monthly settlement statement.'],
    ['Verification and suspension', 'The Lister confirms that the documents and details submitted for verification are genuine. The Platform may suspend listings or this Agreement if they are found to be false, or if the Lister breaches this Agreement.'],
    ['Term and termination', 'This Agreement starts on the date both parties have signed it and continues until either party ends it with 30 days\' written notice through the Platform. Subscriptions already paid for will be honoured until they end.'],
    ['Electronic signature', 'Both parties agree that signing electronically through the Platform is as binding as a handwritten signature.'],
  ];
  const hi = [
    ['पक्षकार', `यह लिस्टर अनुबंध ("अनुबंध") Subtize.ai ("Subtize.ai", "प्लेटफ़ॉर्म") और ${listerName || 'लिस्टर'}${business ? ` (व्यवसाय: ${business})` : ''} ("लिस्टर") के बीच किया गया है। अनुबंध आईडी ${agreementId}; लिस्टर सत्यापन आईडी ${verificationId}।`],
    ['उद्देश्य', 'लिस्टर प्लेटफ़ॉर्म के माध्यम से आम लोगों को सदस्यता-आधारित सेवाएँ प्रदान करता है। प्लेटफ़ॉर्म इन सेवाओं को सूचीबद्ध करता है, अपने आधिकारिक भुगतान खातों के माध्यम से सदस्यता भुगतान प्राप्त करता है, प्रत्येक भुगतान का सत्यापन करता है और सदस्यों के लिए सदस्यता सक्रिय करता है।'],
    ['प्लेटफ़ॉर्म कमीशन', `Subtize.ai किसी माह के दौरान प्लेटफ़ॉर्म पर लिस्टर की सेवाओं के माध्यम से उत्पन्न कुल सदस्यता राजस्व का ${commission}% अपने पास रखेगा। शेष ${payout}% लागू मासिक निपटान प्रक्रिया के अनुसार लिस्टर को देय होगा।`],
    ['मासिक निपटान', `प्रत्येक कैलेंडर माह के अंत में प्लेटफ़ॉर्म लिस्टर की सेवाओं के सत्यापित सदस्यता भुगतानों का योग करेगा, ${commission}% प्लेटफ़ॉर्म कमीशन घटाएगा, और शेष ${payout}% ऑनबोर्डिंग के समय सत्यापित बैंक खाते में भेजेगा। निपटान विवरण लिस्टर डैशबोर्ड में उपलब्ध रहेगा।`],
    ['केवल आधिकारिक भुगतान', 'सभी सदस्यता भुगतान केवल चेकआउट पर दिखाए गए आधिकारिक Subtize.ai भुगतान QR या UPI खाते में ही किए जाएँगे। लिस्टर प्लेटफ़ॉर्म की सदस्यताओं के लिए सीधे भुगतान नहीं लेगा, सदस्यों को अपना निजी भुगतान QR नहीं देगा, और सदस्यों से प्लेटफ़ॉर्म के बाहर भुगतान करने के लिए नहीं कहेगा।'],
    ['सेवा प्रदान करना', 'लिस्टर प्रत्येक सक्रिय सदस्यता को सेवा के प्रकाशित उपलब्धता दिनों, उपयोग नीति, प्रतिबंधों और नियमों के अनुसार पूरा करेगा, और सदस्यों की पहचान उनके Subtize.ai डिजिटल सदस्यता कार्ड से करेगा।'],
    ['मूल्य और वित्तीय सेटिंग्स', 'सदस्यता मूल्य, आधिकारिक भुगतान QR, कमीशन दर और निपटान व्यवस्था केवल प्लेटफ़ॉर्म द्वारा बदली जा सकती है। लिस्टर डैशबोर्ड के माध्यम से बदलाव का अनुरोध कर सकता है; यह Subtize.ai की स्वीकृति के बाद ही लागू होगा।'],
    ['गोपनीयता', 'प्लेटफ़ॉर्म सदस्यों को लिस्टर का नाम, व्यक्तिगत विवरण, बैंकिंग जानकारी, पहचान दस्तावेज़ या सत्यापन डेटा नहीं दिखाता। लिस्टर सदस्यों की जानकारी का उपयोग केवल सदस्यता सेवा प्रदान करने के लिए करेगा और इसे किसी और के साथ साझा नहीं करेगा।'],
    ['रद्दीकरण', 'सदस्य प्लेटफ़ॉर्म के माध्यम से सदस्यता रद्द कर सकते हैं। रद्दीकरण और कोई भी समायोजन मासिक निपटान विवरण में दर्शाए जाएँगे।'],
    ['सत्यापन और निलंबन', 'लिस्टर पुष्टि करता है कि सत्यापन के लिए दिए गए दस्तावेज़ और विवरण वास्तविक हैं। यदि वे गलत पाए जाते हैं या लिस्टर इस अनुबंध का उल्लंघन करता है, तो प्लेटफ़ॉर्म लिस्टिंग या इस अनुबंध को निलंबित कर सकता है।'],
    ['अवधि और समाप्ति', 'यह अनुबंध दोनों पक्षों के हस्ताक्षर की तिथि से प्रारंभ होगा और तब तक जारी रहेगा जब तक कोई भी पक्ष प्लेटफ़ॉर्म के माध्यम से 30 दिन की लिखित सूचना देकर इसे समाप्त न करे। पहले से भुगतान की गई सदस्यताएँ उनकी अवधि पूरी होने तक जारी रहेंगी।'],
    ['इलेक्ट्रॉनिक हस्ताक्षर', 'दोनों पक्ष सहमत हैं कि प्लेटफ़ॉर्म के माध्यम से किया गया इलेक्ट्रॉनिक हस्ताक्षर हस्तलिखित हस्ताक्षर के समान ही बाध्यकारी है।'],
  ];
  return {
    en: en.map(([heading, body]) => ({ heading, body })),
    hi: hi.map(([heading, body]) => ({ heading, body })),
  };
}

export const agreementStatusLabel = {
  pending_lister: 'Awaiting lister signature',
  pending_admin: 'Awaiting Subtize.ai approval',
  active: 'Active',
  terminated: 'Terminated',
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A self-contained HTML copy of the agreement, suitable for saving or printing to PDF. */
export function agreementDocument(a) {
  const { en, hi } = agreementSections(a);
  const section = (s, i) => `<section><h3>${i + 1}. ${esc(s.heading)}</h3><p>${esc(s.body)}</p></section>`;
  const signed = (label, name, when, img) => `
    <div class="sig">
      <div class="k">${esc(label)}</div>
      ${img ? `<img src="${esc(img)}" alt="Signature">` : '<div class="line"></div>'}
      <div class="n">${esc(name || 'Not signed')}</div>
      <div class="d">${when ? `Signed ${esc(when)} UTC` : ''}</div>
    </div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Subtize.ai Lister Agreement ${esc(a.agreementId)}</title>
<style>
  body{font-family:Inter,"Segoe UI",Roboto,"Noto Sans Devanagari",Arial,sans-serif;color:#0b0f0d;max-width:820px;margin:32px auto;padding:0 24px;line-height:1.6}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #16a34a;padding-bottom:16px;margin-bottom:24px}
  .brand{font-size:26px;font-weight:800}.brand span{color:#16a34a}
  .meta{font-size:13px;text-align:right;color:#334139}
  h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px;color:#15803d}h3{font-size:15px;margin:16px 0 4px}
  p{margin:0 0 8px}.hi{font-family:"Noto Sans Devanagari","Mangal",Inter,sans-serif}
  .status{display:inline-block;padding:2px 10px;border-radius:999px;background:#dcfce7;color:#14532d;font-weight:700;font-size:12px}
  .sigs{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px;page-break-inside:avoid}
  .sig{border:1px solid #d4ddd8;border-radius:12px;padding:16px}.sig .k{font-size:12px;color:#51605a;text-transform:uppercase;letter-spacing:.08em}
  .sig img{max-height:80px;max-width:100%;display:block;margin:8px 0}.sig .line{height:60px;border-bottom:1px dashed #9aa8a1;margin:8px 0}
  .sig .n{font-weight:700}.sig .d{font-size:12px;color:#51605a}
  footer{margin-top:32px;font-size:12px;color:#51605a;border-top:1px solid #d4ddd8;padding-top:12px}
  @media print{body{margin:0}}
</style></head><body>
<header><div><div class="brand">Subtize<span>.ai</span></div><h1>Lister Agreement · लिस्टर अनुबंध</h1>
<span class="status">${esc(agreementStatusLabel[a.status] || a.status)}</span></div>
<div class="meta">Agreement ID <b>${esc(a.agreementId)}</b><br>Verification ID <b>${esc(a.verificationId)}</b><br>Version ${esc(a.version)}<br>Commission ${esc(a.commission)}%</div></header>
<h2>English</h2>${en.map(section).join('')}
<h2 class="hi">हिंदी अनुवाद</h2><div class="hi">${hi.map(section).join('')}</div>
<p style="font-size:12px;color:#51605a;margin-top:16px">If the English and Hindi texts differ, the English text prevails. / यदि अंग्रेज़ी और हिंदी पाठ में अंतर हो, तो अंग्रेज़ी पाठ मान्य होगा।</p>
<div class="sigs">
  ${signed(`Lister · ${a.business || ''}`, a.listerSignedName, a.listerSignedAt, a.listerSignature)}
  ${signed('For Subtize.ai', a.adminSignedName, a.adminSignedAt, null)}
</div>
<footer>Generated ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC by Subtize.ai. Electronic signatures recorded with timestamp${a.listerSignedIp ? ` and IP ${esc(a.listerSignedIp)}` : ''}.</footer>
</body></html>`;
}

export function agreementView(row, { includeSignature = true } = {}) {
  const a = {
    id: row.id,
    agreementId: row.public_id,
    verificationId: row.verification_id,
    status: row.status,
    statusLabel: agreementStatusLabel[row.status],
    commission: row.commission_percent,
    version: row.version,
    listerId: row.lister_id,
    listerName: row.lister_name,
    business: row.business_name,
    listerSignedName: row.lister_signed_name,
    listerSignedAt: row.lister_signed_at,
    listerSignature: includeSignature ? row.lister_signature : undefined,
    adminSignedName: row.admin_signed_name,
    adminSignedAt: row.admin_signed_at,
    createdAt: row.created_at,
    terminatedAt: row.terminated_at,
  };
  a.sections = agreementSections(a);
  return a;
}

export const AGREEMENT_SELECT = `
  SELECT a.*, u.full_name AS lister_name, u.email AS lister_email,
         (SELECT business_name FROM lister_applications WHERE id = a.application_id) AS business_name
    FROM agreements a JOIN users u ON u.id = a.lister_id`;
