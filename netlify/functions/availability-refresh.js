// POST /.netlify/functions/availability-refresh
//   header x-refresh-secret: <AVAILABILITY_REFRESH_SECRET>
//   body (optional): { year, month }  → clear just that month, all packages
//
// Clears the shared availability cache so the booking calendar re-checks
// Setmore on the next visit. Called by Studio's "Refresh availability" button,
// server-to-server — Studio holds the same secret and no browser ever sees it.
//
// Exists for the one change the cache cannot notice on its own: something Deep
// does directly in Setmore, like opening a weekday for a particular client.
// Bookings through the site clear their own month (stripe-webhook), and
// everything else expires on the schedule in lib/availability-ttl.js.
//
// Deletes propagate within about a minute (Blobs' default consistency), so
// "refreshed" means "visible to visitors within a minute".

const crypto = require('crypto');
const { connectStore } = require('./lib/shared-store');
const { clearAll, clearMonth } = require('./lib/availability-cache');

// Constant-time, so response timing can't be used to guess the secret.
function secretMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const expected = process.env.AVAILABILITY_REFRESH_SECRET;
  if (!expected) {
    // Fail closed: an unset variable must never mean "anyone may clear it".
    console.error('availability-refresh: AVAILABILITY_REFRESH_SECRET is not configured');
    return json(500, { ok: false, error: 'Not configured' });
  }
  const headers = event.headers || {};
  if (!secretMatches(headers['x-refresh-secret'], expected)) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  connectStore(event);

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { body = {}; }
  const year = Number(body.year);
  const month = Number(body.month);
  const single = Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12;

  const cleared = single ? await clearMonth(year, month) : await clearAll();
  console.log(`availability-refresh: cleared ${cleared} cached month(s)${single ? ` for ${year}-${month}` : ''}`);
  return json(200, { ok: true, cleared });
};
