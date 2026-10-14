// Promo codes (14 Oct 2026 — beach minis model call). Checkout takes a code on
// "Pay in full"; this reads what it did, so every message after the booking
// states what was actually paid instead of the package price.
//
// Shapes verified against real test-mode checkouts on Deep's account: amounts
// are on the session itself (amount_subtotal, amount_total,
// total_details.amount_discount); the code is only readable when the session
// is retrieved with expand: ['discounts.promotion_code'] — otherwise
// promotion_code is just an id. The percentage is worked out from the amounts,
// so the coupon (which this API version nests under discount.source) is never
// needed. A free session still has payment_status 'paid', and no
// payment_intent.

const money = (cents) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

// → null when no discount was applied.
function pricingFrom(session) {
  const discountCents = Number(session && session.total_details && session.total_details.amount_discount) || 0;
  if (discountCents <= 0) return null;
  const listCents = Number(session.amount_subtotal);
  const paidCents = Number(session.amount_total);
  const promo = ((session.discounts || []).find((d) => d && d.promotion_code) || {}).promotion_code;
  return {
    listCents,
    paidCents,
    discountCents,
    percentOff: listCents > 0 ? Math.round((discountCents / listCents) * 100) : 0,
    code: promo && typeof promo === 'object' && promo.code ? promo.code : null,
  };
}

const codeNote = (p) => (p.code ? ` (code ${p.code})` : '');

// Client confirmation: "No charge · $295 less 100% off (code …)".
function clientPaymentLine(p) {
  const lead = p.paidCents === 0 ? 'No charge' : `Paid ${money(p.paidCents)}`;
  return `${lead} · ${money(p.listCents)} less ${p.percentOff}% off${codeNote(p)}`;
}

module.exports = { pricingFrom, clientPaymentLine };
