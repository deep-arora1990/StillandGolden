// Stage 2, Task 6: checkout and the webhook enforce the wedding link, the
// wedding date window and the exclusive day. Checkout refuses a wedding
// without a valid link, outside the window, or on a day that isn't free; and
// after payment the webhook re-reads the day, so a family booking that slipped
// onto a wedding day in a race is held (never written), as is a second wedding.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'
import { fakeStripe } from './helpers/fake-stripe.js'
import { stubSetmore } from './helpers/setmore-stub.js'

const NOW = Date.parse('2026-11-05T01:00:00Z') // 12pm, 5 Nov 2026 in Melbourne

let TIERS, stripe, t, tampered, W, L

async function fresh(mod) {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test'
  delete process.env.SETMORE_MOCK
  return await import(mod)
}

const post = (body) => ({ httpMethod: 'POST', headers: { host: 'stillandgolden.com.au' }, body: JSON.stringify(body) })

async function checkout(body) {
  const { handler } = await fresh('../../booking-checkout.js')
  const res = await handler(post(body))
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

const wedding = (over = {}) => ({
  service_key: TIERS['wedding-short'].serviceKey, date: '2027-03-06', time: '10:00',
  firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', weddingLink: t, returnTo: '/book-wedding.html', ...over,
})
const golden = (over = {}) => ({
  service_key: TIERS.golden.serviceKey, date: '2027-03-13', time: '10:00',
  firstName: 'Mia', lastName: 'Example', email: 'mia@example.com', ...over,
})
const mintedAt = (now) => W.mintWeddingLink({ firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' }, { now }).token

async function issued(meta, id = 'cs_test_buy') {
  const V = await fresh('../vouchers.js')
  const amount = meta.voucher_kind === 'amount' ? Number(meta.cents) : undefined
  return V.issueVoucher(stripe, { id, amount_total: amount, metadata: { kind: 'voucher', buyerName: 'A', buyerEmail: 'a@example.com', recipientName: 'R', ...meta } }, '2026-10-18')
}

// The webhook, driven as voucher-webhook.test.js drives it: test key + test
// webhook secret, the fake Stripe verifying nothing. Resend is caught in
// front of the Setmore stub, so every email lands in `sent` and none leaves.
let sent
function catchResend() {
  sent = []
  const inner = globalThis.fetch
  const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers({ 'content-type': 'application/json' }), clone() { return this } })
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    if (String(url).startsWith('https://api.resend.com/emails')) { sent.push(JSON.parse(init.body)); return reply({ id: 'em_1' }) }
    if (String(url).includes('resend.com')) return reply({ data: [] })
    return inner(url, init)
  }))
}
let sessionN = 0
async function webhook({ metadata }) {
  catchResend()
  const session = { id: `cs_test_wh${++sessionN}`, amount_total: 1, payment_status: 'paid', metadata }
  const { handler } = await fresh('../../stripe-webhook.js')
  const res = await handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'x' }, body: JSON.stringify({ id: `evt_${sessionN}`, type: 'checkout.session.completed', data: { object: session } }) })
  return res
}
const alerts = () => sent.filter((m) => /ACTION NEEDED/.test(m.subject || ''))

