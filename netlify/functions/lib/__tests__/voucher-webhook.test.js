// The webhook's two voucher jobs: issue a voucher when one is bought (and
// email it, with a printable PDF, to the buyer), and take a booking's share
// off a voucher once the booking is made.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'
import { fakeStripe } from './helpers/fake-stripe.js'

let stripe, sent, setmoreCalls
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers({ 'content-type': 'application/json' }), clone() { return this } })

function stubFetch() {
  sent = []; setmoreCalls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    url = String(url)
    if (url.startsWith('https://api.resend.com/emails')) { sent.push(JSON.parse(init.body)); return reply({ id: 'em_1' }) }
    if (url.includes('resend.com')) return reply({ data: [] })
    setmoreCalls.push(url)
    if (url.includes('/o/oauth2/token')) return reply({ response: true, data: { token: { access_token: 't', expires_in: 3600 } } })
    if (url.includes('/staffs')) return reply({ response: true, data: { staffs: [{ key: 's' }] } })
    if (url.includes('/customer/create')) return reply({ response: true, data: { customer: { key: 'c1' } } })
    if (url.includes('/bookingapi/customer')) return reply({ response: true, data: { customer: [] } })
    if (url.includes('/appointment/create')) return reply({ response: true, data: { appointment: { key: 'a1' } } })
    return reply({ response: true, data: {} })
  }))
}

async function fresh(mod) {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test'
  delete process.env.SETMORE_MOCK
  return await import(mod)
}
const deliver = async (session, id = 'evt_test_1') => {
  const { handler } = await fresh('../../stripe-webhook.js')
  return handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'x' }, body: JSON.stringify({ id, type: 'checkout.session.completed', data: { object: session } }) })
}

beforeEach(() => {
  installFreshBlobs(); stubFetch(); stripe = fakeStripe(); globalThis.__sgStripe = stripe
  process.env.STRIPE_TEST_KEY = 'sk_test_x'; process.env.STRIPE_TEST_WEBHOOK_SECRET = 'whsec_x'; process.env.RESEND_API_KEY = 're_test'
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  removeBlobs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete globalThis.__sgStripe
  delete process.env.STRIPE_TEST_KEY; delete process.env.STRIPE_TEST_WEBHOOK_SECRET; delete process.env.RESEND_API_KEY
})

const bought = (over = {}) => ({
  id: 'cs_test_voucher1', amount_total: 39500, payment_status: 'paid',
  metadata: { kind: 'voucher', voucher_kind: 'package', tier: 'golden', cents: '39500', buyerName: 'Amanda Nonnis', buyerEmail: 'amanda@example.com', recipientName: 'Rand', message: 'Congratulations on your little one! 🍼', ...over },
})

describe('a voucher is bought', () => {
  it('issues it, emails the buyer a printable voucher, and tells Deep — without booking anything', async () => {
    const V = await fresh('../vouchers.js')
    const session = bought(); stripe._sessions.push(session)
    const res = await deliver(session)
    expect(res.statusCode).toBe(200)
    const code = V.voucherCode('cs_test_voucher1')
    expect(stripe._promos.size).toBe(1)

    const toBuyer = sent.find((m) => [].concat(m.to).includes('amanda@example.com'))
    expect(toBuyer.subject).toMatch(/Rand/)
    expect(toBuyer.text).toContain(code)
    expect(toBuyer.text).toMatch(/Golden session/)
    expect(toBuyer.attachments[0].filename).toMatch(/\.pdf$/)
    expect(toBuyer.html).toContain(`https://stillandgolden.com.au/book?voucher=${code}`)
    expect(Buffer.from(toBuyer.attachments[0].content, 'base64').subarray(0, 5).toString()).toBe('%PDF-')

    const toDeep = sent.find((m) => [].concat(m.to).includes('hello@stillandgolden.com.au'))
    expect(toDeep.subject).toMatch(/\[S&G\] Gift voucher sold/)
    expect(toDeep.text).toContain(code)

    expect(setmoreCalls.some((u) => u.includes('/appointment/create'))).toBe(false)
    expect(stripe._sessions[0].metadata.issued).toBe(code)
  })

  it('a second delivery of the same event sends nothing twice', async () => {
    const session = bought(); stripe._sessions.push(session)
    await deliver(session)
    const count = sent.length
    await deliver(session)
    expect(sent.length).toBe(count)
    expect(stripe._promos.size).toBe(1)
  })
})

