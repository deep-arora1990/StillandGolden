// GET /.netlify/functions/booking-availability?service_key=...&year=...&month=...
// → { availableDates: ["2026-08-14", ...] }
//
// Setmore has no "available dates in a month" endpoint, so this fans out one
// slots call per remaining day of the month (parallel batches of 5 to stay
// rate-limit friendly) and caches the result in memory for 30 minutes.

const { TIERS, TIMEZONE, getSlots, SetmoreError } = require('./lib/setmore');

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

  const availableDates = [];
  try {
    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      const batch = dates.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (date) => {
          try {
            const slots = await getSlots(serviceKey, date);
            return slots.length ? date : null;
          } catch (err) {
            // A single day's failure shouldn't blank the whole calendar —
            // treat it as unavailable unless everything fails (caught below).
            console.warn(`slots probe failed for ${date}:`, err.message);
            return null;
          }
        })
      );
      for (const r of results) if (r) availableDates.push(r);
    }
  } catch (err) {
    console.error('booking-availability error:', err);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { code: 'SETMORE_DOWN', message: 'Availability is unavailable right now' } }),
    };
  }

  // If every single probe errored we likely have an auth/outage problem, not
  // a genuinely empty calendar — surface that instead of a silent empty month.
  if (dates.length && !availableDates.length) {
    const staffProbe = await getSlots(serviceKey, dates[dates.length - 1]).catch((e) => e);
    if (staffProbe instanceof SetmoreError) {
      console.error('booking-availability: all probes failed:', staffProbe.message);
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { code: 'SETMORE_DOWN', message: 'Availability is unavailable right now' } }),
      };
    }
  }

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, availableDates });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ availableDates }),
  };
};
