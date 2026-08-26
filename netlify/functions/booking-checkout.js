// POST /.netlify/functions/booking-checkout
// Body: { service_key, date: 'YYYY-MM-DD', time: 'HH:MM', firstName, lastName,
//         email, phone?, notes? }
// → { url } — a Stripe Checkout URL the browser redirects to. Payment first;
// the Setmore appointment is only created by stripe-webhook.js after
// checkout.session.completed.
//
// Mock mode (SETMORE_MOCK=1): no Stripe call — creates the mock appointment
// via the lib directly and returns a local success URL, so the whole UI flow
// is exercisable without Stripe keys.

const {
  TIERS,
  MOCK,
  getStaffKey,
  findCustomer,
  createCustomer,
  createAppointment,
} = require('./lib/setmore');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const error = (statusCode, code, message) => json(statusCode, { error: { code, message } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function requestOrigin(event) {
  const h = event.headers || {};
  if (h.origin) return h.origin;
  const proto = h['x-forwarded-proto'] || 'https';
  return `${proto}://${h.host}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return error(400, 'INVALID_DETAILS', 'Invalid request');
  }

  const { service_key: serviceKey, date, time, firstName, lastName, email, phone, notes } = data || {};

  const tierEntry = Object.entries(TIERS).find(([, t]) => t.serviceKey === serviceKey);
  if (
    !tierEntry ||
    !DATE_RE.test(date || '') ||
    !TIME_RE.test(time || '') ||
    !firstName ||
    !lastName ||
    !EMAIL_RE.test(email || '')
  ) {
    return error(400, 'INVALID_DETAILS', 'Please check the booking details and try again');
  }
  const [tierName, tier] = tierEntry;

  if (Number.isNaN(new Date(`${date}T${time}:00`).getTime())) {
    return error(400, 'INVALID_DETAILS', 'Please check the booking details and try again');
  }

  // Fixed-date offers (allowedDates in the tier config) only take their
  // advertised date.
  if (tier.allowedDates && !tier.allowedDates.includes(date)) {
    return error(400, 'INVALID_DETAILS', 'This offer is only available on the advertised date');
  }

  // Tiers with a fixed slot list only take their canonical start times.
  if (tier.slotTimes && !tier.slotTimes.includes(time)) {
    return error(400, 'INVALID_DETAILS', 'Please pick one of the listed session times');
  }

  // Campaign pages get their own success/cancel URLs; anything not on the
  // allowlist falls back to the main booking page.
  const returnTo = ['/book.html', '/fathers-day.html', '/christmas-minis.html', '/test-booking.html'].includes(data.returnTo)
    ? data.returnTo
    : '/book.html';

  const origin = requestOrigin(event);

  // --- mock mode: book straight through the lib, skip Stripe -------------
  if (MOCK) {
    try {
      const staffKey = await getStaffKey();
      let customer = await findCustomer(firstName, email);
      if (!customer) {
        customer = await createCustomer({ firstName, lastName, email, phone });
      }
      const [hh, mm] = time.split(':').map(Number);
      const end = new Date(new Date(`${date}T${time}:00`).getTime() + tier.durationMinutes * 60 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      await createAppointment({
        staffKey,
        serviceKey,
        customerKey: customer.key,
        startTime: `${date}T${pad(hh)}:${pad(mm)}`,
        endTime: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`,
        comment: notes || '',
      });
      return json(200, { url: `${origin}${returnTo}?booked=1&mock=1` });
    } catch (err) {
      console.error('booking-checkout mock booking error:', err);
      return error(502, 'SETMORE_DOWN', 'Booking is unavailable right now — please try again shortly');
    }
  }

  // Live key takes precedence; STRIPE_TEST_KEY is the fallback for test mode.
  const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_KEY;
  if (!stripeKey) {
    console.error('STRIPE_SECRET_KEY / STRIPE_TEST_KEY is not set in the environment.');
    return error(500, 'PAYMENT_UNAVAILABLE', 'Online payment is not configured — please enquire instead');
  }

  const Stripe = require('stripe');
  const stripe = new Stripe(stripeKey);

  const cancelParams = new URLSearchParams({ service: tierName, date, time, cancelled: '1' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'aud',
            unit_amount: tier.priceCents,
            product_data: {
              name: `${tier.name} — photography session`,
              // sessionMinutes where a tier distinguishes it: durationMinutes is
              // the calendar block, which for the minis includes changeover
              // time the customer isn't buying. Telling someone paying for a
              // 15-minute session that it's 25 would be plainly wrong.
              description: `${date} at ${time} · ${tier.sessionMinutes || tier.durationMinutes} minutes`,
            },
          },
        },
      ],
      customer_email: email,
      client_reference_id: `${tierName}:${date}:${time}`,
      metadata: {
        service_key: serviceKey,
        date,
        time,
        firstName,
        lastName,
        email,
        phone: (phone || '').slice(0, 100),
        notes: (notes || '').slice(0, 500),
      },
      success_url: `${origin}${returnTo}?booked=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${returnTo}?${cancelParams.toString()}`,
    });

    return json(200, { url: session.url });
  } catch (err) {
    console.error('booking-checkout Stripe error:', err);
    return error(502, 'PAYMENT_UNAVAILABLE', 'Could not start the payment — please try again shortly');
  }
};
