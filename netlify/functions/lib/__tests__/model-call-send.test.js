// "Send model call forms" from Studio (15 Oct 2026): for a session Deep added by
// hand, one email carries both model call links, prefilled from the booking
// with plain (editable) parameters. Signing and the questionnaire then report
// back to Studio's Bookings screen, matched on email + session date.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const STUDIO = 'https://studio.example/.netlify/functions/booking-intake'
const SECRET = 'ingest-secret-test'

async function fresh(mod) {
  vi.resetModules()
  process.env.RESEND_API_KEY = 're_test'
  process.env.SETMORE_API_KEY = 'test'
  process.env.BOOKING_LINK_SECRET = 'link-secret-test'
  process.env.BOOKING_INGEST_SECRET = SECRET
  process.env.STUDIO_BOOKING_INGEST_URL = STUDIO
  delete process.env.SETMORE_MOCK
  return await import(mod)
}
let calls
function stub() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null })
    const body = String(url) === STUDIO ? { ok: true, matched: true } : { id: 'e1' }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}
const emails = () => calls.filter((c) => c.url.endsWith('/emails')).map((c) => c.body)
const toStudio = () => calls.filter((c) => c.url === STUDIO).map((c) => c.body)
const post = (body, headers = {}) => ({ httpMethod: 'POST', headers, body: JSON.stringify(body) })
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&')))

beforeEach(() => stub())
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['BOOKING_LINK_SECRET', 'BOOKING_INGEST_SECRET', 'STUDIO_BOOKING_INGEST_URL']) delete process.env[k]
})

const send = { kind: 'model-call', appointmentId: 'appt-m1', firstName: 'Mia', lastName: 'Example', email: 'mia@example.com', tierKey: 'sunset-beach-minis', date: '2026-10-25', time: '18:30', location: '' }

describe('sending the model call forms', () => {
  it('one email, both forms, each prefilled with name, email and date', async () => {
    const { handler } = await fresh('../../booking-link-send.js')
    const res = await handler(post(send, { 'x-ingest-secret': SECRET }))
    expect(res.statusCode).toBe(200)
    expect(emails()).toHaveLength(1)
    const mail = emails()[0]
    expect(mail.to).toBe('mia@example.com')
    const links = hrefs(mail.html)
    const agreement = links.find((u) => u.pathname === '/model-call-agreement')
    const questionnaire = links.find((u) => u.pathname === '/model-call-questionnaire')
    expect(Object.fromEntries(agreement.searchParams)).toEqual({ f: 'Mia', l: 'Example', e: 'mia@example.com', d: '2026-10-25' })
    expect(Object.fromEntries(questionnaire.searchParams)).toEqual({ name: 'Mia Example', email: 'mia@example.com', date: '2026-10-25' })
  })

  it('works whatever service the booking is under (generic model calls)', async () => {
    const { handler } = await fresh('../../booking-link-send.js')
    for (const tierKey of ['golden', '', 'christmas-minis', 'some-new-service']) {
      expect((await handler(post({ ...send, tierKey }, { 'x-ingest-secret': SECRET }))).statusCode).toBe(200)
    }
  })

  it('still needs the shared secret, an email and a date', async () => {
    const { handler } = await fresh('../../booking-link-send.js')
    expect((await handler(post(send, { 'x-ingest-secret': 'wrong' }))).statusCode).toBe(401)
    expect((await handler(post({ ...send, email: 'x' }, { 'x-ingest-secret': SECRET }))).statusCode).toBe(400)
    expect((await handler(post({ ...send, date: '' }, { 'x-ingest-secret': SECRET }))).statusCode).toBe(400)
  })
})

describe('the agreement page reads the prefill', () => {
  it('fills name, email and date from the link and leaves them editable', () => {
    const page = fs.readFileSync(path.join(ROOT, 'model-call-agreement.html'), 'utf8')
    expect(page).toMatch(/params\.get\('f'\)/)
    expect(page).toMatch(/params\.get\('d'\)/)
    expect(page).not.toMatch(/readOnly = true/)
  })
})

describe('Studio hears back', () => {
  it('signing the model call agreement marks the terms signed', async () => {
    const { handler } = await fresh('../../submit-model-call-agreement.js')
    await handler(post({ firstName: 'Mia', lastName: 'Example', email: 'mia@example.com', sessionDate: '2026-10-25', agreementDate: '2026-10-20', accepted: true }))
    expect(toStudio()).toEqual([{ type: 'terms_signed', email: 'mia@example.com', sessionDate: '2026-10-25' }])
  })

  it('the model call questionnaire is recorded with its answers', async () => {
    const { handler } = await fresh('../../submit-model-call-questionnaire.js')
    await handler(post({ name: 'Mia Example', email: 'mia@example.com', mobile: '0400 000 000', sessionDate: '2026-10-25', joining: 'Mia, Tom and Ava (4)', kidsInto: 'Bluey' }))
    const ev = toStudio()[0]
    expect(ev).toMatchObject({ type: 'questionnaire', email: 'mia@example.com', sessionDate: '2026-10-25' })
    expect(ev.answers).toMatchObject({ joining: 'Mia, Tom and Ava (4)', kidsInto: 'Bluey' })
  })
})
