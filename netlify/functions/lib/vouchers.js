// Gift vouchers (Deep, 18 Oct 2026; coach's audit p92–93, p110).
//
// Two kinds, bought on /gift-vouchers:
//   package  a named session (Glimpse, Golden, Gathered, Bloom). It always
//            covers that session, at whatever the session costs on the day it
//            is booked — so a price rise never leaves the recipient short.
//   amount   a dollar amount, $100 or more.
// Both last three years (the Australian minimum for gift cards since 2019).
//
// Where they live: in Deep's Stripe account, one switched-off promotion code
// per voucher, its state in the code's metadata. Switched off so typing it in
// Stripe's own promo box does nothing — the booking page sends it to
// booking-checkout, which works out the credit here and gives that checkout a
// one-off coupon for exactly that amount. Stripe is durable and Deep can see
// every voucher and its balance in the dashboard; nothing depends on a store
// that could be emptied.
//
// Leftover value stays on the code. A Golden voucher used on a Glimpse keeps
// the difference (at the day's prices) as a dollar balance, and a dollar
// voucher keeps whatever a booking didn't use — for another session with the
// same code, or for Deep to take off a full gallery by hand.

const crypto = require('crypto');

const PACKAGE_TIERS = ['glimpse', 'golden', 'gathered', 'bloom'];
const MIN_AMOUNT_CENTS = 10000;
const MAX_AMOUNT_CENTS = 200000;
const VALID_YEARS = 3;
const REGISTRY_COUPON = 'sg-gift-voucher-registry';

// No I, O, 0 or 1: a code is read off paper and typed by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// The same purchase always gets the same code, so a webhook delivered twice
// can't issue two vouchers for one payment.
function voucherCode(purchaseSessionId) {
  const bytes = crypto.createHash('sha256').update(String(purchaseSessionId)).digest();
  let bits = 0n;
  for (let i = 0; i < 5; i += 1) bits = (bits << 8n) | BigInt(bytes[i]);
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return `SG-${out.slice(0, 4)}-${out.slice(4)}`;
}

// What people type: lower case, spaces, missing dashes, an O for a 0.
function normaliseCode(input) {
  const raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^SG/, '');
  if (raw.length !== 8) return null;
  return `SG-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

const money = (cents) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

function addYears(isoDate, years) {
  const [y, m, d] = isoDate.split('-').map(Number);
  // 29 Feb rolls to 1 Mar rather than to a date that doesn't exist.
  const dt = new Date(Date.UTC(y + years, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

// The purchase form, checked here rather than trusted from the page.
// → { ok: true, purchase } | { ok: false, message }
function validatePurchase(body, TIERS) {
  const b = body || {};
  const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const buyerName = clean(b.buyerName, 80);
  const buyerEmail = clean(b.buyerEmail, 120);
  const recipientName = clean(b.recipientName, 60);
  const message = String(b.message || '').replace(/\r/g, '').trim().slice(0, 240);
  if (!buyerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    return { ok: false, message: 'Please add your name and email so I can send you the voucher.' };
  }
  if (!recipientName) return { ok: false, message: 'Who is the voucher for? Add their name.' };

  if (b.kind === 'package') {
    if (!PACKAGE_TIERS.includes(b.tier) || !TIERS[b.tier]) return { ok: false, message: 'Please choose a session.' };
    return { ok: true, purchase: { kind: 'package', tier: b.tier, cents: TIERS[b.tier].priceCents, buyerName, buyerEmail, recipientName, message } };
  }
  if (b.kind === 'amount') {
    const dollars = Number(b.amount);
    if (!Number.isInteger(dollars)) return { ok: false, message: 'Please enter a whole-dollar amount.' };
    const cents = dollars * 100;
    if (cents < MIN_AMOUNT_CENTS) return { ok: false, message: `Vouchers start at ${money(MIN_AMOUNT_CENTS)}.` };
    if (cents > MAX_AMOUNT_CENTS) return { ok: false, message: `For more than ${money(MAX_AMOUNT_CENTS)}, get in touch and I'll set it up.` };
    return { ok: true, purchase: { kind: 'amount', cents, buyerName, buyerEmail, recipientName, message } };
  }
  return { ok: false, message: 'Please choose a session or an amount.' };
}

function describe(v, TIERS) {
  return v.kind === 'package' ? `${TIERS[v.tier].name} session` : `${money(v.cents)} gift voucher`;
}

// Stripe Checkout for buying one. Metadata carries everything the webhook
// needs to issue it; `kind: 'voucher'` is what tells the webhook it isn't a
// booking.
function purchaseCheckoutParams(p, TIERS, { successUrl, cancelUrl }) {
  const label = p.kind === 'package' ? `Gift voucher — ${TIERS[p.tier].name} session` : `Gift voucher — ${money(p.cents)}`;
  return {
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'aud',
        unit_amount: p.cents,
        product_data: { name: label, description: `For ${p.recipientName} · valid for ${VALID_YEARS} years` },
      },
    }],
    customer_email: p.buyerEmail,
    metadata: {
      kind: 'voucher',
      voucher_kind: p.kind,
      tier: p.kind === 'package' ? p.tier : '',
      cents: String(p.cents),
      buyerName: p.buyerName,
      buyerEmail: p.buyerEmail,
      recipientName: p.recipientName,
      message: p.message,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  };
}

