// GET /.netlify/functions/booking-availability?service_key=...&year=...&month=...
// → { availableDates: ["2026-08-14", ...] }
//
// Setmore has no "available dates in a month" endpoint, so this fans out one
// slots call per remaining day of the month (parallel batches of 5 to stay
// rate-limit friendly) and caches the result in memory for 30 minutes.

const { TIERS, TIMEZONE, getSlots } = require('./lib/setmore');

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map(); // key: `${serviceKey}:${year}:${month}` → { expiresAt, availableDates }

const BATCH_SIZE = 5;

function melbourneToday() {
  // 'en-CA' gives YYYY-MM-DD parts
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) };
}

const pad = (n) => String(n).padStart(2, '0');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { service_key: serviceKey, year: yearRaw, month: monthRaw } = event.queryStringParameters || {};
  const year = Number(yearRaw);
  const month = Number(monthRaw);

  const tier = Object.values(TIERS).find((t) => t.serviceKey === serviceKey);
  if (!tier || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { code: 'INVALID_DETAILS', message: 'Unknown service or bad month' } }),
    };
  }

  const cacheKey = `${serviceKey}:${year}:${pad(month)}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ availableDates: hit.availableDates, cached: true }),
    };
  }

  // Days to probe: from today (Melbourne) through the end of the requested
  // month. A month fully in the past returns empty without any API calls.
  const today = melbourneToday();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isCurrentMonth = today.year === year && today.month === month;
  const firstDay = isCurrentMonth ? today.day : 1;
  const dates = [];
  if (year > today.year || (year === today.year && month >= today.month)) {
    for (let d = firstDay; d <= daysInMonth; d++) {
      dates.push(`${year}-${pad(month)}-${pad(d)}`);
    }
  }

  // A probe that fails is NOT the same as a day with no slots, and treating it
  // as one was a real bug: under Setmore rate limiting some probes failed, the
  // month was returned with those days missing, and the gap was cached for 30
  // minutes — so a bookable weekend showed as fully booked to every visitor.
  // Seen on 24 Sep 2026 (3–4 Oct dropped). Wrong availability loses a booking
  // silently; an honest "try again" does not.
  //
  // So: a systemic failure (rate limit, auth) stops the month straight away —
  // every further probe would fail the same way and only deepen the throttle.
  // An isolated failure gets one quiet retry. Nothing incomplete is cached.
  const isSystemic = (err) =>
    err && (err.code === 'RATE_LIMITED' || err.code === 'too_many_requests' || err.status === 429 || err.status === 401);

  const availableDates = [];
  const isolatedFailures = [];
  let systemic = null;
  try {
    for (let i = 0; i < dates.length && !systemic; i += BATCH_SIZE) {
      const batch = dates.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (date) => {
          try {
            const slots = await getSlots(serviceKey, date);
            return slots.length ? date : null;
          } catch (err) {
            console.warn(`slots probe failed for ${date}:`, err.message);
            if (isSystemic(err)) systemic = systemic || err;
            else isolatedFailures.push(date);
            return null;
          }
        })
      );
      for (const r of results) if (r) availableDates.push(r);
    }

    // One sequential retry per isolated failure. If it still fails, the month
    // is reported as unavailable rather than shown with a hole in it.
    for (const date of isolatedFailures) {
      if (systemic) break;
      try {
        const slots = await getSlots(serviceKey, date);
        if (slots.length) availableDates.push(date);
      } catch (err) {
        console.warn(`slots retry failed for ${date}:`, err.message);
        systemic = err;
      }
    }
  } catch (err) {
    console.error('booking-availability error:', err);
    systemic = err;
  }

  if (systemic) {
    console.error(`booking-availability: ${year}-${pad(month)} not served:`, systemic.message);
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '20' },
      body: JSON.stringify({
        error: { code: 'SETMORE_BUSY', message: 'Availability is busy right now — please try again in a moment.' },
      }),
    };
  }

  // Retries append out of order; ISO dates sort correctly as strings.
  availableDates.sort();

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, availableDates });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ availableDates }),
  };
};
