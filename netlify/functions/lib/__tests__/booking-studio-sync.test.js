// Booking workflow stage B (8 Oct 2026): the website reports booking events to
// Studio's Bookings screen, and sends the terms / questionnaire emails Deep
// triggers from Studio for sessions booked by hand.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const STUDIO = 'https://studio.example/.netlify/functions/booking-intake'
const SECRET = 'ingest-secret-test'

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
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })
    if (url === STUDIO) return json({ ok: true, matched: true })
    return json({ id: 'e1' })
  }))
}
const toStudio = () => calls.filter((c) => c.url === STUDIO)
const emails = () => calls.filter((c) => c.url.endsWith('/emails')).map((c) => c.body)
const post = (body, headers = {}) => ({ httpMethod: 'POST', headers, body: JSON.stringify(body) })

beforeEach(() => {
  process.env.STUDIO_BOOKING_INGEST_URL = STUDIO
  process.env.BOOKING_INGEST_SECRET = SECRET
  process.env.BOOKING_LINK_SECRET = 'link-secret-test'
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['STUDIO_BOOKING_INGEST_URL', 'BOOKING_INGEST_SECRET', 'BOOKING_LINK_SECRET']) delete process.env[k]
})

describe('posting events to Studio', () => {
  it('sends the event with the shared secret, and never throws', async () => {
    stub()
    const { postBookingEvent } = await fresh('../studio-sync.js')
    expect(await postBookingEvent({ type: 'terms_signed', appointmentId: 'a1' })).toBe(true)
    expect(toStudio()[0].headers['x-ingest-secret']).toBe(SECRET)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await postBookingEvent({ type: 'terms_signed', appointmentId: 'a1' })).toBe(false)
  })

  it('does nothing without configuration', async () => {
    stub()
    delete process.env.STUDIO_BOOKING_INGEST_URL
    const { postBookingEvent } = await fresh('../studio-sync.js')
    expect(await postBookingEvent({ type: 'booked', appointmentId: 'a1' })).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('events from the website', () => {
  it('a booking reports everything the Bookings screen shows', async () => {
    stub()
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../stripe-webhook.js')
    await _test.reportBookingToStudio({ id: 'cs_9' }, { firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', phone: '0400',
      service_key: TIERS['sunset-beach-minis'].serviceKey, date: '2026-11-20', time: '18:30', notes: 'Location: Carrum\n',
      pay_mode: 'split', balance_cents: '14750', charge_on: '2026-11-11' }, { key: 'appt9' })
    expect(toStudio()[0].body).toMatchObject({ type: 'booked', appointmentId: 'appt9', tierKey: 'sunset-beach-minis', sessionDate: '2026-11-20',
      sessionTime: '', timeTbc: true, location: 'Carrum', payMode: 'split', amountCents: 29500, balanceCents: 14750, balanceDue: '2026-11-11', stripeSessionId: 'cs_9' })
  })

  it('signing the terms reports it against the booking from the link', async () => {
    stub()
    const links = await fresh('../booking-links.js')
    const token = links.sign({ a: 'appt1', f: 'Mary', l: 'Jane', e: 'm@example.com', s: 'golden', d: '2026-11-21', h: '10:00' })
    const { handler } = await fresh('../../submit-contract.js')
    await handler(post({ firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', agreementDate: '2026-10-08', token }))
    expect(toStudio()[0].body).toMatchObject({ type: 'terms_signed', appointmentId: 'appt1', email: 'm@example.com', sessionDate: '2026-11-21' })
  })

  it('the questionnaire reports its answers and address, matched by the link when there is one', async () => {
    stub()
    process.env.STUDIO_QUESTIONNAIRE_INGEST_URL = ''
    const links = await fresh('../booking-links.js')
    const token = links.sign({ a: 'appt1', e: 'm@example.com', s: 'golden', d: '2026-11-21' })
    const { handler } = await fresh('../../submit-questionnaire.js')
    await handler(post({ names: 'Mary Jane', email: 'm@example.com', sessionDate: '2026-11-21', address: '1 Test St', pets: 'a dog', imageConsent: 'Yes', token }))
    const sent = toStudio()[0].body
    expect(sent).toMatchObject({ type: 'questionnaire', appointmentId: 'appt1', email: 'm@example.com', address: '1 Test St' })
    expect(sent.answers).toMatchObject({ pets: 'a dog', address: '1 Test St' })
    expect(sent.answers.token).toBeUndefined()
  })
})

describe('sending a link from Studio', () => {
  const body = { kind: 'terms', appointmentId: 'appt5', firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', tierKey: 'golden', date: '2026-11-21', time: '10:00', location: '' }

  it('refuses without the shared secret', async () => {
    stub()
    const { handler } = await fresh('../../booking-link-send.js')
    expect((await handler(post(body, { 'x-ingest-secret': 'wrong' }))).statusCode).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('emails the terms with a signed link to the prefilled page', async () => {
    stub()
    const { handler } = await fresh('../../booking-link-send.js')
    const res = await handler(post(body, { 'x-ingest-secret': SECRET }))
    expect(res.statusCode).toBe(200)
    const mail = emails()[0]
    expect(mail.to).toBe('m@example.com')
    expect(mail.subject).toMatch(/session terms/i)
    const link = /https:\/\/stillandgolden\.com\.au\/contract\?t=([^"&\s]+)/.exec(mail.html)
    expect(link).not.toBeNull()
    const links = await fresh('../booking-links.js')
    expect(links.verify(decodeURIComponent(link[1]))).toMatchObject({ a: 'appt5', s: 'golden', d: '2026-11-21', h: '10:00' })
  })

  it('emails the questionnaire link, and never a beach mini time', async () => {
    stub()
    const { handler } = await fresh('../../booking-link-send.js')
    await handler(post({ ...body, kind: 'questionnaire', tierKey: 'sunset-beach-minis', time: '18:30', location: 'Carrum' }, { 'x-ingest-secret': SECRET }))
    const mail = emails()[0]
    expect(mail.subject).toMatch(/questionnaire/i)
    const link = /\/questionnaire\?t=([^"&\s]+)/.exec(mail.html)
    const links = await fresh('../booking-links.js')
    expect(links.verify(decodeURIComponent(link[1]))).toMatchObject({ h: '', loc: 'Carrum' })
  })

  it('refuses Christmas minis and unknown packages', async () => {
    stub()
    const { handler } = await fresh('../../booking-link-send.js')
    expect((await handler(post({ ...body, tierKey: 'christmas-minis' }, { 'x-ingest-secret': SECRET }))).statusCode).toBe(400)
    expect((await handler(post({ ...body, tierKey: 'nope' }, { 'x-ingest-secret': SECRET }))).statusCode).toBe(400)
  })
})
