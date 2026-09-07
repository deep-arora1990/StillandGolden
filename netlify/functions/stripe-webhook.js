// POST /.netlify/functions/stripe-webhook
// Stripe → here on checkout.session.completed. The customer has PAID at this
// point; this function creates the Setmore appointment. If the booking fails
// (slot taken, Setmore down), the payment is refunded in full and both Deep
// and the customer are emailed — no silent failures with money involved.
//
// Mock mode (SETMORE_MOCK=1): signature verification is skipped and the body
// is treated as the event object directly, for local harness testing.

const { Resend } = require('resend');
const {
  TIERS,
  MOCK,
  getStaffKey,
  findCustomer,
  createCustomer,
  createAppointment,
  getAppointmentsOnDate,
} = require('./lib/setmore');
const { upsertResendContact } = require('./lib/resend-contacts');

const FROM = 'Still & Golden <notifications@stillandgolden.com.au>';
const OWNER_EMAIL = 'hello@stillandgolden.com.au';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function bookAppointment(meta) {
  const tier = Object.values(TIERS).find((t) => t.serviceKey === meta.service_key);
  if (!tier) throw new Error(`Unknown service_key in session metadata: ${meta.service_key}`);

  const pad = (n) => String(n).padStart(2, '0');
  const start = new Date(`${meta.date}T${meta.time}:00`);
  const end = new Date(start.getTime() + tier.durationMinutes * 60 * 1000);

  const staffKey = await getStaffKey();
  let customer = await findCustomer(meta.firstName, meta.email);
  if (!customer) {
    customer = await createCustomer({
      firstName: meta.firstName,
      lastName: meta.lastName,
      email: meta.email,
      phone: meta.phone,
    });
  }

  return createAppointment({
    staffKey,
    serviceKey: meta.service_key,
    customerKey: customer.key,
    startTime: `${meta.date}T${meta.time}`,
    endTime: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`,
    comment: meta.notes || '',
  });
}

async function addToAudience(meta) {
  try {
    // Raw-fetch helper (not the SDK): carries the booking form's phone into
    // the Resend `phone` contact property, which the SDK doesn't type.
    const result = await upsertResendContact({
      email: meta.email,
      firstName: meta.firstName,
      lastName: meta.lastName,
      phone: meta.phone,
      // Bookings made before the consent tick existed carry no value at all;
      // absent is treated as "no", never as consent.
      marketingConsent: meta.marketingConsent === 'yes',
    });
    console.log('Resend contact upsert:', meta.email, result.created ? 'created' : 'updated');
  } catch (err) {
    console.error('stripe-webhook Resend audience error (booking already made):', err);
  }
}

async function handleBookingFailure(stripe, resend, session, meta, err) {
  console.error('stripe-webhook: Setmore booking failed after payment:', err);

  let refundStatus = 'refund failed — MANUAL REFUND REQUIRED';
  try {
    const refund = await stripe.refunds.create({ payment_intent: session.payment_intent });
    refundStatus = `refund issued (${refund.id}, status ${refund.status})`;
  } catch (refundErr) {
    console.error('stripe-webhook: refund failed:', refundErr);
  }

  const detail = [
    `Customer: ${meta.firstName} ${meta.lastName} <${meta.email}>`,
    meta.phone ? `Phone: ${meta.phone}` : null,
    `Session: service_key ${meta.service_key} on ${meta.date} at ${meta.time}`,
    meta.notes ? `Notes: ${meta.notes}` : null,
    `Stripe session: ${session.id}`,
    `Error: ${err.message}`,
    `Refund: ${refundStatus}`,
  ].filter(Boolean).join('\n');

  if (!resend) return;
  try {
    await resend.emails.send({
      from: FROM,
      to: OWNER_EMAIL,
      subject: `ACTION NEEDED — paid booking failed (${meta.firstName} ${meta.lastName}, ${meta.date} ${meta.time})`,
      text: `A customer paid but the Setmore appointment could not be created.\n\n${detail}`,
    });
    await resend.emails.send({
      from: FROM,
      to: meta.email,
      subject: 'About your Still & Golden booking',
      text: [
        `Hi ${meta.firstName},`,
        '',
        `Thank you for your payment — unfortunately the time you chose (${meta.date} at ${meta.time}) couldn't be secured at our end, so I've issued a full refund. It should land back on your card within a few business days.`,
        '',
        `I'm really sorry for the hassle. If you'd still like that session, just reply to this email and I'll sort a time for you personally.`,
        '',
        'Deep',
        'Still & Golden Photography',
      ].join('\n'),
    });
  } catch (emailErr) {
    console.error('stripe-webhook: failure-notification emails failed:', emailErr);
  }
}

