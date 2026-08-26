// GET /.netlify/functions/booking-slots?service_key=...&date=YYYY-MM-DD
// → { slots: ["09:00", "09:30", ...] }  (Australia/Melbourne local times)

const { TIERS, getSlots } = require('./lib/setmore');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { service_key: serviceKey, date } = event.queryStringParameters || {};

  const tier = Object.values(TIERS).find((t) => t.serviceKey === serviceKey);
  if (!tier || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { code: 'INVALID_DETAILS', message: 'Unknown service or bad date' } }),
    };
  }

  try {
    let slots = await getSlots(serviceKey, date);
    // Tiers with a fixed slot list (e.g. Father's Day minis) only ever offer
    // their canonical start times; booked ones drop out via Setmore.
    if (tier.slotTimes) slots = slots.filter((s) => tier.slotTimes.includes(s));
    // Tiers with a trading window (e.g. Christmas minis) keep whatever cadence
    // Setmore generates and simply trim the ends. This is deliberately not a
    // fixed list: the service's 15-min duration plus its 10-min after-buffer
    // put slots on a 25-minute cadence, so an assumed list of round times
    // would intersect to almost nothing. Both bounds are inclusive — `end` is
    // the last session's start time, not the day's close.
    if (tier.slotWindow) {
      const { start, end } = tier.slotWindow;
      slots = slots.filter((s) => s >= start && s <= end);
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots }),
    };
  } catch (err) {
    console.error('booking-slots error:', err);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { code: 'SETMORE_DOWN', message: 'Could not load times right now' } }),
    };
  }
};
