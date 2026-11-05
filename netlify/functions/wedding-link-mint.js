// Mints a private wedding link for Studio's "Send wedding booking link".
// Sends nothing: Studio does the emailing. Same auth as booking-link-send.js.
const crypto = require('crypto');
const { mintWeddingLink } = require('./lib/weddings');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function secretMatches(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!secretMatches(headers['x-ingest-secret'], process.env.BOOKING_INGEST_SECRET)) return { statusCode: 401, body: 'Unauthorized' };

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const firstName = String(data.firstName || '').trim();
  const lastName = String(data.lastName || '').trim();
  const email = String(data.email || '').trim();
  if (!firstName) return json(400, { error: 'firstName is required' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'A valid email is required' });

  const link = mintWeddingLink({ firstName, lastName, email });
  if (!link) return json(500, { error: 'BOOKING_LINK_SECRET is not configured' });
  return json(200, { url: link.url, expiresAt: link.expiresAt });
};
