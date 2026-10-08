// Signed links from a booking to its session terms and questionnaire (8 Oct 2026).
//
// The confirmation email's "Review & sign your session terms" button, and the
// questionnaire button in the terms-signed email, carry a token: the booking's
// details plus an HMAC-SHA256 signature. The pages read it to prefill, so the
// client only checks and signs; submit-contract VERIFIES it before trusting the
// package and date, so nobody can edit a link into a different booking.
//
// Not a secret-holder: the payload is readable by anyone with the link (it is
// their own booking). The signature only proves the details came from us.
//
// Format: base64url(JSON payload) + '.' + base64url(signature). Payload keys
// are short because the whole thing rides in a URL:
//   a   Setmore appointment key        f / l / e   first name / last name / email
//   s   tier key (e.g. 'golden')        d           session date 'YYYY-MM-DD'
//   h   start time 'HH:MM' ('' when the time is to be confirmed)
//   loc beach, for offers with a location      x   expiry, ms since epoch

const crypto = require('crypto');

const SITE = 'https://stillandgolden.com.au';
const MAX_AGE_DAYS = 120;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function secret() {
  return process.env.BOOKING_LINK_SECRET || null;
}

function signature(data, key) {
  return b64url(crypto.createHmac('sha256', key).update(data).digest());
}

// Returns null when no secret is configured — callers then fall back to the
// plain, unprefilled page rather than sending a link that can't be verified.
function sign(payload, now = Date.now()) {
  const key = secret();
  if (!key) return null;
  const data = b64url(JSON.stringify({ ...payload, x: now + MAX_AGE_DAYS * 86400000 }));
  return `${data}.${signature(data, key)}`;
}

// The payload, or null for anything tampered with, expired, malformed or
// unverifiable. Constant-time comparison of the signature.
function verify(token, now = Date.now()) {
  const key = secret();
  if (!key || typeof token !== 'string' || token.length > 2000) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = Buffer.from(signature(data, key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64url(data).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.x !== 'number' || payload.x < now) return null;
  return payload;
}

function linkFor(path, token) {
  return token ? `${SITE}${path}?t=${encodeURIComponent(token)}` : `${SITE}${path}`;
}

// The booking's token, from the webhook's session metadata and the appointment
// Setmore just created. The time is left out for timeTbc offers: the placeholder
// must never be shown to the client as if it were agreed.
function tokenForBooking(meta, tierKey, tier, appointmentKey) {
  const loc = tier.locations && ((meta.notes || '').match(/^Location: (.+)$/m) || [])[1];
  return sign({
    a: appointmentKey || '',
    f: meta.firstName || '',
    l: meta.lastName || '',
    e: meta.email || '',
    s: tierKey || '',
    d: meta.date || '',
    h: tier.timeTbc ? '' : meta.time || '',
    ...(loc ? { loc } : {}),
  });
}

module.exports = { sign, verify, linkFor, tokenForBooking, MAX_AGE_DAYS };
