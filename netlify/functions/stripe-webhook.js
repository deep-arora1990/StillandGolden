// POST /.netlify/functions/stripe-webhook
// Stripe → here on checkout.session.completed. The customer has PAID at this
// point; this function creates the Setmore appointment. If the booking fails
// (slot taken, Setmore down), the payment is HELD — nothing is refunded — and
// Deep is emailed everything he needs to rebook by hand, while the customer gets
// an honest note that their time will be confirmed personally. No silent
// failures with money involved, and no automatic refunds either (Deep's call,
// 25 Sep 2026: a failed booking is usually a Setmore glitch he can rebook, and
// a refund he didn't choose is harder to undo than one he did).
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
const { connectStore } = require('./lib/shared-store');
const { clearMonth } = require('./lib/availability-cache');

// Split payment (spec 2026-09-14): when the subscription must stop.
const { subscriptionCancelAt } = require('./lib/deposits');
const { upsertResendContact } = require('./lib/resend-contacts');
const { render: renderConfirmation, valuesFromBooking } = require('./lib/booking-confirmation');

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

  const appointment = await createAppointment({
    staffKey,
    serviceKey: meta.service_key,
    customerKey: customer.key,
    startTime: `${meta.date}T${meta.time}`,
    endTime: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`,
    comment: meta.notes || '',
  });

  // That day is now taken, for every package — they share one calendar — so
  // drop the booked month from the shared availability cache. Otherwise a far
  // month could keep showing the day as open for up to 24 hours. Never throws:
  // the booking has succeeded, and a stale cache is only an inconvenience,
  // since the time-slot step re-checks Setmore before anyone can pay.
  const [bookedYear, bookedMonth] = meta.date.split('-').map(Number);
  await clearMonth(bookedYear, bookedMonth);

  return appointment;
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

// The customer's "you're booked in" email. Christmas minis also get the venue
// and the pre-session form; every other tier gets the plain confirmation.
//
// Sent from OWNER_EMAIL, not FROM, so a reply lands in Deep's inbox rather
// than the no-reply notifications address.
async function sendBookingConfirmation(resend, meta) {
  const tier = Object.values(TIERS).find((t) => t.serviceKey === meta.service_key);
  if (!tier) throw new Error(`Unknown service_key for confirmation: ${meta.service_key}`);
  const { subject, html, text } = renderConfirmation(valuesFromBooking(meta, tier));
  const { error } = await resend.emails.send({
    from: `Still & Golden <${OWNER_EMAIL}>`,
    to: meta.email,
    subject,
    html,
    text,
  });
  // The SDK reports API errors in the response rather than throwing, so an
  // unchecked send fails silently. Raised here so the caller logs it — the
  // caller swallows it, which is what keeps the booking safe.
  if (error) throw new Error(`Resend rejected the confirmation: ${error.message || JSON.stringify(error)}`);
}

// Split payments are a subscription, and nothing stops a subscription except
// cancel_at. Applied on BOTH paths — a successful booking and a held one —
// because a held booking that is later rebooked by hand should still stop after
// its second payment, and one that isn't can be cancelled by hand. Before
// 25 Sep 2026 this ran only after a successful booking, so a failed one left
// the customer's subscription billing weekly with nothing to stop it.
async function capSplitSubscription(stripe, resend, session, meta) {
  if (!(stripe && meta.pay_mode === 'split' && session.subscription)) return;
  const subId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription.id;
  try {
    // Retrieved rather than assumed: the cancellation has to sit exactly on a
    // billing-period boundary, and only Stripe knows where that falls.
    const sub = await stripe.subscriptions.retrieve(subId);
    const cancelAt = subscriptionCancelAt(sub);
    await stripe.subscriptions.update(subId, { cancel_at: cancelAt });
    console.log(`stripe-webhook: ${subId} will cancel at ${new Date(cancelAt * 1000).toISOString()} (end of 2nd period)`);
  } catch (capErr) {
    // Recoverable, and there is time: the second charge is 7 days out and a
    // third would be 14, so this can be capped by hand well before anyone is
    // overcharged. Shout about it anyway.
    console.error('stripe-webhook: FAILED to cap split subscription:', capErr);
    if (!resend) return;
    try {
      await resend.emails.send({
        from: FROM,
        to: OWNER_EMAIL,
        subject: `ACTION NEEDED — uncapped subscription ${subId}`,
        text: [
          `The split-payment subscription for ${meta.firstName} ${meta.lastName} could not be capped.`,
          '',
          `It will keep billing weekly until someone stops it.`,
          '',
          `Fix: Stripe dashboard → Subscriptions → ${subId}. AFTER the second payment has gone through, choose Cancel subscription → "End of current period".`,
          `Don't cancel before the second payment (the balance would never be taken), and don't pick a custom date (it prorates).`,
          '',
          `Session: ${meta.date} at ${meta.time} (service_key ${meta.service_key})`,
          `Customer: ${meta.email}`,
          `Error: ${capErr.message}`,
        ].join('\n'),
      });
    } catch (mailErr) {
      console.error('stripe-webhook: cap-failure alert could not be sent:', mailErr);
    }
  }
}

// A booking that could not be written to Setmore after the customer paid.
// Nothing is refunded (see the header): the payment is held and Deep rebooks by
// hand. The split cap is still applied, so a held split booking can't bill
// weekly forever.
//
// The customer email promises only what is true. The version before 25 Sep
// 2026 said "I've issued a full refund" whether or not a refund had worked —
// and for split payments it never could, since it tried to refund
// session.payment_intent, which is empty in subscription mode. A client was told
// she had been refunded when she hadn't, and that her booking had failed when
// Deep had already rebooked her.
async function holdFailedBooking(stripe, resend, session, meta, err) {
  console.error('stripe-webhook: Setmore booking failed after payment — payment HELD, no refund:', err);

  await capSplitSubscription(stripe, resend, session, meta);

  const split = meta.pay_mode === 'split';
  const detail = [
    `Customer: ${meta.firstName} ${meta.lastName} <${meta.email}>`,
    meta.phone ? `Phone: ${meta.phone}` : null,
    `Session: service_key ${meta.service_key} on ${meta.date} at ${meta.time}`,
    `Payment: ${split ? 'split — first half taken, second half due in 7 days (subscription capped after it)' : 'paid in full'}`,
    meta.notes ? `Notes: ${meta.notes}` : null,
    `Stripe session: ${session.id}`,
    split && session.subscription ? `Subscription: ${typeof session.subscription === 'string' ? session.subscription : session.subscription.id}` : null,
    `Error: ${err.message}`,
  ].filter(Boolean).join('\n');

  const nextSteps = [
    'Nothing has been refunded. The payment is held until you decide.',
    '',
    'To keep the booking: add the appointment in Setmore by hand, then let the customer know it is confirmed. They were told you would be in touch personally.',
    '',
    split
      ? "To cancel instead: Stripe → Payments → refund the first payment, then Subscriptions → this subscription → Cancel subscription → Immediately, so the second half is never taken."
      : 'To cancel instead: Stripe → Payments → this payment → Refund.',
  ].join('\n');

  if (!resend) return;
  try {
    await resend.emails.send({
      from: FROM,
      to: OWNER_EMAIL,
      subject: `ACTION NEEDED — paid booking not in the calendar (${meta.firstName} ${meta.lastName}, ${meta.date} ${meta.time})`,
      text: `A customer paid but the Setmore appointment could not be created.\n\n${detail}\n\n${nextSteps}`,
    });
    await resend.emails.send({
      from: FROM,
      to: meta.email,
      subject: 'About your Still & Golden booking',
      text: [
        `Hi ${meta.firstName},`,
        '',
        `Thank you — your payment has come through. I wasn't able to lock your time (${meta.date} at ${meta.time}) into my calendar automatically, so I'll confirm it with you personally, usually within 24 hours.`,
        '',
        `There's nothing you need to do in the meantime. If you have any questions, just reply to this email.`,
        '',
        'Deep',
        'Still & Golden Photography',
      ].join('\n'),
    });
  } catch (emailErr) {
    console.error('stripe-webhook: held-booking emails failed:', emailErr);
  }
}

