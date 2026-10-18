// Gift vouchers (Deep, 18 Oct 2026): a named session or a dollar amount from
// $100. A session voucher always covers that session at the day's price;
// leftover value stays on the code for another session or the full gallery.
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { fakeStripe } from './helpers/fake-stripe.js'
const require = createRequire(import.meta.url)

process.env.SETMORE_API_KEY = process.env.SETMORE_API_KEY || 'test'
const V = require('../vouchers.js')
const { TIERS } = require('../setmore.js')

const purchase = (over = {}) => ({ kind: 'package', tier: 'golden', buyerName: 'Amanda N', buyerEmail: 'amanda@example.com', recipientName: 'Rand', message: 'Congratulations!', ...over })

describe('codes', () => {
  it('are SG-XXXX-XXXX, the same for the same purchase, and avoid look-alike characters', () => {
    const a = V.voucherCode('cs_test_123')
    expect(a).toMatch(/^SG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(V.voucherCode('cs_test_123')).toBe(a)
    expect(V.voucherCode('cs_test_124')).not.toBe(a)
  })

  it('are read forgivingly: lower case, spaces, no dashes', () => {
    expect(V.normaliseCode('sg abcd efgh')).toBe('SG-ABCD-EFGH')
    expect(V.normaliseCode('ABCDEFGH')).toBe('SG-ABCD-EFGH')
    expect(V.normaliseCode('SG-ABC')).toBeNull()
  })
})

describe('buying one', () => {
  it('a session voucher costs the session price from prices.json', () => {
    const r = V.validatePurchase(purchase(), TIERS)
    expect(r.ok).toBe(true)
    expect(r.purchase.cents).toBe(TIERS.golden.priceCents)
  })

  it('only the four sessions can be gifted, not the minis or offers', () => {
    expect(V.validatePurchase(purchase({ tier: 'christmas-minis' }), TIERS).ok).toBe(false)
    for (const t of ['glimpse', 'golden', 'gathered', 'bloom']) expect(V.validatePurchase(purchase({ tier: t }), TIERS).ok).toBe(true)
  })

  it('a dollar voucher starts at $100, in whole dollars', () => {
    expect(V.validatePurchase(purchase({ kind: 'amount', amount: 99 }), TIERS).message).toMatch(/start at \$100/)
    expect(V.validatePurchase(purchase({ kind: 'amount', amount: 150.5 }), TIERS).ok).toBe(false)
    const r = V.validatePurchase(purchase({ kind: 'amount', amount: 100 }), TIERS)
    expect(r.ok).toBe(true)
    expect(r.purchase.cents).toBe(10000)
  })

  it('needs a buyer email and a recipient name', () => {
    expect(V.validatePurchase(purchase({ buyerEmail: 'nope' }), TIERS).ok).toBe(false)
    expect(V.validatePurchase(purchase({ recipientName: ' ' }), TIERS).ok).toBe(false)
  })

  it('checkout charges the voucher price and marks the session as a voucher, not a booking', () => {
    const { purchase: p } = V.validatePurchase(purchase(), TIERS)
    const params = V.purchaseCheckoutParams(p, TIERS, { successUrl: 's', cancelUrl: 'c' })
    expect(params.line_items[0].price_data.unit_amount).toBe(TIERS.golden.priceCents)
    expect(params.metadata.kind).toBe('voucher')
    expect(params.metadata.service_key).toBeUndefined()
    expect(params.allow_promotion_codes).toBeUndefined()
  })
})

describe('issuing', () => {
  it('records a switched-off promotion code valid for three years, once per purchase', async () => {
    const stripe = fakeStripe()
    const session = { id: 'cs_test_buy1', amount_total: TIERS.golden.priceCents, metadata: { kind: 'voucher', voucher_kind: 'package', tier: 'golden', cents: String(TIERS.golden.priceCents), buyerName: 'Amanda', buyerEmail: 'a@example.com', recipientName: 'Rand' } }
    const v = await V.issueVoucher(stripe, session, '2026-10-18')
    expect(v.code).toBe(V.voucherCode('cs_test_buy1'))
    expect(v.expires).toBe('2029-10-18')
    const promo = [...stripe._promos.values()][0]
    expect(promo.active).toBe(false)
    expect(promo.promotion).toEqual({ type: 'coupon', coupon: V.REGISTRY_COUPON })
    await V.issueVoucher(stripe, session, '2026-10-18')
    expect(stripe._promos.size).toBe(1)
  })
})

describe('using one', () => {
  const golden = { kind: 'package', tier: 'golden', status: 'active', expires: '2029-10-18', history: '' }

  it('a session voucher covers that session at today\'s price, even after a price rise', () => {
    const risen = { ...TIERS, golden: { ...TIERS.golden, priceCents: TIERS.golden.priceCents + 5000 } }
    expect(V.plan(golden, risen.golden.priceCents, risen)).toMatchObject({ payCents: 0, leftoverCents: 0 })
  })

  it('on a cheaper session, the difference stays on the code as dollars', () => {
    const p = V.plan(golden, TIERS.glimpse.priceCents, TIERS)
    expect(p.payCents).toBe(0)
    expect(p.leftoverCents).toBe(TIERS.golden.priceCents - TIERS.glimpse.priceCents)
    const after = V.afterUse(golden, p.usedCents, TIERS, 'note')
    expect(after).toMatchObject({ kind: 'amount', status: 'active', balance_cents: String(p.leftoverCents) })
  })

  it('on a dearer session, it pays its part and the client pays the rest', () => {
    const p = V.plan({ kind: 'package', tier: 'glimpse' }, TIERS.golden.priceCents, TIERS)
    expect(p.payCents).toBe(TIERS.golden.priceCents - TIERS.glimpse.priceCents)
    expect(V.afterUse({ kind: 'package', tier: 'glimpse' }, p.usedCents, TIERS).status).toBe('used')
  })

  it('a dollar voucher keeps what a booking did not use', () => {
    const v = { kind: 'amount', balanceCents: 50000, status: 'active' }
    const p = V.plan(v, TIERS.glimpse.priceCents, TIERS)
    expect(p.leftoverCents).toBe(50000 - TIERS.glimpse.priceCents)
    expect(V.afterUse(v, p.usedCents, TIERS).balance_cents).toBe(String(50000 - TIERS.glimpse.priceCents))
  })

  it('refuses used, expired and unknown vouchers with a plain message', () => {
    expect(V.problemWith(null, '2026-10-18')).toMatch(/wasn't recognised/)
    expect(V.problemWith({ status: 'used' }, '2026-10-18')).toMatch(/already been used/)
    expect(V.problemWith({ status: 'active', expires: '2026-10-17' }, '2026-10-18')).toMatch(/expired/)
    expect(V.problemWith({ status: 'active', expires: '2029-10-18' }, '2026-10-18')).toBeNull()
  })

  it('redeeming updates the record in Stripe', async () => {
    const stripe = fakeStripe()
    const session = { id: 'cs_test_buy2', amount_total: 50000, metadata: { kind: 'voucher', voucher_kind: 'amount', cents: '50000', buyerName: 'A', buyerEmail: 'a@example.com', recipientName: 'R' } }
    const v = await V.issueVoucher(stripe, session, '2026-10-18')
    const r = await V.redeemVoucher(stripe, v.code.toLowerCase(), TIERS.glimpse.priceCents, TIERS, '2026-11-02 Glimpse')
    expect(r.leftCents).toBe(50000 - TIERS.glimpse.priceCents)
    const again = await V.findVoucher(stripe, v.code)
    expect(again.balanceCents).toBe(50000 - TIERS.glimpse.priceCents)
    expect(again.history).toMatch(/Glimpse/)
  })
})

describe('the printable voucher', () => {
  it('keeps accents the PDF can print, folds the rest, and drops emoji instead of failing', () => {
    const { pdfSafe } = require('../voucher-delivery.js')
    expect(pdfSafe('Zoë & Chloé')).toBe('Zoë & Chloé')
    expect(pdfSafe('Łucja')).toBe('Lucja')
    expect(pdfSafe('Congrats! 🍼')).toBe('Congrats!')
  })
})
