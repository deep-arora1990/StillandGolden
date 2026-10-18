// Gift vouchers through the site's functions: buying one (voucher-checkout),
// checking one on the booking page (voucher-balance) and paying for a booking
// with one (booking-checkout).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'
import { fakeStripe } from './helpers/fake-stripe.js'

let stripe
async function fresh(mod) {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test'
  delete process.env.SETMORE_MOCK
  return await import(mod)
}
const post = (body) => ({ httpMethod: 'POST', headers: { host: 'stillandgolden.com.au' }, body: JSON.stringify(body) })
const parse = (res) => ({ status: res.statusCode, body: JSON.parse(res.body) })

async function issued(meta, id = 'cs_test_buy') {
  const V = await fresh('../vouchers.js')
  const amount = meta.voucher_kind === 'amount' ? Number(meta.cents) : undefined
  return V.issueVoucher(stripe, { id, amount_total: amount, metadata: { kind: 'voucher', buyerName: 'A', buyerEmail: 'a@example.com', recipientName: 'R', ...meta } }, '2026-10-18')
}

beforeEach(() => { installFreshBlobs(); stripe = fakeStripe(); globalThis.__sgStripe = stripe; process.env.STRIPE_TEST_KEY = 'sk_test_x' })
afterEach(() => { removeBlobs(); delete globalThis.__sgStripe; delete process.env.STRIPE_TEST_KEY })

describe('voucher-checkout: buying a voucher', () => {
  it('a Golden voucher goes to Stripe at the Golden price', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { handler } = await fresh('../../voucher-checkout.js')
    const res = parse(await handler(post({ kind: 'package', tier: 'golden', buyerName: 'Amanda', buyerEmail: 'amanda@example.com', recipientName: 'Rand' })))
    expect(res.status).toBe(200)
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//)
    const s = stripe._sessions[0]
    expect(s.line_items[0].price_data.unit_amount).toBe(TIERS.golden.priceCents)
    expect(s.metadata).toMatchObject({ kind: 'voucher', voucher_kind: 'package', tier: 'golden', recipientName: 'Rand' })
    expect(s.success_url).toMatch(/\/gift-vouchers\?bought=1/)
  })

  it('a $250 voucher charges $250; under $100 is refused with a message', async () => {
    const { handler } = await fresh('../../voucher-checkout.js')
    expect(parse(await handler(post({ kind: 'amount', amount: 250, buyerName: 'A', buyerEmail: 'a@example.com', recipientName: 'R' }))).status).toBe(200)
    expect(stripe._sessions[0].line_items[0].price_data.unit_amount).toBe(25000)
    const bad = parse(await handler(post({ kind: 'amount', amount: 50, buyerName: 'A', buyerEmail: 'a@example.com', recipientName: 'R' })))
    expect(bad.status).toBe(400)
    expect(bad.body.error.message).toMatch(/start at \$100/)
  })
})

describe('voucher-balance: checking a code on the booking page', () => {
  it('says what the voucher covers for the chosen session, and what is left to pay', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const v = await issued({ voucher_kind: 'package', tier: 'glimpse', cents: String(TIERS.glimpse.priceCents) })
    const { handler } = await fresh('../../voucher-balance.js')
    const res = parse(await handler(post({ code: v.code.toLowerCase(), service_key: TIERS.golden.serviceKey })))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ usedCents: TIERS.glimpse.priceCents, payCents: TIERS.golden.priceCents - TIERS.glimpse.priceCents })
  })

  it('an unknown code gets a plain message', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { handler } = await fresh('../../voucher-balance.js')
    const res = parse(await handler(post({ code: 'SG-AAAA-BBBB', service_key: TIERS.golden.serviceKey })))
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/wasn't recognised/)
  })
})

describe('booking-checkout: paying with a voucher', () => {
  const booking = (tierKey, TIERS, over = {}) => ({ service_key: TIERS[tierKey].serviceKey, date: '2026-11-21', time: '10:00', firstName: 'Rand', lastName: 'A', email: 'rand@example.com', ...over })

  it('takes the voucher off as a one-off discount for exactly what it covers', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const v = await issued({ voucher_kind: 'amount', cents: '25000' })
    const { handler } = await fresh('../../booking-checkout.js')
    const res = parse(await handler(post(booking('golden', TIERS, { voucherCode: v.code }))))
    expect(res.status).toBe(200)
    const s = stripe._sessions[0]
    expect(s.allow_promotion_codes).toBeUndefined()
    const coupon = stripe._coupons.get(s.discounts[0].coupon)
    expect(coupon).toMatchObject({ amount_off: 25000, currency: 'aud', duration: 'once', max_redemptions: 1 })
    expect(s.metadata).toMatchObject({ voucher_code: v.code, voucher_used_cents: '25000' })
  })

  it('a session voucher can cover the whole price', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const v = await issued({ voucher_kind: 'package', tier: 'golden', cents: String(TIERS.golden.priceCents) })
    const { handler } = await fresh('../../booking-checkout.js')
    await handler(post(booking('golden', TIERS, { voucherCode: v.code })))
    const s = stripe._sessions[0]
    expect(stripe._coupons.get(s.discounts[0].coupon).amount_off).toBe(TIERS.golden.priceCents)
  })

  it('a voucher cannot be split into two payments', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const v = await issued({ voucher_kind: 'amount', cents: '25000' })
    const { handler } = await fresh('../../booking-checkout.js')
    const res = parse(await handler(post(booking('golden', TIERS, { voucherCode: v.code, payMode: 'split' }))))
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/pay in full/i)
    expect(stripe._sessions).toHaveLength(0)
  })

  it('a used voucher is refused before Stripe', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const v = await issued({ voucher_kind: 'amount', cents: '25000' })
    await stripe.promotionCodes.update(v.id, { metadata: { status: 'used', balance_cents: '0' } })
    const { handler } = await fresh('../../booking-checkout.js')
    const res = parse(await handler(post(booking('golden', TIERS, { voucherCode: v.code }))))
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/already been used/)
    expect(stripe._sessions).toHaveLength(0)
  })

  it('without a voucher, the promo code box stays as it was', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { handler } = await fresh('../../booking-checkout.js')
    await handler(post(booking('golden', TIERS)))
    expect(stripe._sessions[0].allow_promotion_codes).toBe(true)
    expect(stripe._sessions[0].discounts).toBeUndefined()
  })
})