// Where the subscription id lives on an Invoice depends on the API version the
// account is pinned to. Recent versions moved it from `invoice.subscription`
// to `invoice.parent.subscription_details.subscription`; the old field is kept
// on older ones. Checking both means this keeps working across a version bump
// instead of going quiet — and going quiet is the failure mode that matters
// here, because no email is indistinguishable from nothing having happened.
function subscriptionIdFromInvoice(invoice) {
  const candidates = [
    invoice.subscription,
    invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription,
    invoice.subscription_details && invoice.subscription_details.subscription,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
    if (c && typeof c === 'object' && c.id) return c.id;
  }
  return null;
}

// Reads the split-payment metadata off the subscription behind an invoice,
// or null if this invoice is nothing to do with us. Shared by the reminder and
// the failure alert so both are narrow in exactly the same way: only
// subscriptions this site created carry pay_mode, and anything else is left
// alone rather than guessed at.
async function splitMetaForInvoice(stripe, invoice) {
  if (!stripe || !invoice) return null;
  const subId = subscriptionIdFromInvoice(invoice);
  if (!subId) {
    console.log('stripe-webhook: invoice carries no subscription id — ignoring');
    return null;
  }
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    const meta = sub.metadata || {};
    if (meta.pay_mode !== 'split') {
      console.log(`stripe-webhook: ignoring ${invoice.id || 'upcoming invoice'} for ${subId} — not one of ours`);
      return null;
    }
    return { subId, meta };
  } catch (err) {
    console.error('stripe-webhook: could not read subscription for invoice:', err);
    return null;
  }
}