beforeAll(async () => { ({ TIERS } = await import('../setmore.js')) })

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  installFreshBlobs()
  delete globalThis.__sgClosedDatesMemo
  stripe = fakeStripe(); globalThis.__sgStripe = stripe
  process.env.STRIPE_TEST_KEY = 'sk_test_x'
  process.env.BOOKING_LINK_SECRET = 'test-link-secret-0123456789'
  stubSetmore()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  W = await fresh('../weddings.js')
  L = await fresh('../booking-links.js')
  t = mintedAt(NOW)
  const [data, sig] = t.split('.')
  tampered = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data, 'base64').toString()), e: 'x@example.com' })).toString('base64url')}.${sig}`
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  removeBlobs()
  delete globalThis.__sgStripe
  delete process.env.STRIPE_TEST_KEY
  delete process.env.STRIPE_TEST_WEBHOOK_SECRET
  delete process.env.RESEND_API_KEY
  delete process.env.BOOKING_LINK_SECRET
})

describe('wedding checkout', () => {
  it('checkout refuses a wedding without a valid link', async () => {
    for (const weddingLink of [undefined, tampered, mintedAt(NOW - 31 * 86400000), L.sign({ a: 'a1', s: 'golden', d: '2027-03-06' })]) {
      const r = await checkout(wedding({ weddingLink }))
      expect(r.status).toBe(403); expect(r.body.error.code).toBe('LINK_INVALID')
      expect(r.body.error.message).toBe(W.WEDDING_LINK_INVALID_MESSAGE)
    }
    expect(stripe._sessions).toHaveLength(0)
  })

  it('books a wedding from a valid link on a Tuesday 3 years out, promo codes on', async () => {
    const r = await checkout(wedding({ date: '2029-11-27' }))
    expect(r.status).toBe(200)
    const s = stripe._sessions[0], pd = s.line_items[0].price_data
    expect(pd.unit_amount).toBe(70000)
    expect(pd.product_data).toMatchObject({ name: 'Short & sweet: wedding photography', description: '2029-11-27 · your wedding day · 3 hours' })
    expect(s.allow_promotion_codes).toBe(true)
    expect(s.success_url).toContain('/book-wedding.html?booked=1')
    expect(s.cancel_url).toContain('/book-wedding.html?')
    expect(s.cancel_url).toContain(`t=${encodeURIComponent(t)}`)
  })

  it('a family checkout never carries a link in its cancel URL', async () => {
    const r = await checkout(golden({ weddingLink: t, returnTo: '/book.html' }))
    expect(r.status).toBe(200)
    expect(stripe._sessions[0].cancel_url).not.toContain('t=')
  })

  it('refuses a wedding date outside the window', async () => {
    expect((await checkout(wedding({ date: '2029-12-01' }))).status).toBe(400)
    expect((await checkout(wedding({ date: '2026-11-05' }))).status).toBe(400)
    expect((await checkout(wedding({ date: '2027-02-31' }))).status).toBe(400)
    expect(stripe._sessions).toHaveLength(0)
  })

  it('split for a wedding: half now, the rest every 4 weeks, once', async () => {
    const r = await checkout(wedding({ payMode: 'split' }))
    expect(r.status).toBe(200)
    const s = stripe._sessions[0]
    expect(s.mode).toBe('subscription')
    expect(s.line_items[0].price_data).toMatchObject({ unit_amount: 35000, recurring: { interval: 'week', interval_count: 4 } })
    expect(s.metadata).toMatchObject({ pay_mode: 'split', balance_cents: '35000', charge_on: '2026-12-03' })
  })

  it('no split for a wedding less than 5 weeks out', async () => {
    expect((await checkout(wedding({ date: '2026-12-09', payMode: 'split' }))).status).toBe(400)
    expect((await checkout(wedding({ date: '2026-12-03', payMode: 'split' }))).status).toBe(400)
    expect((await checkout(wedding({ date: '2026-12-10', payMode: 'split' }))).status).toBe(200)
  })

  it('a voucher never rides with a split, even one that covers the whole fee', async () => {
    const v = await issued({ voucher_kind: 'amount', cents: '100000' })
    const r = await checkout(wedding({ payMode: 'split', voucherCode: v.code }))
    expect(r.status).toBe(400); expect(r.body.error.message).toMatch(/pay in full/i)
    expect(stripe._sessions).toHaveLength(0); expect([...stripe._coupons.values()].filter((c) => c.amount_off)).toHaveLength(0)
  })

  it('a voucher bigger than the fee covers exactly the fee', async () => {
    const v = await issued({ voucher_kind: 'amount', cents: '100000' })
    const r = await checkout(wedding({ voucherCode: v.code }))
    expect(r.status).toBe(200)
    const s = stripe._sessions[0]
    expect(stripe._coupons.get(s.discounts[0].coupon).amount_off).toBe(70000)
    expect(s.metadata.voucher_used_cents).toBe('70000')
    expect(s.allow_promotion_codes).toBeUndefined()
  })

  it('checkout: a wedding day refuses every package, and a booked day refuses a wedding', async () => {
    stubSetmore({ appointments: [{ service_key: TIERS['wedding-full'].serviceKey, start_time: '2027-03-06T10:00' },
                                 { service_key: TIERS.golden.serviceKey, start_time: '2027-03-13T09:00' }] })
    const family = await checkout(golden({ date: '2027-03-06', time: '17:00' }))
    expect(family.status).toBe(409)
    expect(family.body.error).toEqual({ code: 'DAY_TAKEN', message: "That day isn't available any more, please pick another." })
    const onWedding = await checkout(wedding({ date: '2027-03-06' }))
    expect(onWedding.status).toBe(409)
    expect(onWedding.body.error).toEqual({ code: 'DAY_TAKEN', message: 'Sorry, that day has just been taken. Pick another?' })
    expect((await checkout(wedding({ date: '2027-03-13' }))).status).toBe(409)
    expect(stripe._sessions).toHaveLength(0)
    // A family day with another family booking on it is still open to family.
    expect((await checkout(golden({ date: '2027-03-13', time: '14:00' }))).status).toBe(200)
  })

  it("when Setmore can't be read: a family booking goes ahead, a wedding waits", async () => {
    stubSetmore({ failAppointments: true })
    expect((await checkout(golden({ date: '2027-03-13', time: '10:00' }))).status).toBe(200)
    const w = await checkout(wedding())
    expect(w.status).toBe(503)
    expect(w.body.error.code).toBe('SETMORE_BUSY')
    expect(stripe._sessions).toHaveLength(1)
  })
})

describe('wedding webhook', () => {
  beforeEach(() => {
    process.env.STRIPE_TEST_WEBHOOK_SECRET = 'whsec_x'
    process.env.RESEND_API_KEY = 're_test'
  })

  it('a family booking that lands on a wedding day after payment is held, never written', async () => {
    const s = stubSetmore({ appointments: [{ service_key: TIERS['wedding-short'].serviceKey, start_time: '2027-03-06T10:00' }] })
    const res = await webhook({ metadata: { service_key: TIERS.golden.serviceKey, date: '2027-03-06', time: '17:00', firstName: 'Mary', lastName: 'Jane', email: 'mary@example.com' } })
    expect(JSON.parse(res.body)).toMatchObject({ booked: false, held: true })
    expect(s.created).toHaveLength(0)
    const toDeep = alerts()
    expect(toDeep).toHaveLength(1)
    expect(toDeep[0].to).toBe('hello@stillandgolden.com.au')
    expect(toDeep[0].text).toContain('wedding days are exclusive')
    expect(toDeep[0].text).toContain('2027-03-06 already has a booking')
  })

  it('a second wedding on the same day is held too; a redelivered wedding finds itself', async () => {
    let s = stubSetmore({ appointments: [{ service_key: TIERS['wedding-short'].serviceKey, start_time: '2027-03-06T10:00', customer: { email_id: 'other@example.com' } }] })
    let res = await webhook({ metadata: { service_key: TIERS['wedding-full'].serviceKey, date: '2027-03-06', time: '10:00', firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' } })
    expect(JSON.parse(res.body)).toMatchObject({ booked: false, held: true })
    expect(s.created).toHaveLength(0)
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].text).toContain('wedding days are exclusive')

    s = stubSetmore({ appointments: [{ service_key: TIERS['wedding-short'].serviceKey, start_time: '2027-03-06T10:00', customer: { email_id: 'sam@example.com' } }] })
    res = await webhook({ metadata: { service_key: TIERS['wedding-short'].serviceKey, date: '2027-03-06', time: '10:00', firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' } })
    expect(JSON.parse(res.body)).toMatchObject({ alreadyBooked: true })
    expect(s.created).toHaveLength(0)
    expect(alerts()).toHaveLength(0)
  })

  it('a wedding on a free day is written to Setmore', async () => {
    const s = stubSetmore()
    const res = await webhook({ metadata: { service_key: TIERS['wedding-short'].serviceKey, date: '2027-03-06', time: '10:00', firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' } })
    expect(JSON.parse(res.body)).toMatchObject({ booked: true })
    expect(s.created).toHaveLength(1)
    expect(alerts()).toHaveLength(0)
  })

  it("when the day can't be read after payment: a wedding is held, a family booking is written", async () => {
    let s = stubSetmore({ failAppointments: true })
    let res = await webhook({ metadata: { service_key: TIERS['wedding-short'].serviceKey, date: '2027-03-06', time: '10:00', firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' } })
    expect(JSON.parse(res.body)).toMatchObject({ booked: false, held: true })
    expect(s.created).toHaveLength(0)
    expect(alerts()).toHaveLength(1)

    s = stubSetmore({ failAppointments: true })
    res = await webhook({ metadata: { service_key: TIERS.golden.serviceKey, date: '2027-03-13', time: '10:00', firstName: 'Mia', lastName: 'Example', email: 'mia@example.com' } })
    expect(JSON.parse(res.body)).toMatchObject({ booked: true })
    expect(s.created).toHaveLength(1)
    expect(alerts()).toHaveLength(0)
  })
})

describe('the calendar reads behind exclusivity', () => {
  const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })

  it('a range read that hits its page cap with more to come fails rather than truncating', async () => {
    let page = 0
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      url = String(url)
      if (url.includes('/o/oauth2/token')) return reply({ response: true, data: { token: { access_token: 'tok', expires_in: 3600 } } })
      if (url.includes('/bookingapi/appointments?')) {
        page++
        return reply({ response: true, data: { appointments: [{ service_key: 'x', start_time: '2027-03-06T10:00' }], pagination: { cursor: `c${page}` } } })
      }
      return reply({ ok: true })
    }))
    const S = await fresh('../setmore.js')
    await expect(S.getAppointmentsInRange('2027-03-01', '2027-03-31')).rejects.toMatchObject({ name: 'SetmoreError', code: 'TOO_MANY_PAGES' })
    page = 0
    await expect(S.appointmentsByDay('2027-03-01', '2027-03-31')).rejects.toMatchObject({ code: 'TOO_MANY_PAGES' })
  })

  it('a range read that runs out of pages returns everything', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      url = String(url)
      if (url.includes('/o/oauth2/token')) return reply({ response: true, data: { token: { access_token: 'tok', expires_in: 3600 } } })
      if (url.includes('/bookingapi/appointments?')) {
        const cursor = new URL(url).searchParams.get('cursor')
        return cursor
          ? reply({ response: true, data: { appointments: [{ start_time: '2027-03-07T10:00' }] } })
          : reply({ response: true, data: { appointments: [{ start_time: '2027-03-06T10:00' }], pagination: { cursor: 'next' } } })
      }
      return reply({ ok: true })
    }))
    const S = await fresh('../setmore.js')
    expect(await S.getAppointmentsInRange('2027-03-01', '2027-03-31')).toHaveLength(2)
  })

  it('availability reads the range without customer details; the contact sync still gets them', async () => {
    let s = stubSetmore()
    const S = await fresh('../setmore.js')
    await S.appointmentsByDay('2027-03-01', '2027-03-31')
    const byDay = s.calls.filter((c) => c.url.includes('/bookingapi/appointments?'))
    expect(byDay).toHaveLength(1)
    expect(new URL(byDay[0].url).searchParams.has('customerDetails')).toBe(false)

    s = stubSetmore()
    await S.getAppointmentsInRange('2027-03-01', '2027-03-31')
    const sync = s.calls.filter((c) => c.url.includes('/bookingapi/appointments?'))
    expect(new URL(sync[0].url).searchParams.get('customerDetails')).toBe('true')
  })

  it('wedding-link-check answers with the shared invalid-link message', async () => {
    const src = readFileSync(fileURLToPath(new URL('../../wedding-link-check.js', import.meta.url)), 'utf8')
    expect(src).toContain('WEDDING_LINK_INVALID_MESSAGE')
    expect(src).not.toContain("This link has expired or isn't quite right")
    const { handler } = await fresh('../../wedding-link-check.js')
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { t: tampered } })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toEqual({ code: 'LINK_INVALID', message: W.WEDDING_LINK_INVALID_MESSAGE })
  })
})
