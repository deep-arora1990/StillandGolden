// POST /.netlify/functions/closed-dates
//   header x-ingest-secret: <BOOKING_INGEST_SECRET>
//   body: { ranges: [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }, …] }  (inclusive)
//
// Studio's Time off list (12 Oct 2026). Studio sends the WHOLE list on every
// change, so this replaces what is saved rather than merging — deleting a
// break in Studio reopens it here. Server-to-server only, with the same shared
// secret as booking-link-send; no browser ever calls it.
//
// Every cached month is cleared as well: closed days are filtered as each
// month is served, but a day that has just REOPENED was never probed, so
// cached months wouldn't show it until they expired.

const crypto = require('crypto');
const { connectStore } = require('./lib/shared-store');
const { clearAll } = require('./lib/availability-cache');
const { validRanges, saveClosedDates } = require('./lib/closed-dates');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function secretMatches(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!secretMatches(headers['x-ingest-secret'], process.env.BOOKING_INGEST_SECRET)) return json(401, { ok: false, error: 'Unauthorized' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }
  const ranges = validRanges(body.ranges);
  if (!ranges) return json(400, { ok: false, error: 'ranges must be a list of { from, to } dates (YYYY-MM-DD, from on or before to)' });

  connectStore(event);
  try {
    await saveClosedDates(ranges);
  } catch (err) {
    console.error('closed-dates: save failed:', err.message);
    return json(502, { ok: false, error: 'Could not save the list' });
  }
  const cleared = await clearAll().catch((err) => {
    console.warn('closed-dates: saved, but clearing cached availability failed:', err.message);
    return null;
  });
  console.log(`closed-dates: saved ${ranges.length} range(s); cleared ${cleared ?? 'no'} cached month(s)`);
  return json(200, { ok: true, ranges: ranges.length });
};
