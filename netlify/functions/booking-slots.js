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
    const slots = await getSlots(serviceKey, date);
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
