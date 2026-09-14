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

module.exports = {
  balancePlan,
  BALANCE_AFTER_DAYS,
  MIN_DAYS_BEFORE_SESSION,
  MIN_NOTICE_DAYS,
};
