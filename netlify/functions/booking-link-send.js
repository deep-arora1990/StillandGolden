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
const { tokenForBooking, linkFor } = require('./lib/booking-links');
const { formatDate, formatTime } = require('./lib/booking-confirmation');

const FROM = 'Still & Golden <hello@stillandgolden.com.au>';
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function secretMatches(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function emailHtml({ firstName, intro, button, url, after }) {
  return `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1A1714;">
  <p style="font-size:1.1rem;margin-bottom:8px;">Hi ${esc(firstName) || 'there'},</p>
  <p>${intro}</p>
  <p style="margin:28px 0;"><a href="${esc(url)}" style="display:inline-block;padding:14px 32px;background:#1A1714;color:#F8F5F1;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-decoration:none;text-transform:uppercase;">${button}</a></p>
  <p>${after}</p>
  <p style="margin-top:32px;">Deep<br><span style="color:#A8845A;font-style:italic;">Still &amp; Golden Photography</span></p>
</div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!secretMatches(headers['x-ingest-secret'], process.env.BOOKING_INGEST_SECRET)) return { statusCode: 401, body: 'Unauthorized' };

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const kind = data.kind === 'terms' || data.kind === 'questionnaire' ? data.kind : null;
  const tier = TIERS[data.tierKey];
  const email = String(data.email || '').trim();
  if (!kind) return json(400, { error: 'kind must be terms or questionnaire' });
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
        html: emailHtml({
          firstName: meta.firstName,
          intro: `Before your ${esc(tier.name)} session on ${esc(when)}, here are your session terms. It takes a minute &mdash; your details are already filled in, so just check them and sign.`,
          button: 'Review &amp; sign your session terms',
          url: linkFor('/contract', token),
          after: "Once that's done I'll send a short questionnaire so I can plan your session around your family. Any questions, just reply to this email.",
        }),
      }
    : {
        subject: 'One quick questionnaire before your session',
        html: emailHtml({
          firstName: meta.firstName,
          intro: `Ahead of your ${esc(tier.name)} session on ${esc(when)}: a short questionnaire about your family, your place and anything you&rsquo;d love (or would rather avoid) in your photos. It helps me turn up already knowing what matters.`,
          button: 'Fill in your session questionnaire',
          url: linkFor('/questionnaire', token),
          after: 'Any questions, just reply to this email.',
        }),
      };

  if (!process.env.RESEND_API_KEY) return json(500, { error: 'RESEND_API_KEY is not configured' });
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: FROM, to: email, ...mail });
  if (error) return json(502, { error: `Email not sent: ${error.message || JSON.stringify(error)}` });
  console.log(`booking-link-send: ${kind} emailed to ${email} (appointment ${data.appointmentId || '?'})`);
  return json(200, { ok: true });
};
