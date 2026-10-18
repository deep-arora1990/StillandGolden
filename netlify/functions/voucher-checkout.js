// POST /.netlify/functions/voucher-checkout
// Body: { kind: 'package', tier } | { kind: 'amount', amount }, plus
//       buyerName, buyerEmail, recipientName, message?
// → { url } — Stripe Checkout. The voucher itself is issued by stripe-webhook
// once the payment completes (lib/vouchers.js has the rules).

const { TIERS } = require('./lib/setmore');
const { validatePurchase, purchaseCheckoutParams } = require('./lib/vouchers');
const { stripeClient } = require('./lib/stripe-client');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const error = (statusCode, code, message) => json(statusCode, { error: { code, message } });

function requestOrigin(event) {
  const h = event.headers || {};
  if (h.origin) return h.origin;
  return `${h['x-forwarded-proto'] || 'https'}://${h.host}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let body;
  try { body = JSON.parse(event.body); } catch { return error(400, 'INVALID_DETAILS', 'Invalid request'); }

  const checked = validatePurchase(body, TIERS);
  if (!checked.ok) return error(400, 'INVALID_DETAILS', checked.message);

  const stripe = stripeClient();
  if (!stripe) return error(500, 'PAYMENT_UNAVAILABLE', 'Online payment is not set up right now. Please get in touch instead.');

  const origin = requestOrigin(event);
  try {
    const session = await stripe.checkout.sessions.create(purchaseCheckoutParams(checked.purchase, TIERS, {
      successUrl: `${origin}/gift-vouchers?bought=1&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/gift-vouchers?cancelled=1`,
    }));
    return json(200, { url: session.url });
  } catch (err) {
    console.error('voucher-checkout Stripe error:', err);
    return error(502, 'PAYMENT_UNAVAILABLE', 'Could not start the payment. Please try again shortly.');
  }
};