// --- the record in Stripe --------------------------------------------------

function fromPromotionCode(pc) {
  const m = (pc && pc.metadata) || {};
  if (m.sg_voucher !== '1') return null;
  return {
    id: pc.id,
    code: pc.code,
    kind: m.kind,
    tier: m.tier || null,
    balanceCents: m.balance_cents ? Number(m.balance_cents) : null,
    paidCents: Number(m.paid_cents) || 0,
    status: m.status || 'active',
    recipientName: m.recipient || '',
    buyerName: m.from || '',
    buyerEmail: m.buyer_email || '',
    purchased: m.purchased || '',
    expires: m.expires || '',
    history: m.history || '',
  };
}

async function ensureRegistryCoupon(stripe) {
  try {
    return await stripe.coupons.retrieve(REGISTRY_COUPON);
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'resource_missing')) {
      return stripe.coupons.create({
        id: REGISTRY_COUPON,
        percent_off: 1,
        duration: 'once',
        name: 'Gift voucher register (not a discount)',
        metadata: { note: 'Holds the switched-off promotion codes that record gift vouchers. Never switch one on.' },
      });
    }
    throw err;
  }
}

async function findVoucher(stripe, code) {
  const normal = normaliseCode(code);
  if (!normal) return null;
  const list = await stripe.promotionCodes.list({ code: normal, limit: 1 });
  const pc = list && list.data && list.data[0];
  return pc ? fromPromotionCode(pc) : null;
}

// Issue the voucher for a completed purchase. Safe to call twice for the
// same session: the code is derived from it, and an existing one is returned.
async function issueVoucher(stripe, session, today) {
  const meta = session.metadata || {};
  const code = voucherCode(session.id);
  const existing = await findVoucher(stripe, code);
  if (existing) return existing;
  await ensureRegistryCoupon(stripe);
  const pc = await stripe.promotionCodes.create({
    promotion: { type: 'coupon', coupon: REGISTRY_COUPON },
    code,
    active: false,
    metadata: {
      sg_voucher: '1',
      kind: meta.voucher_kind,
      tier: meta.voucher_kind === 'package' ? meta.tier : '',
      balance_cents: meta.voucher_kind === 'amount' ? String(meta.cents) : '',
      paid_cents: String(session.amount_total != null ? session.amount_total : meta.cents),
      status: 'active',
      recipient: (meta.recipientName || '').slice(0, 60),
      from: (meta.buyerName || '').slice(0, 80),
      buyer_email: (meta.buyerEmail || '').slice(0, 120),
      purchased: today,
      expires: addYears(today, VALID_YEARS),
      purchase_session: session.id,
      history: '',
    },
  });
  return fromPromotionCode(pc);
}

// --- using one --------------------------------------------------------------

// What the voucher is worth today. A package voucher is worth its session's
// current price until it's used.
function creditCents(v, TIERS) {
  if (v.kind === 'package') return TIERS[v.tier] ? TIERS[v.tier].priceCents : 0;
  return Math.max(0, v.balanceCents || 0);
}

// Can it be used at all? → null when fine, else the message for the page.
function problemWith(v, today) {
  if (!v) return "That voucher code wasn't recognised. Check it and try again, or get in touch.";
  if (v.status === 'used') return 'That voucher has already been used in full.';
  if (v.expires && today > v.expires) return `That voucher expired on ${v.expires}. Get in touch and I'll sort it out.`;
  return null;
}

// What a booking at `priceCents` takes off the voucher, and what's left.
function plan(v, priceCents, TIERS) {
  const credit = creditCents(v, TIERS);
  const usedCents = Math.min(credit, priceCents);
  return { creditCents: credit, usedCents, payCents: priceCents - usedCents, leftoverCents: credit - usedCents };
}

// The record after a booking used it. A package voucher with value left
// becomes a dollar voucher for the rest, at the day's prices.
function afterUse(v, usedCents, TIERS, note) {
  const credit = creditCents(v, TIERS);
  const left = Math.max(0, credit - usedCents);
  const history = [v.history, note].filter(Boolean).join(' | ').slice(-480);
  return {
    kind: left > 0 ? 'amount' : v.kind,
    tier: left > 0 ? '' : v.tier || '',
    balance_cents: String(left),
    status: left > 0 ? 'active' : 'used',
    history,
  };
}

async function redeemVoucher(stripe, code, usedCents, TIERS, note) {
  const v = await findVoucher(stripe, code);
  if (!v) throw new Error(`voucher ${code} not found at redemption`);
  const credit = creditCents(v, TIERS);
  const metadata = afterUse(v, usedCents, TIERS, note);
  await stripe.promotionCodes.update(v.id, { metadata });
  return { before: v, shortCents: Math.max(0, usedCents - credit), leftCents: Number(metadata.balance_cents), metadata };
}

module.exports = {
  PACKAGE_TIERS,
  MIN_AMOUNT_CENTS,
  MAX_AMOUNT_CENTS,
  VALID_YEARS,
  REGISTRY_COUPON,
  voucherCode,
  normaliseCode,
  addYears,
  validatePurchase,
  describe,
  purchaseCheckoutParams,
  fromPromotionCode,
  ensureRegistryCoupon,
  findVoucher,
  issueVoucher,
  creditCents,
  problemWith,
  plan,
  afterUse,
  redeemVoucher,
  money,
};
