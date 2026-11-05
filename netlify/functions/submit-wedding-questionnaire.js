// POST /.netlify/functions/submit-wedding-questionnaire
//
// The wedding questionnaire (wedding-questionnaire.html). It goes out from
// Studio only (booking-link-send, kind questionnaire), never automatically
// on signing. Answers go to Deep, to the couple (both partners when the
// partner's email is known) and to Studio's Bookings screen.
//
// There is deliberately no image-consent question here, no image_consent
// field, and nothing is posted to STUDIO_QUESTIONNAIRE_INGEST_URL.
//
// The token is optional. A valid wedding link supplies the package, the day
// and the appointment; a link that doesn't verify is ignored so the answers
// aren't lost; a family link is refused.

const { Resend } = require('resend');
const { verify: verifyBookingLink } = require('./lib/booking-links');
const { TIERS } = require('./lib/setmore');
const { postBookingEvent } = require('./lib/studio-sync');
const { brandedEmail } = require('./lib/email-layout');

const FROM = 'Still & Golden <notifications@stillandgolden.com.au>';
const OWNER_EMAIL = 'hello@stillandgolden.com.au';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ANSWER = 5000;

const QUESTIONS = [
  { section: 'The basics', key: 'name', label: 'Your name' },
  { section: 'The basics', key: 'partnerName', label: "Your partner's name" },
  { section: 'The basics', key: 'email', label: 'Your email' },
  { section: 'The basics', key: 'phone', label: 'Your mobile' },
  { section: 'You two', key: 'howMet', label: 'How did you meet?' },
  { section: 'You two', key: 'whoFellFirst', label: 'Who fell for whom first?' },
  { section: 'You two', key: 'favouriteShows', label: 'Favourite movies and TV shows?' },
  { section: 'You two', key: 'forFun', label: 'What do you two do for fun?' },
  { section: 'You two', key: 'idealMeal', label: 'Your ideal meal after a big night out?' },
  { section: 'You two', key: 'bestDancer', label: 'Who has the best dance moves?' },
  { section: 'The day', key: 'ceremonyLocation', label: "Where's the ceremony?" },
  { section: 'The day', key: 'ceremonyTime', label: 'What time does it start?' },
  { section: 'The day', key: 'celebrant', label: "Your celebrant's name" },
  { section: 'The day', key: 'gettingReady', label: 'Where are you getting ready?' },
  { section: 'The day', key: 'planAfter', label: "What's the plan after?" },
  { section: 'The day', key: 'timeline', label: 'A rough timeline, if you have one' },
  { section: 'Your people', key: 'guests', label: 'Roughly how many guests?' },
  { section: 'Your people', key: 'groupShots', label: 'Family group shots' },
  { section: 'Your people', key: 'sensitive', label: 'Anything sensitive I should know?' },
  { section: 'Must-haves', key: 'mustHave', label: "The one moment you'd hate me to miss" },
  { section: 'Must-haves', key: 'avoid', label: "Anything you'd prefer I didn't photograph?" },
  { section: 'Must-haves', key: 'inspiration', label: 'A Pinterest board or looks you love' },
  { section: 'Must-haves', key: 'anythingElse', label: 'Anything else?' },
];

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const first = (name) => name.split(/\s+/)[0];
const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// One list of [label, value] rows feeds both the text and the HTML version.
// A row with no label and no value is a spacer; a row with no value is a heading.
function toText(rows) {
  return rows.map(([label, value]) => (label && value ? `${label}: ${value}` : label || value)).join('\n');
}
function toHtml(rows) {
  const body = rows.map(([label, value]) => {
    if (!label && !value) return '';
    if (label && !value) return `<p style="margin:18px 0 8px;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#A8845A;">${escapeHtml(label)}</p>`;
    const v = escapeHtml(value).replace(/\n/g, '<br>');
    return label
      ? `<p style="margin:0 0 12px;"><strong style="font-weight:600;">${escapeHtml(label)}:</strong><br>${v}</p>`
      : `<p style="margin:0 0 12px;">${v}</p>`;
  }).join('\n');
  return `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.6;color:#1A1714;">\n${body}\n</div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (!data || typeof data !== 'object') return json(400, { error: 'Invalid JSON' });

  // Honeypot: a real person never sees this field. Answered with 200 so a bot
  // doesn't learn to leave it blank.
  if (String(data.company || '').trim()) {
    console.log('submit-wedding-questionnaire: honeypot tripped, discarding silently');
    return json(200, { success: true });
  }

  const link = data.token ? verifyBookingLink(data.token) : null;
  const tier = link ? TIERS[link.s] : null;
  if (link && !(tier && tier.wedding)) {
    return json(400, { error: "This link is for a family session, not a wedding. Reply to my email and I'll sort it out." });
  }

  const A = {};
  for (const q of QUESTIONS) A[q.key] = String(data[q.key] == null ? '' : data[q.key]).trim().slice(0, MAX_ANSWER);
  if (link && link.s === 'wedding-short') A.gettingReady = '';

  if (!A.name) return json(400, { error: 'Please add your name so I know whose answers these are.' });
  if (!EMAIL.test(A.email)) return json(400, { error: 'Please add a valid email address so I can send you a copy.' });
  if (A.phone.replace(/\D/g, '').length < 8) return json(400, { error: 'Please add your mobile so we can find each other on the day.' });

  const formDate = String(data.weddingDate || '').trim();
  const weddingDate = link ? String(link.d || '') : (ISO.test(formDate) ? formDate : '');
  if (!weddingDate) return json(400, { error: 'Please add your wedding date.' });
  const pkg = tier ? tier.name : '';

  // Partner 2's address, carried in from the questionnaire link. Ignored when invalid.
  const rawPartner = String(data.partnerEmail || '').trim();
  const partnerEmail = rawPartner.length <= 200 && EMAIL.test(rawPartner) ? rawPartner : '';
  const copyTo = [];
  for (const addr of [A.email, partnerEmail]) {
    if (addr && !copyTo.some((x) => x.toLowerCase() === addr.toLowerCase())) copyTo.push(addr);
  }

  const answered = QUESTIONS.filter((q) => A[q.key]);

  if (!process.env.RESEND_API_KEY) {
    if (process.env.NETLIFY_DEV === 'true') {
      console.log('submit-wedding-questionnaire [dev, nothing sent]:', JSON.stringify({ package: pkg, weddingDate, copyTo, answers: answered.length }));
      return json(200, { success: true, dev: true });
    }
    console.error('RESEND_API_KEY is not set in the environment.');
    return json(500, { error: 'Email service is not configured.' });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const ownerRows = [['', `Wedding: ${pkg || '?'}, ${weddingDate}`]];
    let section = '';
    for (const q of answered) {
      if (q.section !== section) { section = q.section; ownerRows.push(['', ''], [section, '']); }
      ownerRows.push([q.label, A[q.key]]);
    }

    await resend.emails.send({
      from: FROM,
      to: OWNER_EMAIL,
      replyTo: A.email,
      subject: `[S&G] Wedding questionnaire: ${A.name}${A.partnerName ? ` & ${A.partnerName}` : ''}`,
      text: toText(ownerRows),
      html: toHtml(ownerRows),
    });

    const clientMail = brandedEmail({
      eyebrow: 'Got it',
      heading: `Thanks, ${first(A.name)}.`,
      paragraphs: ["That's everything I need for now. Here's what you sent me, so you've got a copy:"],
      details: answered.map((q) => [q.label, A[q.key]]),
      after: ['If anything changes before the day (times, places, people), just reply to this email and let me know.'],
    });
    await resend.emails.send({
      from: FROM,
      to: copyTo,
      replyTo: OWNER_EMAIL,
      subject: 'Your wedding questionnaire answers',
      text: clientMail.text,
      html: clientMail.html,
    });

    // Studio's Bookings screen. Never throws.
    const answers = { form: 'wedding', weddingDate, package: pkg };
    for (const q of answered) answers[q.key] = A[q.key];
    await postBookingEvent({ type: 'questionnaire', appointmentId: (link && link.a) || undefined, email: A.email,
      sessionDate: weddingDate, address: A.ceremonyLocation || null, answers });

    return json(200, { success: true });
  } catch (err) {
    console.error('submit-wedding-questionnaire error:', err);
    return json(500, { error: 'Failed to process submission' });
  }
};

exports._test = { QUESTIONS };
