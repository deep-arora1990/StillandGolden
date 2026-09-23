// GET /.netlify/functions/booking-availability?service_key=...&year=...&month=...
// → { availableDates: ["2026-08-14", ...] }
//
// Setmore has no "available dates in a month" endpoint, so this fans out one
// slots call per remaining day of the month (parallel batches of 5 to stay
// rate-limit friendly).
//
// The result is cached in the SHARED store (Netlify Blobs), so a month is
// checked once for every visitor and every running copy of this function,
// rather than once per container as it used to be. How long a month stays
// fresh depends on how far out it is — see lib/availability-ttl.js. Before
// 24 Sep 2026 the cache was per-container and 30 minutes flat, so calls grew
// with visitors instead of with time.

const { TIERS, TIMEZONE, getSlots } = require('./lib/setmore');
const { connectStore } = require('./lib/shared-store');
const { readMonth, writeMonth } = require('./lib/availability-cache');
const { ttlForMonth, isFresh } = require('./lib/availability-ttl');

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
  connectStore(event);

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

  const today = melbourneToday();
  const cached = await readMonth(serviceKey, year, month);
  if (isFresh(cached, ttlForMonth(year, month, today))) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ availableDates: cached.availableDates, cached: true }),
    };
  }

  // Days to probe: from today (Melbourne) through the end of the requested
  // month. A month fully in the past returns empty without any API calls.
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
    // Setmore refused, but we hold an earlier good answer for this month: serve
    // it. Somewhat out of date beats "try again", and nothing can be booked off
    // it unchecked — the time-slot step asks Setmore live. This is what keeps a
    // throttle like 24 Sep's from being visible to visitors at all.
    if (cached && Array.isArray(cached.availableDates)) {
      console.warn(`booking-availability: ${year}-${pad(month)} serving stale copy (${systemic.message})`);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availableDates: cached.availableDates, cached: true, stale: true }),
      };
    }
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

  await writeMonth(serviceKey, year, month, availableDates);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ availableDates }),
  };
};
