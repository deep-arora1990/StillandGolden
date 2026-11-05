// Stage 2, Task 7: after a wedding is booked. The client gets a confirmation
// with no family agreement (stage 3 links the wedding one, see
// wedding-routing.test.js) and the 4-week wording; Deep's notices name the
// right period and placeholder; Studio gets a record it accepts. Resend and Studio are
// stubbed, so nothing here leaves the machine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const STUDIO = 'https://studio.example/.netlify/functions/booking-intake'

async function fresh(mod) {
  vi.resetModules()
  process.env.RESEND_API_KEY = 're_test'
  process.env.SETMORE_API_KEY = 'test'
  delete process.env.SETMORE_MOCK
  return await import(mod)
}

let calls
function stub() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    url = String(url)
    calls.push({ url, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null })
    return new Response(JSON.stringify(url === STUDIO ? { ok: true, matched: true } : { id: 'e1' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}
const toStudio = () => calls.filter((c) => c.url === STUDIO)
const emails = () => calls.filter((c) => c.url.endsWith('/emails')).map((c) => c.body)
const post = (body, headers = {}) => ({ httpMethod: 'POST', headers, body: JSON.stringify(body) })

function fakeResend() {
  const sent = []
  return { sent, emails: { send: async (m) => { sent.push(m); return { id: 'e' } } } }
}
const WEEK = 7 * 24 * 3600
function fakeStripe({ capFails = false } = {}) {
  return {
    subscriptions: {
      retrieve: async () => {
        if (capFails) throw new Error('stripe down')
        return { items: { data: [{ current_period_start: 1_000_000, current_period_end: 1_000_000 + WEEK }] } }
      },
      update: async () => ({}),
    },
  }
}

const W = { firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', date: '2027-03-06', time: '10:00' }

beforeEach(() => {
  process.env.STUDIO_BOOKING_INGEST_URL = STUDIO
  process.env.BOOKING_INGEST_SECRET = 'ingest-secret-test'
  process.env.BOOKING_LINK_SECRET = 'link-secret-test'
  stub()
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['STUDIO_BOOKING_INGEST_URL', 'BOOKING_INGEST_SECRET', 'BOOKING_LINK_SECRET', 'RESEND_API_KEY']) delete process.env[k]
})

describe('after a wedding booking', () => {
  it('a wedding confirmation never links the family agreement or the questionnaire, and says 4 weeks', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../stripe-webhook.js')
    const resend = fakeResend()
    await _test.sendBookingConfirmation(resend, { ...W, service_key: TIERS['wedding-short'].serviceKey, pay_mode: 'split', balance_cents: '35000', charge_on: '2026-12-03' }, 'appt9')
    const m = resend.sent[0]
    expect(m.subject).toBe("You're booked in: Short & sweet, Saturday, 6 March 2027")
    for (const s of [m.html, m.text]) {
      expect(s).not.toMatch(/\/contract|session terms|questionnaire\?t=/)
      expect(s).toContain('3 hours of wedding photography'); expect(s).toContain('within 4 weeks')
      expect(s).toContain('$350 paid today · $350 on Thursday 3 December')
      expect(s).not.toMatch(/10:00|10am|—|&mdash;|7 days|2 weeks/)
    }
  })

  it('the family agreement refuses a wedding link instead of falling back to Golden', async () => {
    const links = await fresh('../booking-links.js')
    const token = links.sign({ a: 'appt9', f: 'Sam', l: 'Lee', e: 'sam@example.com', s: 'wedding-short', d: '2027-03-06', h: '' })
    const { handler } = await fresh('../../submit-contract.js')
    const res = await handler(post({ firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', sessionType: 'Golden', sessionDate: '2027-03-06', agreementDate: '2026-11-05', token }))
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toMatch(/own agreement/)
    expect(emails()).toHaveLength(0)
  })

  it("Deep's notices name the right placeholder and the right period", async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../stripe-webhook.js')
    const wk = TIERS['wedding-short'].serviceKey
    const split = { pay_mode: 'split', balance_cents: '35000', charge_on: '2026-12-03' }

    let resend = fakeResend()
    await _test.notifyOwnerOfBooking(resend, { ...W, service_key: wk, ...split }, { key: 'appt9' })
    expect(resend.sent[0].text).toContain('10:00 placeholder')
    expect(resend.sent[0].text).toContain('wedding agreement for both of them to sign')
    expect(resend.sent[0].text).not.toMatch(/18:30|session terms/)
    resend = fakeResend()
    await _test.notifyOwnerOfBooking(resend, { ...W, service_key: TIERS['sunset-beach-minis'].serviceKey, time: '18:30', ...split }, { key: 'a' })
    expect(resend.sent[0].text).toContain('18:30 placeholder')

    const held = async (key) => {
      const r = fakeResend()
      await _test.holdFailedBooking(fakeStripe(), r, { id: 'cs_1', subscription: 'sub_1' }, { ...W, service_key: key, ...split }, new Error('x'))
      return r.sent.find((m) => m.to !== W.email).text
    }
    expect(await held(wk)).toContain('second half due in 4 weeks')
    expect(await held(TIERS.golden.serviceKey)).toContain('second half due in 7 days')

    const capped = async (key) => {
      const r = fakeResend()
      await _test.capSplitSubscription(fakeStripe({ capFails: true }), r, { id: 'cs_1', subscription: 'sub_1' }, { ...W, service_key: key, ...split })
      return r.sent[0].text
    }
    expect(await capped(wk)).toContain('every 4 weeks')
    expect(await capped(TIERS.golden.serviceKey)).toContain('weekly')

    expect(_test.balanceReminderText({ ...W, service_key: wk }, '$350', 'Thursday 3 December')).toContain('for your wedding on 2027-03-06')
    expect(_test.balanceReminderText({ ...W, service_key: TIERS.golden.serviceKey }, '$100', 'x')).toContain('for your session on')
    const failed = _test.balanceFailedEmail({ ...W, service_key: wk }, '$350', null)
    expect(failed.html).toContain('Your wedding balance'); expect(failed.html).toContain('for your wedding')
    expect(_test.balanceReminderEmail({ ...W, service_key: wk }, '$350', 'x').html).toContain('Your wedding balance')
  })

  it('a wedding reaches Studio as a valid booked event', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../stripe-webhook.js')
    await _test.reportBookingToStudio({ id: 'cs_1' }, { ...W, service_key: TIERS['wedding-full'].serviceKey, pay_mode: 'split', balance_cents: '50000', charge_on: '2026-12-03' }, { key: 'appt9' })
    expect(toStudio()[0].body).toMatchObject({ type: 'booked', appointmentId: 'appt9', tierKey: 'wedding-full', sessionDate: '2027-03-06',
      sessionTime: '', timeTbc: true, payMode: 'split', balanceCents: 50000, balanceDue: '2026-12-03' })
  })
})