// "Monday 21 September", in Melbourne. The customer is being told when money
// leaves their account, so it has to be their date, not UTC's.
function melbourneLongDate(unixSeconds) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(unixSeconds * 1000));
}

// Three days before the balance is taken. Goes to the customer, from Deep.
async function sendBalanceReminder(stripe, invoice) {
  const found = await splitMetaForInvoice(stripe, invoice);
  if (!found) return;
  const { meta } = found;

  const to = meta.email || invoice.customer_email;
  if (!to) {
    console.error('stripe-webhook: upcoming balance has no address to remind');
    return;
  }

  const amount = `$${((invoice.amount_due || 0) / 100).toFixed(2)}`;
  const whenTs = invoice.next_payment_attempt || invoice.period_end || invoice.created;
  const when = whenTs ? melbourneLongDate(whenTs) : 'shortly';

  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  if (!resend) {
    console.error(`stripe-webhook: WOULD have reminded ${to} of ${amount} on ${when}, but RESEND_API_KEY is not set`);
    return;
  }
  try {
    const { error } = await resend.emails.send({
      from: `Still & Golden <${OWNER_EMAIL}>`,
      to,
      subject: `Your session balance — ${amount} on ${when.split(' ')[0]}`,
      text: [
        `Hi ${meta.firstName || 'there'},`,
        '',
        `Just a heads-up: the remaining ${amount} for your session on ${meta.date}${meta.time ? ` at ${meta.time}` : ''} comes off the same card on ${when}.`,
        '',
        `Nothing for you to do — it happens automatically, and that is the final payment.`,
        '',
        `If you would rather use a different card, or anything has changed, just reply to this email and I will sort it out.`,
        '',
        'Deep',
        'Still & Golden Photography',
      ].join('\n'),
    });
    if (error) console.error('stripe-webhook: balance reminder rejected:', error);
    else console.log(`stripe-webhook: balance reminder sent to ${to} for ${when}`);
  } catch (mailErr) {
    console.error('stripe-webhook: balance reminder could not be sent:', mailErr);
  }
}

