// POST /.netlify/functions/submit-mini-questionnaire
//
// The short pre-session form for mini sessions (questionnaire-mini.html),
// linked from the booking confirmation email. Deliberately not the full
// session questionnaire: a 15-minute mini doesn't warrant seventeen questions
// or a PDF, so this is four fields and two plain emails.

const { Resend } = require('resend');

const FROM = 'Still & Golden <notifications@stillandgolden.com.au>';
const OWNER_EMAIL = 'hello@stillandgolden.com.au';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

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
  // Answered with 200 rather than an error — a bot that learns it failed just
  // tries again with the field left blank.
  if ((data.company || '').trim()) {
    console.log('submit-mini-questionnaire: honeypot tripped, discarding silently');
    return json(200, { success: true });
  }

  // Validated here as well as on the form: the form's checks are a browser
  // convenience and say nothing about what actually reaches this function.
  const name = (data.name || '').trim();
  if (!name) {
    return json(400, { error: 'Please add your name so I know whose answers these are.' });
  }

  const clientEmail = (data.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
    return json(400, { error: 'Please add a valid email address so I can send you a copy.' });
  }

  const joining = (data.joining || '').trim();
  if (!joining) {
    return json(400, { error: 'Please tell me who is joining you.' });
  }

  const anythingElse = (data.anythingElse || '').trim();
  const slot = (data.slot || '').trim();

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const ownerLines = [
      'Mini session — pre-session form',
      '',
      `Name: ${name}`,
      `Email: ${clientEmail}`,
    ];
    if (slot) ownerLines.push(`Session: ${slot}`);
    ownerLines.push('', 'Who\'s joining:', joining);
    if (anythingElse) ownerLines.push('', 'Anything to know:', anythingElse);

    await resend.emails.send({
      from: FROM,
      to: OWNER_EMAIL,
      replyTo: clientEmail,
      subject: `Mini pre-session form — ${name}${slot ? ` (${slot})` : ''}`,
      text: ownerLines.join('\n'),
    });

    // Their own copy, so the answers exist in writing on both sides.
    const clientLines = [
      `Hi ${name.split(' ')[0]},`,
      '',
      'Thanks — that\'s everything I need before your session. Here\'s what you sent me:',
      '',
      `Who's joining: ${joining}`,
    ];
    if (anythingElse) clientLines.push('', `Anything to know: ${anythingElse}`);
    clientLines.push(
      '',
      'Christmas outfits are very welcome, and if the morning goes sideways and you arrive in whatever was clean, that is genuinely fine too.',
      '',
      'If anything changes between now and the day, just reply to this email.',
      '',
      'See you soon,',
      'Deep',
      'Still & Golden Photography',
    );

    await resend.emails.send({
      from: FROM,
      to: clientEmail,
      replyTo: OWNER_EMAIL,
      subject: 'Your mini session details — Still & Golden',
      text: clientLines.join('\n'),
    });

    return json(200, { success: true });
  } catch (err) {
    console.error('submit-mini-questionnaire error:', err);
    return json(500, { error: 'Failed to process submission' });
  }
};
