// Stage 3, Task 7: weddings routed to their own agreement and questionnaire.
// The confirmation links the wedding agreement, Studio's send buttons mail the
// wedding pages, the family agreement refuses a wedding either way, and every
// branded email's footer names weddings. Resend and Studio are stubbed, so
// nothing here leaves the machine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const FUNCTIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

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
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null })
    return new Response(JSON.stringify({ id: 'e1' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}
const emails = () => calls.filter((c) => c.url.endsWith('/emails')).map((c) => c.body)
const post = (body, headers = {}) => ({ httpMethod: 'POST', headers, body: JSON.stringify(body) })

function fakeResend() {
  const sent = []
  return { sent, emails: { send: async (m) => { sent.push(m); return { id: 'e' } } } }
}

const W = { firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', date: '2027-03-06', time: '10:00' }
const tokenIn = (html, path) => decodeURIComponent(new RegExp(`${path}\\?t=([^"&\\s]+)`).exec(html)[1])

let L, TIERS, _test
async function send(body) {
  const { handler } = await fresh('../../booking-link-send.js')
  return handler(post(body, { 'x-ingest-secret': 'ingest-secret-test' }))
}
async function contract(body) {
  const { handler } = await fresh('../../submit-contract.js')
  return handler(post(body))
}

beforeEach(async () => {
  process.env.BOOKING_INGEST_SECRET = 'ingest-secret-test'
  process.env.BOOKING_LINK_SECRET = 'link-secret-test'
  delete process.env.STUDIO_BOOKING_INGEST_URL
  stub()
  L = await fresh('../booking-links.js')
  ;({ TIERS } = await fresh('../setmore.js'))
  ;({ _test } = await fresh('../../stripe-webhook.js'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['BOOKING_INGEST_SECRET', 'BOOKING_LINK_SECRET', 'RESEND_API_KEY']) delete process.env[k]
})

describe('wedding routing', () => {
  it('each package signs its own agreement and fills in its own questionnaire', async () => {
    const { WEDDING_TIER_KEYS } = await fresh('../setmore.js')
    expect(L.WEDDING_AGREEMENT_TIERS).toEqual(WEDDING_TIER_KEYS)
    expect(L.WEDDING_AGREEMENT_PATH).toBe('/wedding-agreement')
    expect(L.WEDDING_QUESTIONNAIRE_PATH).toBe('/wedding-questionnaire')
    for (const k of WEDDING_TIER_KEYS) {
      expect(L.termsPathFor(k)).toBe('/wedding-agreement')
      expect(L.questionnairePathFor(k)).toBe('/wedding-questionnaire')
    }
    expect(L.termsPathFor('golden')).toBe('/contract'); expect(L.termsPathFor('sunset-beach-minis')).toBe('/contract-mini')
    expect(L.questionnairePathFor('golden')).toBe('/questionnaire')
    expect(L).not.toHaveProperty('NO_AGREEMENT_YET')
  })

  it('the wedding confirmation links the agreement for you both to sign, and no questionnaire yet', async () => {
    const resend = fakeResend()
    await _test.sendBookingConfirmation(resend, { ...W, service_key: TIERS['wedding-short'].serviceKey, pay_mode: 'split', balance_cents: '35000', charge_on: '2026-12-03' }, 'appt9')
    const m = resend.sent[0]
    expect(m.subject).toBe("You're booked in: Short & sweet, Saturday, 6 March 2027")
    expect(m.html).toContain('for you both to sign')
    expect(m.html).toContain('Sign your wedding agreement')
    expect(L.verify(tokenIn(m.html, '/wedding-agreement'))).toMatchObject({ a: 'appt9', s: 'wedding-short', d: '2027-03-06', h: '', e: 'sam@example.com', f: 'Sam', l: 'Lee' })
    expect(m.text).toMatch(/Sign your wedding agreement: https:\/\/stillandgolden\.com\.au\/wedding-agreement\?t=/)
    expect(m.text).toContain("I'll send a short questionnaire so I know who's who")
    expect(`${m.html}${m.text}`).not.toMatch(/questionnaire\?t=|\/contract|—|&mdash;|10:00/)
  })

  it("Studio's send-terms emails the wedding agreement link", async () => {
    const r = await send({ kind: 'terms', tierKey: 'wedding-full', appointmentId: 'appt9', firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', date: '2027-03-06', time: '10:00' })
    expect(r.statusCode).toBe(200)
    const m = emails()[0]
    expect(m.subject).toBe('Your wedding agreement from Still & Golden')
    expect(m.to).toBe('sam@example.com')
    expect(L.verify(tokenIn(m.html, '/wedding-agreement'))).toMatchObject({ s: 'wedding-full', h: '', a: 'appt9', d: '2027-03-06' })
    expect(m.html).toContain('Your wedding agreement')
    expect(m.html).toContain('The whole shebang wedding on Saturday, 6 March 2027')
    expect(m.html).toContain('You both sign it on the same page')
    expect(m.html).not.toMatch(/10:00|10am|—|&mdash;|session terms/)
  })

  it("Studio's send-questionnaire emails the wedding questionnaire link, minted fresh when sent", async () => {
    const before = Date.now()
    const r = await send({ kind: 'questionnaire', tierKey: 'wedding-short', appointmentId: 'appt9', firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', date: '2027-03-06' })
    expect(r.statusCode).toBe(200)
    const m = emails()[0]
    expect(m.subject).toBe('A few questions before your wedding')
    expect(m.to).toBe('sam@example.com')
    const p = L.verify(tokenIn(m.html, '/wedding-questionnaire'))
    expect(p).toMatchObject({ s: 'wedding-short', d: '2027-03-06', a: 'appt9' })
    expect(p).not.toHaveProperty('p2'); expect(p).not.toHaveProperty('k')
    expect(p.x).toBeGreaterThanOrEqual(before + 119 * 86400000)   // 120 days from sending, not from booking
    expect(m.html).toContain('Fill in your wedding questionnaire')
    expect(m.html).toContain('Before your Short &amp; sweet wedding on Saturday, 6 March 2027')
    expect(m.html).not.toMatch(/\/questionnaire\?t=|—|&mdash;/)
  })

  it('the family agreement never signs a wedding, with or without a link', async () => {
    for (const body of [{ token: L.sign({ s: 'wedding-short', d: '2027-03-06', e: 'sam@example.com' }) }, { sessionType: 'wedding-full', sessionDate: '2027-03-06' }, { sessionType: 'Wedding' }]) {
      const r = await contract({ firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', agreementDate: '2026-11-10', ...body })
      expect(r.statusCode).toBe(400)
      expect(JSON.parse(r.body).error).toBe("Weddings have their own agreement. Reply to your booking email and I'll send it.")
    }
    expect(emails()).toHaveLength(0)
  })

  it("Deep's new-booking notice says the agreement went out", async () => {
    let resend = fakeResend()
    await _test.notifyOwnerOfBooking(resend, { ...W, service_key: TIERS['wedding-full'].serviceKey }, { key: 'appt9' })
    expect(resend.sent[0].text).toContain('They have been sent the confirmation with the wedding agreement for both of them to sign.')
    expect(resend.sent[0].text).not.toMatch(/isn't built|stage 3|session terms/)
    resend = fakeResend()
    await _test.notifyOwnerOfBooking(resend, { ...W, service_key: TIERS.golden.serviceKey }, { key: 'a' })
    expect(resend.sent[0].text).toContain('They have been sent the confirmation with the session terms to sign.')
  })
})

describe('the email footer names weddings (Deep, 6 Nov 2026)', () => {
  const NEW = 'Newborn, Family &amp; Weddings &middot; South-east Melbourne'

  it('every branded email carries the new line, and none the old one', async () => {
    const { brandedEmail, FOOTER_ROW } = await fresh('../email-layout.js')
    expect(FOOTER_ROW).toContain(NEW)
    const { html } = brandedEmail({ heading: 'Hi', paragraphs: ['x'] })
    expect(html).toContain(NEW); expect(html).not.toContain('Newborn &amp; Family &middot;')

    const resend = fakeResend()
    await _test.sendBookingConfirmation(resend, { ...W, service_key: TIERS.golden.serviceKey }, 'a1')
    expect(resend.sent[0].html).toContain(NEW)
  })

  it('the hand-built enquiry, signup and event emails carry it too', () => {
    for (const f of ['submit-enquiry.js', 'submit-signup.js', 'submit-event-signup.js']) {
      const src = readFileSync(join(FUNCTIONS, f), 'utf8')
      expect(src, f).toContain('Newborn, Family &amp; Weddings &middot; South-east Melbourne')
      expect(src, f).not.toContain('Newborn &amp; Family &middot;')
    }
  })
})