// Idempotency guard 2: Stripe redelivers events (at-least-once). If the slot
// is already held by this same customer, the original delivery succeeded and
// this one is a duplicate — never refund in that case.
async function findExistingBooking(meta) {
  try {
    const appts = await getAppointmentsOnDate(meta.date);
    return appts.find((a) =>
      (a.start_time || '').startsWith(`${meta.date}T${meta.time}`) &&
      ((a.customer && a.customer.email_id) || '').toLowerCase() === (meta.email || '').toLowerCase()
    ) || null;
  } catch (err) {
    console.error('stripe-webhook: duplicate-booking check failed (continuing):', err);
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let stripeEvent;
  let stripe = null;

  if (MOCK) {
    try {
      stripeEvent = JSON.parse(event.body);
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }
  } else {
    // Live key takes precedence; STRIPE_TEST_KEY is the fallback for test
    // mode. The webhook secret follows the active key so test/live pairs can
    // never be mixed: STRIPE_SECRET_KEY → STRIPE_LIVE_WEBHOOK_SECRET,
    // STRIPE_TEST_KEY → STRIPE_TEST_WEBHOOK_SECRET.
    const liveMode = Boolean(process.env.STRIPE_SECRET_KEY);
    const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_KEY;
    const webhookSecret = liveMode
      ? process.env.STRIPE_LIVE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
      : process.env.STRIPE_TEST_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeKey || !webhookSecret) {
      console.error('Stripe key / webhook secret not set for the active mode.');
      return json(500, { error: 'Webhook not configured' });
    }
    const Stripe = require('stripe');
    stripe = new Stripe(stripeKey);
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        rawBody,
        event.headers['stripe-signature'] || '',
        webhookSecret
      );
    } catch (err) {
      console.error('stripe-webhook signature verification failed:', err.message);
      return json(400, { error: 'Invalid signature' });
    }
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return json(200, { received: true, ignored: stripeEvent.type });
  }

  const session = stripeEvent.data.object;
  const meta = session.metadata || {};

  // Only sessions created by the booking widget carry our metadata. Any other
  // Checkout payment (e.g. a manual Stripe Payment Link) fires this event too
  // — ignore it; never book or refund a payment we don't recognise.
  if (!meta.service_key) {
    console.log(`stripe-webhook: ignoring ${session.id} — no booking metadata (not a widget checkout)`);
    return json(200, { received: true, ignored: 'no_booking_metadata' });
  }

  // Idempotency guard 1 (live only): a successfully-processed session is
  // flagged in its metadata; a redelivery of the same event exits cleanly
  // instead of double-booking and refunding a legitimate payment.
  if (stripe) {
    try {
      const fresh = await stripe.checkout.sessions.retrieve(session.id);
      if (fresh.metadata && fresh.metadata.booked) {
        console.log(`stripe-webhook: ${session.id} already booked (${fresh.metadata.booked}), ignoring redelivery`);
        return json(200, { received: true, alreadyBooked: true });
      }
    } catch (err) {
      console.error('stripe-webhook: session re-fetch failed (continuing):', err);
    }
  }

  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  if (!resend) console.error('RESEND_API_KEY is not set; audience add and failure emails will be skipped.');

  try {
    const appointment = await bookAppointment(meta);
    console.log(`stripe-webhook: booked ${session.id} → appointment ${appointment.key || '(no key)'}`);
    if (stripe) {
      try {
        await stripe.checkout.sessions.update(session.id, {
          metadata: { ...meta, booked: appointment.key || 'yes' },
        });
      } catch (flagErr) {
        // Non-fatal — the Setmore duplicate-check covers redeliveries too.
        console.error('stripe-webhook: could not flag session as booked:', flagErr);
      }
    }
    if (resend) await addToAudience(meta);
  } catch (err) {
    if (MOCK) {
      // No real payment exists in mock mode — just report it.
      console.error('stripe-webhook mock booking failed:', err);
      return json(200, { received: true, booked: false, error: err.message });
    }
    // Guard 2: the "failure" may be a redelivery where the original delivery
    // already booked this slot for this customer — never refund that.
    const existing = await findExistingBooking(meta);
    if (existing) {
      console.log(`stripe-webhook: slot already held by this customer (${existing.key}); treating as duplicate delivery, no refund`);
      return json(200, { received: true, alreadyBooked: true });
    }
    await handleBookingFailure(stripe, resend, session, meta, err);
    return json(200, { received: true, booked: false, refunded: true });
  }

  return json(200, { received: true, booked: true });
};
