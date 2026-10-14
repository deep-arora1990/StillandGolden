// POST /.netlify/functions/submit-model-call-questionnaire
//
// The pre-session form for model call sessions (generic, so it can be reused for future model calls)
// (model-call-questionnaire.html). Built on submit-mini-questionnaire: a short
// form, no PDF, two emails. The only addition is an HTML part alongside the
// plain text, so everything the client typed is escaped before it goes into it.
// Copy: brand/model-call/model-call-forms.md §2.

const { Resend } = require('resend');

const FROM = 'Still & Golden <notifications@stillandgolden.com.au>';
const OWNER_EMAIL = 'hello@stillandgolden.com.au';
const STYLE_GUIDE_URL = 'https://stillandgolden.com.au/style-guide';


const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// "2026-11-20" -> "Friday 20 November 2026". Anything else is shown as typed.
function prettyDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// One list of [label, answer] rows feeds both the text and the HTML version,
// so the two can't drift apart.
function toText(rows) {
  return rows.map(([label, value]) => (label ? `${label}: ${value}` : value)).join('\n');
}
function toHtml(rows) {
  const body = rows.map(([label, value]) => {
    if (!label && !value) return '';
    const v = escapeHtml(value).replace(/\n/g, '<br>');
    return label
      ? `<p style="margin:0 0 12px;"><strong style="font-weight:600;">${escapeHtml(label)}:</strong><br>${v}</p>`
      : `<p style="margin:0 0 12px;">${v}</p>`;
  }).join('\n');
  return `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.6;color:#1A1714;">\n${body}\n</div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set in the environment.');
    return { statusCode: 500, body: 'Email service is not configured.' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  // Honeypot: a real person never sees this field, so anything in it is a bot.
  // Answered with 200 so a bot doesn't learn to leave it blank.
  if (String(data.company || '').trim()) {
    console.log('submit-model-call-questionnaire: honeypot tripped, discarding silently');
    return json(200, { success: true });
  }

  const field = (k) => String(data[k] || '').trim();

  // Validated here as well as on the form: the form's checks are a browser
  // convenience and say nothing about what actually reaches this function.
  const name = field('name');
  if (!name) {
    return json(400, { error: 'Please add your name so I know whose answers these are.' });
  }

  const clientEmail = field('email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
    return json(400, { error: 'Please add a valid email address so I can send you a copy.' });
  }

  // The session time is texted, so a mobile is required, not a nice-to-have.
  const mobile = field('mobile');
  if (mobile.replace(/\D/g, '').length < 8) {
    return json(400, { error: 'Please add your mobile so I can text you the exact time.' });
  }

  const joining = field('joining');
  if (!joining) {
    return json(400, { error: 'Please tell me who is joining you.' });
  }

  const sessionDate = field('sessionDate');
  const kidsInto = field('kidsInto');
  const shy = field('shy');
  const anythingElse = field('anythingElse');
  const dateLine = sessionDate
    ? (prettyDate(sessionDate) === sessionDate ? sessionDate : `${prettyDate(sessionDate)} (${sessionDate})`)
    : '';

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const ownerRows = [
      ['', 'Model call questionnaire'],
      ['', ''],
      ['Name', name],
      ['Email', clientEmail],
      ['Mobile', mobile],
    ];
    if (dateLine) ownerRows.push(['Session date', dateLine]);
    ownerRows.push(['', ''], ['Who\'s joining', joining]);
    if (kidsInto) ownerRows.push(['Kids are into', kidsInto]);
    if (shy) ownerRows.push(['Shy, or would rather not be photographed', shy]);
    if (anythingElse) ownerRows.push(['Anything to know', anythingElse]);

    await resend.emails.send({
      from: FROM,
      to: OWNER_EMAIL,
      replyTo: clientEmail,
      subject: `[S&G] Model call questionnaire — ${name}`,
      text: toText(ownerRows),
      html: toHtml(ownerRows),
    });

    // Their own copy, so the answers exist in writing on both sides.
    const clientRows = [
      ['', `Hi ${name.split(' ')[0]},`],
      ['', ''],
      ['', 'Thanks, that\'s everything I need before your session. Here\'s what you sent me:'],
      ['', ''],
    ];
    if (sessionDate) clientRows.push(['Session date', prettyDate(sessionDate)]);
    clientRows.push(['Mobile', mobile], ['Who\'s joining', joining]);
    if (kidsInto) clientRows.push(['What the kids are into', kidsInto]);
    if (shy) clientRows.push(['Shy, or would rather not be photographed', shy]);
    if (anythingElse) clientRows.push(['Anything to know', anythingElse]);

    const clientClose = [
      '',
      'Wear what you feel most like yourselves in. If you\'d like some ideas, my style guide has the colours and textures I love photographing. It\'s there for inspiration, not rules.',
      STYLE_GUIDE_URL,
      '',
      'I\'ll text you the exact time closer to the day. If anything changes before then, just reply to this email.',
      '',
      'See you soon,',
      'Deep',
      'Still & Golden Photography',
    ];

    const clientHtml = toHtml(clientRows).replace(/\n<\/div>$/, '') + `
<p style="margin:0 0 12px;">Wear what you feel most like yourselves in. If you'd like some ideas, my <a href="${STYLE_GUIDE_URL}" style="color:#A8845A;">style guide</a> has the colours and textures I love photographing. It's there for inspiration, not rules.</p>
<p style="margin:0 0 12px;">I'll text you the exact time closer to the day. If anything changes before then, just reply to this email.</p>
<p style="margin:0;">See you soon,<br>Deep<br>Still &amp; Golden Photography</p>
</div>`;

    await resend.emails.send({
      from: FROM,
      to: clientEmail,
      replyTo: OWNER_EMAIL,
      subject: 'Your session details from Still & Golden',
      text: [toText(clientRows), ...clientClose].join('\n'),
      html: clientHtml,
    });

    return json(200, { success: true });
  } catch (err) {
    console.error('submit-model-call-questionnaire error:', err);
    return json(500, { error: 'Failed to process submission' });
  }
};
