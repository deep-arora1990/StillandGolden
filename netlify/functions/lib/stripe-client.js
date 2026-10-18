// The Stripe client for the active mode: the live key when it's set, the test
// key otherwise (the same rule booking-checkout and stripe-webhook follow).
// → null when neither is set.
//
// Tests put a fake on globalThis.__sgStripe, the same way shared-store takes
// its fake: under vitest a CJS require and an ESM import load separate copies
// of a module, so a setter on one would never reach the other.
function stripeClient() {
  if (globalThis.__sgStripe) return globalThis.__sgStripe;
  const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_KEY;
  if (!key) return null;
  const Stripe = require('stripe');
  return new Stripe(key);
}

module.exports = { stripeClient };
