// GET /.netlify/functions/booking-slots?service_key=...&date=YYYY-MM-DD
// → { slots: ["09:00", "09:30", ...], split }  (Australia/Melbourne local times)
//
// `split` tells the page whether to offer part payment for THIS date, and with
// what amounts — so the 9-day cutoff is never restated in page JavaScript where
// it could drift from the server's copy. Same inputs as the slot lookup, so it
// rides along rather than needing a call of its own. booking-checkout re-checks
// it regardless: this decides what is shown, not what is allowed.

const { TIERS, getSlots, getFixedScheduleSlots } = require('./lib/setmore');
const { balancePlan, todayInMelbourne } = require('./lib/deposits');

// Only what the buttons need to render. `reason` is deliberately not sent —
// the page has nothing useful to do with it and it only describes our rules.
function splitOffer(tier, date) {
  const plan = balancePlan(tier, date, todayInMelbourne());
  if (!plan.eligible) return { available: false };
  return {
    available: true,
    depositCents: plan.depositCents,
    balanceCents: plan.balanceCents,
    chargeOn: plan.chargeOn,
  };
}

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
        body: JSON.stringify({ slots, split: splitOffer(tier, date) }),
      };
    }

    let slots = await getSlots(serviceKey, date);
    // Tiers with a fixed slot list (e.g. Father's Day minis) only ever offer
    // their canonical start times; booked ones drop out via Setmore.
    if (tier.slotTimes) slots = slots.filter((s) => tier.slotTimes.includes(s));
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots, split: splitOffer(tier, date) }),
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