describe('a voucher that cannot be issued', () => {
  it('asks Stripe to retry, and tells Deep at once how to fix it by hand', async () => {
    const V = await fresh('../vouchers.js')
    stripe.promotionCodes.create = async () => { throw new Error('Stripe is down') }
    const session = bought(); stripe._sessions.push(session)
    const res = await deliver(session, 'evt_live_abc123')
    expect(res.statusCode).toBe(500)
    expect(sent.find((m) => [].concat(m.to).includes('amanda@example.com'))).toBeUndefined()
    const alert = sent.find((m) => m.subject && m.subject.startsWith('[S&G] Voucher NOT issued'))
    expect(alert).toBeTruthy()
    expect(alert.text).toContain('amanda@example.com')
    expect(alert.text).toContain('Rand')
    expect(alert.text).toContain(V.voucherCode('cs_test_voucher1'))
    expect(alert.text).toContain('evt_live_abc123')
    expect(alert.text).toMatch(/Developers.*Webhooks/)
    expect(alert.text).toMatch(/Resend/)
    expect(alert.text).toMatch(/Refund/)
    expect(alert.text).toContain('Stripe is down')
  })

  it("Stripe's own retries don't send the alert again", async () => {
    stripe.promotionCodes.create = async () => { throw new Error('Stripe is down') }
    const session = bought(); stripe._sessions.push(session)
    await deliver(session)
    await deliver(session)
    expect(sent.filter((m) => m.subject && m.subject.startsWith('[S&G] Voucher NOT issued'))).toHaveLength(1)
  })
})

describe('a booking paid with a voucher', () => {
  it('takes its share off the voucher and says so to the client and to Deep', async () => {
    const V = await fresh('../vouchers.js')
    const { TIERS } = await fresh('../setmore.js')
    const v = await V.issueVoucher(stripe, { id: 'cs_test_buy500', amount_total: 50000, metadata: { voucher_kind: 'amount', cents: '50000', buyerName: 'A', buyerEmail: 'a@example.com', recipientName: 'Rand' } }, '2026-10-18')
    const price = TIERS.golden.priceCents
    const session = {
      id: 'cs_test_book1', amount_subtotal: price, amount_total: 0, payment_status: 'paid',
      total_details: { amount_discount: price }, discounts: [{ coupon: 'co_x' }],
      metadata: { service_key: TIERS.golden.serviceKey, date: '2026-11-21', time: '10:00', firstName: 'Rand', lastName: 'A', email: 'rand@example.com', phone: '', notes: '', voucher_code: v.code, voucher_used_cents: String(price) },
    }
    stripe._sessions.push(session)
    await deliver(session)

    const after = await V.findVoucher(stripe, v.code)
    expect(after.balanceCents).toBe(50000 - price)
    expect(after.status).toBe('active')

    const toClient = sent.find((m) => [].concat(m.to).includes('rand@example.com'))
    expect(toClient.text).toContain(`gift voucher ${v.code} covered $${price / 100}`)
    expect(toClient.text).toMatch(new RegExp(`\\$${(50000 - price) / 100} left on it`))
    expect(toClient.text).not.toMatch(/% off/)
    const toDeep = sent.find((m) => m.subject && m.subject.startsWith('[S&G] New booking'))
    expect(toDeep.text).toContain(v.code)
    expect(toDeep.text).toMatch(new RegExp(`\\$${(50000 - price) / 100}(\\.00)? left`))
  })
})
