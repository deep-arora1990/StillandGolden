// GET /.netlify/functions/booking-slots?service_key=...&date=YYYY-MM-DD
// → { slots: ["09:00", "09:30", ...] }  (Australia/Melbourne local times)

const { TIERS, getSlots, getFixedScheduleSlots } = require('./lib/setmore');

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
    // Tiers whose schedule we set ourselves can't be filtered against
    // /bookingapi/slots: it derives start times from the service duration, so
    // it never offers a cadence that differs from it. Availability comes from
    // the calendar instead — see getFixedScheduleSlots.
    if (tier.fixedSchedule) {
      const slots = await getFixedScheduleSlots(tier, date);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots }),
      };
    }

    let slots = await getSlots(serviceKey, date);
    // Tiers with a fixed slot list (e.g. Father's Day minis) only ever offer
    // their canonical start times; booked ones drop out via Setmore.
    if (tier.slotTimes) slots = slots.filter((s) => tier.slotTimes.includes(s));
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
