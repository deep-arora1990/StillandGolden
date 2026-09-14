// Split-payment eligibility and dates.
//
// Pure functions, deliberately: no Stripe, no Setmore, no clock of its own.
// `today` is passed in rather than read, so the rules can be tested at any date
// without waiting for one. Everything about when a balance is charged, and
// whether the split may be offered at all, lives here and nowhere else —
// booking-checkout and the booking pages both ask this module rather than
// each keeping their own copy of the arithmetic.
//
// The rule (spec 2026-09-14, § 1–2):
//   • 50% now, 50% seven days later. One rule, every tier.
//   • Offered only when the session is at least 9 days away — seven days to the
//     balance plus two days of margin, so a declined card leaves time to chase.
//
// A tier without `depositCents` never offers the split. That is the feature
// flag: to turn the split on for a tier, give it a deposit; to turn it off,
// take it away.

const BALANCE_AFTER_DAYS = 7;

// Two days of margin between the balance charge and the session. At seven or
// eight days' notice the balance would land the day of, or the day before, the
// session — which is not a deposit so much as an awkward way of paying in full,
// and leaves no room to recover a failed charge.
const MIN_DAYS_BEFORE_SESSION = 2;

const MIN_NOTICE_DAYS = BALANCE_AFTER_DAYS + MIN_DAYS_BEFORE_SESSION; // 9

// When a split subscription should stop.
//
// It MUST land exactly on a billing-period boundary. Stripe bills a shortened
// final period pro rata: a cancel_at inside period 2 makes the 21 Sept invoice
// cover only 21->23 Sept and charge $21.43 instead of $75, so the customer pays
// $96.43 for a $150 session. Observed in test mode 14 Sep 2026 — the first
// version of this used deposit + 9 days, which is mid-period, and the upcoming
// invoice showed the prorated amount.
//
// The boundary we want is the end of the SECOND period: period 2 then bills in
// full and the subscription ends before a third begins. Anchored to Stripe's
// own period, not to our clock, so it cannot drift from the billing cycle by
// the seconds between payment and this call.
//
// Note the period lives on the subscription ITEM in current API versions, with
// the subscription-level field kept as a fallback for older ones.
function subscriptionCancelAt(subscription) {
  const item = subscription && subscription.items && subscription.items.data && subscription.items.data[0];
  const periodEnd = (item && item.current_period_end) || subscription.current_period_end;
  const periodStart = (item && item.current_period_start) || subscription.current_period_start;

  if (!periodEnd || !periodStart || periodEnd <= periodStart) {
    throw new Error('subscriptionCancelAt: subscription has no usable billing period');
  }

  // Exactly one more period after the one now running. Using the measured
  // length rather than a hardcoded week keeps this correct if the interval
  // ever changes.
  return periodEnd + (periodEnd - periodStart);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Calendar-date maths in UTC, never local time. These are dates, not moments:
// Melbourne moves to daylight saving on 4 October 2026, and adding seven days
// to a local-time Date across that boundary lands an hour short, which can roll
// the calendar date backwards. Parsing to UTC midnight sidesteps it entirely.
function toUtcDays(iso) {
  if (!DATE_RE.test(iso)) throw new TypeError(`expected YYYY-MM-DD, got ${JSON.stringify(iso)}`);
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  if (Number.isNaN(ms)) throw new TypeError(`not a real date: ${iso}`);
  return ms / 86400000;
}

function fromUtcDays(days) {
  return new Date(days * 86400000).toISOString().slice(0, 10);
}

/**
 * @param {object} tier    a TIERS entry; `depositCents` opts it into the split
 * @param {string} sessionDate  'YYYY-MM-DD', the date being booked
 * @param {string} today        'YYYY-MM-DD'
 * @returns {{eligible: true, chargeOn: string, depositCents: number, balanceCents: number}
 *          |{eligible: false, reason: 'not-offered'|'too-close'}}
 */
function balancePlan(tier, sessionDate, today) {
  if (!tier || !tier.depositCents) return { eligible: false, reason: 'not-offered' };

  const sessionDay = toUtcDays(sessionDate);
  const todayDay = toUtcDays(today);

  if (sessionDay - todayDay < MIN_NOTICE_DAYS) return { eligible: false, reason: 'too-close' };

  // The balance is whatever is left, rather than a second half computed
  // independently — so the two parts always sum to the price even if a tier
  // ever carries an odd number of cents.
  return {
    eligible: true,
    chargeOn: fromUtcDays(todayDay + BALANCE_AFTER_DAYS),
    depositCents: tier.depositCents,
    balanceCents: tier.priceCents - tier.depositCents,
  };
}

// "Today" as a Melbourne calendar date, not a UTC one. Tier dates, session
// dates and the cutoff are all Melbourne dates; for most of the day UTC is
// already on the previous date there, so using it would let a booking through
// the cutoff a day early. Kept out of balancePlan so that stays pure.
function todayInMelbourne(now = new Date()) {
  // en-CA formats as YYYY-MM-DD, which is the shape the rest of this uses.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * The Stripe Checkout parameters that turn a booking into a two-payment
 * subscription. Returned as a patch for the session the caller is already
 * building, so booking-checkout.js gains a branch rather than a second copy of
 * the checkout logic.
 *
 * A weekly recurring price charges now and again in seven days. It does NOT
 * stop on its own — the subscription is capped in stripe-webhook.js once it
 * exists, because Checkout rejects cancel_at at session-creation time (probed
 * 14 Sep 2026). Until that cap lands the subscription would bill weekly, so
 * the two changes belong in the same release.
 *
 * No `customer_creation` here: subscription mode always creates a customer,
 * and passing it is an error.
 */
function splitCheckoutParams(tier, plan, { date, time, firstName, lastName }) {
  const who = [firstName, lastName].filter(Boolean).join(' ').trim();
  const sessionLabel = `${date} at ${time}`;
  const balance = (plan.balanceCents / 100).toFixed(2);

  return {
    mode: 'subscription',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'aud',
          unit_amount: plan.depositCents,
          recurring: { interval: 'week' },
          product_data: {
            name: `${tier.name} — half now, half in ${BALANCE_AFTER_DAYS} days`,
            // Customer-facing, and load-bearing: Stripe's page says
            // "subscription", and this is the line that stops that alarming
            // anyone. It states the second payment and that nothing follows it.
            description:
              `${sessionLabel} · ${tier.sessionMinutes || tier.durationMinutes} minutes. ` +
              `$${balance} will be charged to the same card on ${plan.chargeOn}. ` +
              'That is the final payment — nothing is charged after it.',
          },
        },
      },
    ],
    subscription_data: {
      // The Stripe dashboard is the admin surface for these: cancelling a
      // charge is cancelling the subscription. It has to be identifiable at a
      // glance, and searchable, or finding the right one means matching on
      // customer email alone.
      description: `${tier.name} — ${sessionLabel}${who ? ` — ${who}` : ''}`,
      metadata: {
        service_key: tier.serviceKey,
        date,
        time,
        pay_mode: 'split',
        balance_cents: String(plan.balanceCents),
        charge_on: plan.chargeOn,
      },
    },
  };
}

module.exports = {
  balancePlan,
  splitCheckoutParams,
  subscriptionCancelAt,
  todayInMelbourne,
  BALANCE_AFTER_DAYS,
  MIN_DAYS_BEFORE_SESSION,
  MIN_NOTICE_DAYS,
};