// The second half of a split payment failed to collect.
//
// Deliberately narrow: only subscriptions this site created carry pay_mode in
// their metadata, so anything else — a manual subscription, another product,
// an invoice unrelated to a booking — is ignored rather than guessed at. Same
// reasoning as the service_key guard on checkout sessions, which exists
// because a payment link once fell into the refund path.
async function alertBalanceFailed(stripe, invoice) {
  const found = await splitMetaForInvoice(stripe, invoice);
  if (!found) return;
  const { subId, meta } = found;

  const amount = typeof invoice.amount_due === 'number' ? `$${(invoice.amount_due / 100).toFixed(2)}` : 'the balance';
  console.error(`stripe-webhook: BALANCE FAILED for ${subId} (${meta.date} ${meta.time})`);

  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  if (!resend) return;
  try {
    const { error } = await resend.emails.send({
      // From Deep's own address, not the notifications sender: this one ends in
      // him asking someone for money, so replies should reach him.
      from: `Still & Golden <${OWNER_EMAIL}>`,
      to: OWNER_EMAIL,
      subject: `Balance payment failed — ${meta.date || 'session'} ${meta.time || ''}`.trim(),
      text: [
        `The second payment on a split booking did not go through.`,
        '',
        `Amount: ${amount}`,
        `Session: ${meta.date || '?'} at ${meta.time || '?'} (service_key ${meta.service_key || '?'})`,
        `Customer: ${invoice.customer_email || '(see Stripe)'}`,
        `Subscription: ${subId}`,
        '',
        `They have been emailed a link to pay with another card, and Stripe will`,
        `retry on its own for the next couple of days.`,
        '',
        `The session IS still booked — the deposit was paid and the appointment exists.`,
        `Nothing has been refunded and nothing needs undoing.`,
        '',
        `If it has not cleared by the time the subscription ends, chase it directly.`,
      ].join('\n'),
    });
    // Resend reports API errors in the response rather than throwing.
    if (error) console.error('stripe-webhook: balance-failure alert rejected:', error);
  } catch (mailErr) {
    console.error('stripe-webhook: balance-failure alert could not be sent:', mailErr);
  }

  // And tell the customer, ourselves.
  //
  // Stripe can send its own dunning mail, but it is a Billing setting and it is
  // suppressed in test mode — so it could not be verified before going live,
  // and a silent one would leave a customer with a failed payment and no idea.
  // Sending our own makes it certain, puts it in Deep's voice beside the
  // reminder they already had, and carries Stripe's hosted invoice page so they
  // can pay with another card in one click.
  const payUrl = invoice.hosted_invoice_url;
  const to = meta.email || invoice.customer_email;
  if (!to) {
    console.error('stripe-webhook: failed balance has no customer address to write to');
    return;
  }
  try {
    const { error } = await resend.emails.send({
      from: `Still & Golden <${OWNER_EMAIL}>`,
      to,
      subject: 'That last payment did not go through',
      text: [
        `Hi ${meta.firstName || 'there'},`,
        '',
        `The remaining ${amount} for your session did not go through — usually just an expired card, or a bank being cautious about an automatic payment.`,
        '',
        payUrl ? `You can pay it here with any card: ${payUrl}` : `If you reply to this email I will send you a payment link.`,
        '',
        `Your session is still booked and nothing has been cancelled — this is only the balance.`,
        '',
        `If it is easier to sort another way, or something has changed, just reply and I will work around it.`,
        '',
        'Deep',
        'Still & Golden Photography',
      ].join('\n'),
    });
    if (error) console.error('stripe-webhook: customer balance-failure email rejected:', error);
    else console.log(`stripe-webhook: balance-failure email sent to ${to}`);
  } catch (mailErr) {
    console.error('stripe-webhook: customer balance-failure email could not be sent:', mailErr);
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
  // Share one Setmore token with every other running copy (lib/shared-store.js).
  connectStore(event);
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

  // A split payment's SECOND charge failing. Stripe has already emailed the
  // customer and given them a hosted page to pay on; this is only so Deep
  // knows to follow up, because the appointment is booked and the balance is
  // not in.
  //
  // Nothing in this branch may call holdFailedBooking. That tells the customer
  // their time couldn't be booked — untrue here, where the appointment exists
  // and only the balance is missing.
  // Stripe fires this 3 days before it creates the next invoice (Billing
  // setting, confirmed in test mode 14 Sep). A heads-up before money leaves
  // someone's account costs nothing and saves both failed payments — a dying
  // card can be replaced in time — and "what is this charge?" emails.
  if (stripeEvent.type === 'invoice.upcoming') {
    await sendBalanceReminder(stripe, stripeEvent.data.object);
    return json(200, { received: true, handled: 'invoice.upcoming' });
  }

  if (stripeEvent.type === 'invoice.payment_failed') {
    await alertBalanceFailed(stripe, stripeEvent.data.object);
    return json(200, { received: true, handled: 'invoice.payment_failed' });
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
    // Everything past this point is a side effect of an ALREADY SUCCESSFUL,
    // already-paid booking. It must never reach the outer catch — that path
    // refunds the customer. A Resend outage is not a reason to undo a booking.

    // Stop a split subscription after its second payment. Checkout rejects
    // cancel_at when the session is created (probed 14 Sep 2026), so the cap
    // can only be applied here, once the subscription exists. Without it the
    // customer is billed weekly forever.
    //
    // In its own try/catch like everything else in this block: an unguarded
    // throw here would refund a booking that has just succeeded, which is a
    // far worse outcome than a subscription that needs capping by hand.
    await capSplitSubscription(stripe, resend, session, meta);

    if (resend) {
      try {
        await sendBookingConfirmation(resend, meta);
        console.log(`stripe-webhook: confirmation emailed to ${meta.email}`);
      } catch (mailErr) {
        console.error('stripe-webhook: confirmation email failed (booking stands):', mailErr);
      }
      try {
        await addToAudience(meta);
      } catch (audErr) {
        console.error('stripe-webhook: audience add failed (booking stands):', audErr);
      }
    }
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
    await holdFailedBooking(stripe, resend, session, meta, err);
    return json(200, { received: true, booked: false, held: true });
  }

  return json(200, { received: true, booked: true });
};

// Exposed for tests only — the held-booking path handles real money and is
// otherwise reachable only through a signed Stripe event.
exports._test = { holdFailedBooking, capSplitSubscription };
