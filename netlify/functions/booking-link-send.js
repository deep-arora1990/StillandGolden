// Studio's "Send terms email" / "Send questionnaire" buttons (booking workflow
// stage B, 8 Oct 2026) — for sessions booked by hand in Setmore, or booked
// before the confirmation carried the terms.
//
// Lives on the website, not in Studio, because the website owns the signed
// links (BOOKING_LINK_SECRET never leaves it) and the email designs. Studio
// calls this server-to-server with BOOKING_INGEST_SECRET — the same shared
// secret as booking-intake, one per pair of sites.

const crypto = require('crypto');
const { Resend } = require('resend');
const { TIERS } = require('./lib/setmore');
const { tokenForBooking, linkFor, termsPathFor } = require('./lib/booking-links');
const { formatDate, formatTime } = require('./lib/booking-confirmation');
const { brandedEmail } = require('./lib/email-layout');

const FROM = 'Still & Golden <hello@stillandgolden.com.au>';
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function secretMatches(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}


// "Send model call forms" (15 Oct 2026): a free model call session Deep added
// by hand gets ONE email with both forms. Any service — the forms are generic.
// The links carry plain, editable prefill (name, email, date), not a signed
// token: nothing here is tied to a payment, and both pages accept edits.
const SITE = 'https://stillandgolden.com.au';
async function sendModelCallForms(data, email) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'A valid email is required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || ''))) return json(400, { error: 'date must be YYYY-MM-DD' });
  const firstName = String(data.firstName || '').trim();
  const lastName = String(data.lastName || '').trim();
  const agreementUrl = `${SITE}/model-call-agreement?${new URLSearchParams({ f: firstName, l: lastName, e: email, d: data.date })}`;
  const questionnaireUrl = `${SITE}/model-call-questionnaire?${new URLSearchParams({ name: [firstName, lastName].filter(Boolean).join(' '), email, date: data.date })}`;
  const { html, text } = brandedEmail({
    eyebrow: 'Before your session',
    heading: `Hi ${firstName || 'there'},`,
    paragraphs: [`Two quick things before your session on ${esc(formatDate(data.date))}: the agreement for your model call session, and a short questionnaire about your family. Your details are already filled in, so each one takes a couple of minutes.`],
    buttons: [{ label: '1. Sign the agreement', url: agreementUrl }, { label: '2. Fill in the questionnaire', url: questionnaireUrl }],
    after: ['If anything looks wrong, just reply to this email.'],
  });
  if (!process.env.RESEND_API_KEY) return json(500, { error: 'RESEND_API_KEY is not configured' });
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: FROM, to: email, subject: 'Two quick forms before your session — Still & Golden', html, text,
  });
  if (error) return json(502, { error: `Email not sent: ${error.message || JSON.stringify(error)}` });
  console.log(`booking-link-send: model call forms emailed to ${email} (appointment ${data.appointmentId || '?'})`);
  return json(200, { ok: true });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!secretMatches(headers['x-ingest-secret'], process.env.BOOKING_INGEST_SECRET)) return { statusCode: 401, body: 'Unauthorized' };

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const kind = ['terms', 'questionnaire', 'model-call'].includes(data.kind) ? data.kind : null;
  const tier = TIERS[data.tierKey];
  const email = String(data.email || '').trim();
  if (!kind) return json(400, { error: 'kind must be terms, questionnaire or model-call' });
  if (kind === 'model-call') return sendModelCallForms(data, email);
  // Christmas minis keep their own terms and pre-session form (Deep, 8 Oct).
  if (!tier || tier.hidden || data.tierKey === 'christmas-minis') return json(400, { error: `Not a package these emails cover: ${data.tierKey}` });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'A valid email is required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || ''))) return json(400, { error: 'date must be YYYY-MM-DD' });

  const meta = {
    firstName: data.firstName || '', lastName: data.lastName || '', email,
    date: data.date, time: data.time || '',
    notes: data.location ? `Location: ${data.location}\n` : '',
  };
  const token = tokenForBooking(meta, data.tierKey, tier, data.appointmentId || '');
  if (!token) return json(500, { error: 'BOOKING_LINK_SECRET is not configured' });

  const when = tier.timeTbc || !meta.time ? formatDate(meta.date) : `${formatDate(meta.date)}, ${formatTime(meta.time)}`;
  const mail = kind === 'terms'
    ? {
        subject: 'Your session terms — Still & Golden',
        ...brandedEmail({
          eyebrow: 'Your session terms',
          heading: `Hi ${meta.firstName || 'there'},`,
          paragraphs: [`Before your ${esc(tier.name)} session on ${esc(when)}, here are your session terms. It takes a minute &mdash; your details are already filled in, so just check them and sign.`],
          buttons: [{ label: 'Review & sign your session terms', url: linkFor(termsPathFor(data.tierKey), token) }],
          after: ["Once that's done I'll send a short questionnaire so I can plan your session around your family. Any questions, just reply to this email."],
        }),
      }
    : {
        subject: 'One quick questionnaire before your session',
        ...brandedEmail({
          eyebrow: 'Before your session',
          heading: `Hi ${meta.firstName || 'there'},`,
          paragraphs: [`Ahead of your ${esc(tier.name)} session on ${esc(when)}: a short questionnaire about your family, your place and anything you&rsquo;d love (or would rather avoid) in your photos. It helps me turn up already knowing what matters.`],
          buttons: [{ label: 'Fill in your session questionnaire', url: linkFor('/questionnaire', token) }],
          after: ['Any questions, just reply to this email.'],
        }),
      };

  if (!process.env.RESEND_API_KEY) return json(500, { error: 'RESEND_API_KEY is not configured' });
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: FROM, to: email, ...mail });
  if (error) return json(502, { error: `Email not sent: ${error.message || JSON.stringify(error)}` });
  console.log(`booking-link-send: ${kind} emailed to ${email} (appointment ${data.appointmentId || '?'})`);
  return json(200, { ok: true });
};
