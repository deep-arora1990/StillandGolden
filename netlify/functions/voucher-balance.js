// POST /.netlify/functions/voucher-balance
// Body: { code, service_key }
// → { code, usedCents, payCents, leftoverCents } for that session, so the
// booking page can say "Your voucher covers $395, nothing left to pay" before
// sending anyone to Stripe. booking-checkout checks again; this is only the
// preview.

const { TIERS } = require('./lib/setmore');
const { findVoucher, problemWith, plan } = require('./lib/vouchers');
const { todayInMelbourne } = require('./lib/deposits');
const { stripeClient } = require('./lib/stripe-client');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const error = (statusCode, code, message) => json(statusCode, { error: { code, message } });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let body;
  try { body = JSON.parse(event.body); } catch { return error(400, 'INVALID_DETAILS', 'Invalid request'); }

  const tier = Object.values(TIERS).find((t) => t.serviceKey === (body && body.service_key));
  if (!tier || !tier.priceCents) return error(400, 'INVALID_DETAILS', 'Please choose a session first.');

  const stripe = stripeClient();
  if (!stripe) return error(500, 'VOUCHERS_UNAVAILABLE', "Vouchers can't be checked right now. Please try again shortly.");

  try {
    const v = await findVoucher(stripe, body.code);
    const problem = problemWith(v, todayInMelbourne());
    if (problem) return error(400, 'VOUCHER', problem);
    return json(200, { code: v.code, ...plan(v, tier.priceCents, TIERS) });
  } catch (err) {
    console.error('voucher-balance error:', err);
    return error(502, 'VOUCHERS_UNAVAILABLE', "Vouchers can't be checked right now. Please try again shortly.");
  }
};
