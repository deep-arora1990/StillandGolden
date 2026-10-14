// Promo codes (14 Oct 2026, beach minis model call): Stripe Checkout takes a
// code on "Pay in full", and every message after the booking states what was
// actually paid. The session shapes below are copied from two real test-mode
// checkouts (100% and 50% off) on Deep's account — this account's API version
// keeps the coupon under discount.source and returns the code only when
// discounts.promotion_code is expanded.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

async function fresh(mod) {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test'
  delete process.env.SETMORE_MOCK
  return await import(mod)
}

const session = (paid, code) => ({
  id: 'cs_test_1',
  amount_subtotal: 29500,
  amount_total: paid,
  payment_status: 'paid',
  total_details: { amount_discount: 29500 - paid },
  discounts: paid === 29500 ? [] : [{ coupon: null, promotion_code: code ? { id: 'promo_1', code } : 'promo_1' }],
})
const FREE = session(0, 'SUNSETMINIFREE2026-1')
const HALF = session(14750, 'SUNSETMINIHALFPRICE-1')
const meta = { firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', phone: '0400', date: '2026-10-21', time: '18:30', notes: 'Location: Carrum\n' }

describe('reading the discount off the session', () => {
  it('nothing for a full-price booking', async () => {
    const { pricingFrom } = await fresh('../discounts.js')
    expect(pricingFrom(session(29500))).toBeNull()
    expect(pricingFrom({ amount_total: 47500 })).toBeNull()
  })

  it('price, amount paid, percentage and code', async () => {
    const { pricingFrom } = await fresh('../discounts.js')
    expect(pricingFrom(FREE)).toEqual({ listCents: 29500, paidCents: 0, discountCents: 29500, percentOff: 100, code: 'SUNSETMINIFREE2026-1' })
    expect(pricingFrom(HALF)).toMatchObject({ paidCents: 14750, percentOff: 50, code: 'SUNSETMINIHALFPRICE-1' })
  })

  it('still knows the amounts when the code could not be looked up', async () => {
    const { pricingFrom } = await fresh('../discounts.js')
    expect(pricingFrom(session(14750, null))).toMatchObject({ paidCents: 14750, percentOff: 50, code: null })
  })
})

describe('the client confirmation', () => {
  it('a free session says no charge, and never "payment came through"', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { render, valuesFromBooking } = await fresh('../booking-confirmation.js')
    const { pricingFrom } = await fresh('../discounts.js')
    const out = render(valuesFromBooking(meta, TIERS['sunset-beach-minis'], { termsUrl: 'x', pricing: pricingFrom(FREE) }))
    expect(out.text).toMatch(/No charge · \$295 less 100% off \(code SUNSETMINIFREE2026-1\)/)
    expect(out.text).not.toMatch(/Payment came through/)
    expect(out.html).not.toMatch(/Payment came through/)
    expect(out.text).toMatch(/Your session is locked into my calendar/)
  })

  it('a half-price session says what was paid and why', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { render, valuesFromBooking } = await fresh('../booking-confirmation.js')
    const { pricingFrom } = await fresh('../discounts.js')
    const out = render(valuesFromBooking(meta, TIERS['sunset-beach-minis'], { termsUrl: 'x', pricing: pricingFrom(HALF) }))
    expect(out.text).toMatch(/Paid \$147\.50 · \$295 less 50% off \(code SUNSETMINIHALFPRICE-1\)/)
    expect(out.text).toMatch(/Payment came through/)
    expect(out.text).not.toMatch(/Paid \$295/)
  })
})

describe("Deep's side", () => {
  beforeEach(() => installFreshBlobs())
  afterEach(() => { removeBlobs(); vi.unstubAllGlobals() })
  const resend = () => { const sent = []; return { sent, emails: { send: async (m) => { sent.push(m); return { id: 'e' } } } } }

  it('the booking notice shows the amount paid and the code', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../stripe-webhook.js')
    const { pricingFrom } = await fresh('../discounts.js')
    const m = { ...meta, service_key: TIERS['sunset-beach-minis'].serviceKey }
    const r1 = resend(); await _test.notifyOwnerOfBooking(r1, m, { key: 'a1' }, pricingFrom(HALF))
    expect(r1.sent[0].text).toMatch(/Paid in full: \$147\.50 \(code SUNSETMINIHALFPRICE-1, 50% off \$295\.00\)/)
    const r2 = resend(); await _test.notifyOwnerOfBooking(r2, m, { key: 'a1' }, pricingFrom(FREE))
    expect(r2.sent[0].text).toMatch(/No charge \(code SUNSETMINIFREE2026-1, 100% off \$295\.00\)/)
  })

  it('Studio records what was actually paid', async () => {
    process.env.STUDIO_BOOKING_INGEST_URL = 'https://studio.example/ingest'
    process.env.BOOKING_INGEST_SECRET = 's'
    const posted = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => { posted.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }) }))
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../stripe-webhook.js')
    const { pricingFrom } = await fresh('../discounts.js')
    await _test.reportBookingToStudio(FREE, { ...meta, service_key: TIERS['sunset-beach-minis'].serviceKey }, { key: 'a1' }, pricingFrom(FREE))
    expect(posted[0].amountCents).toBe(0)
    delete process.env.STUDIO_BOOKING_INGEST_URL; delete process.env.BOOKING_INGEST_SECRET
  })

  it('a held free booking never tells the client their payment came through', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../stripe-webhook.js')
    const { pricingFrom } = await fresh('../discounts.js')
    const r = resend()
    await _test.holdFailedBooking(null, r, FREE, { ...meta, service_key: TIERS['sunset-beach-minis'].serviceKey }, new Error('x'), pricingFrom(FREE))
    const toClient = r.sent.find((m) => m.to === meta.email)
    expect(toClient.text).not.toMatch(/payment/i)
    expect(r.sent.find((m) => m.to !== meta.email).text).toMatch(/Payment: no charge \(code SUNSETMINIFREE2026-1, 100% off\)/)
  })
})

describe('checkout', () => {
  it('"Pay in full" offers the promo code box; the split never does', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../booking-checkout.js')
    const { splitCheckoutParams } = await fresh('../deposits.js')
    expect(_test.fullPaymentParams(TIERS['sunset-beach-minis'], { date: '2026-10-21', time: '18:30', location: 'Carrum' }).allow_promotion_codes).toBe(true)
    const tier = TIERS['sunset-beach-minis']
    const split = splitCheckoutParams(tier, { eligible: true, depositCents: 14750, balanceCents: 14750, chargeOn: '2026-10-14' }, { date: '2026-10-21', time: '18:30', firstName: 'M', lastName: 'J', email: 'm@example.com' })
    expect(split.allow_promotion_codes).toBeUndefined()
  })
})
