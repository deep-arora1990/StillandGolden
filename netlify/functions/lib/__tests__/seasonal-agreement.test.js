// Seasonal Mini Session Agreement (15 Oct 2026). contract-mini.html was the
// stale "Glimpse Session Agreement" ($75 gallery, 50% deposit), linked from
// nowhere. It is now the agreement every Sunset beach mini and In-home
// Christmas booking signs, prefilled from the booking link like /contract. Its
// payment and cancellation terms are the main agreement's, word for word
// (Deep, 15 Oct). The Christmas minis hall day keeps its own terms page.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

const ROOT = path.resolve(__dirname, '../../../..')
const SECRET = 'ingest-secret-test'

async function fresh(mod) {
  vi.resetModules()
  process.env.RESEND_API_KEY = 're_test'
  process.env.SETMORE_API_KEY = 'test'
  process.env.BOOKING_LINK_SECRET = 'link-secret-test'
  process.env.BOOKING_INGEST_SECRET = SECRET
  delete process.env.SETMORE_MOCK
  return await import(mod)
}
let calls
function stub() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null })
    return new Response(JSON.stringify({ id: 'e1' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}
const emails = () => calls.filter((c) => c.url.endsWith('/emails')).map((c) => c.body)
const post = (body, headers = {}) => ({ httpMethod: 'POST', headers, body: JSON.stringify(body) })
const section = (html, heading) => {
  const i = html.indexOf(`<h2>${heading}</h2>`)
  return i < 0 ? null : html.slice(i, html.indexOf('</div>', i))
}
const paras = (html) => (html.match(/<p>[\s\S]*?<\/p>/g) || [])

beforeEach(() => installFreshBlobs())
afterEach(() => { removeBlobs(); vi.unstubAllGlobals(); delete process.env.BOOKING_LINK_SECRET; delete process.env.BOOKING_INGEST_SECRET })

describe('which agreement a booking signs', () => {
  it('the two seasonal offers sign the Seasonal Mini agreement; everything else the main one', async () => {
    const { termsPathFor } = await fresh('../booking-links.js')
    expect(termsPathFor('sunset-beach-minis')).toBe('/contract-mini')
    expect(termsPathFor('in-home-christmas')).toBe('/contract-mini')
    for (const k of ['glimpse', 'golden', 'gathered', 'bloom']) expect(termsPathFor(k)).toBe('/contract')
  })

  it("a beach mini's booking confirmation links the seasonal agreement, prefilled", async () => {
    stub()
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../stripe-webhook.js')
    const { Resend } = await import('resend')
    const meta = { firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', date: '2026-11-02', time: '18:30', notes: 'Location: Carrum\n', service_key: TIERS['sunset-beach-minis'].serviceKey }
    await _test.sendBookingConfirmation(new Resend('re_test'), meta, 'appt7')
    const mail = emails().find((e) => [].concat(e.to).includes('m@example.com'))
    expect(mail.html).toMatch(/https:\/\/stillandgolden\.com\.au\/contract-mini\?t=/)
  })

  it("a Golden booking's confirmation still links the main agreement", async () => {
    stub()
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../stripe-webhook.js')
    const { Resend } = await import('resend')
    const meta = { firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', date: '2026-11-21', time: '10:00', service_key: TIERS.golden.serviceKey }
    await _test.sendBookingConfirmation(new Resend('re_test'), meta, 'appt8')
    const mail = emails().find((e) => [].concat(e.to).includes('m@example.com'))
    expect(mail.html).toMatch(/https:\/\/stillandgolden\.com\.au\/contract\?t=/)
  })

  it("Studio's \"Send terms email\" picks the same agreement", async () => {
    stub()
    const { handler } = await fresh('../../booking-link-send.js')
    await handler(post({ kind: 'terms', appointmentId: 'appt9', firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', tierKey: 'in-home-christmas', date: '2026-11-21', time: '10:00', location: '' }, { 'x-ingest-secret': SECRET }))
    expect(emails()[0].html).toMatch(/https:\/\/stillandgolden\.com\.au\/contract-mini\?t=/)
  })
})

describe('the page', () => {
  const page = fs.readFileSync(path.join(ROOT, 'contract-mini.html'), 'utf8')
  const main = fs.readFileSync(path.join(ROOT, 'contract.html'), 'utf8')

  it('is the Seasonal Mini Session Agreement, with nothing of the old Glimpse terms', () => {
    expect(page).toMatch(/<h1 class="page-title">Seasonal Mini Session Agreement<\/h1>/)
    expect(page).toMatch(/<title>Seasonal Mini Session Agreement/)
    expect(page).not.toMatch(/\$75|deposit|Glimpse/)
    expect(page).toMatch(/number of edited images stated in the offer/)
    expect(page).toMatch(/agree to the terms set out in this Seasonal Mini Session Agreement/)
  })

  it('payment terms are the main agreement\'s, word for word', () => {
    expect(paras(section(page, 'Payment Terms'))).toEqual(paras(section(main, 'Payment Terms')))
  })

  it('cancellation matches the main agreement, without the newborn line', () => {
    const mainParas = paras(section(main, 'Cancellation & Rescheduling')).filter((p) => !/Newborn/.test(p))
    expect(paras(section(page, 'Cancellation & Rescheduling'))).toEqual(mainParas)
  })

  it('prefills from the booking link and sends it, offering only the seasonal sessions', () => {
    expect(page).toMatch(/function readBookingLink/)
    expect(page).toMatch(/token: booking \? booking\.token : undefined/)
    expect(page).toMatch(/<option value="sunset-beach-minis">/)
    expect(page).toMatch(/<option value="in-home-christmas">/)
    expect(page).not.toMatch(/<option value="Golden">/)
  })
})

describe('the signed PDF', () => {
  it('is titled and worded as the seasonal agreement for the two offers', async () => {
    const { _test } = await fresh('../../submit-contract.js')
    const beach = _test.agreementText(_test.resolveTier('sunset-beach-minis'))
    expect(beach.title).toBe('Seasonal Mini Session Agreement')
    expect(beach.included.join(' ')).toMatch(/stated in the offer/)
    expect(beach.included.join(' ')).toMatch(/Sunset beach mini/)
    expect(beach.cancellation.join(' ')).not.toMatch(/Newborn/)
    const golden = _test.agreementText(_test.resolveTier('golden'))
    expect(golden.title).toBe('Golden Session Agreement')
    expect(golden.cancellation.join(' ')).toMatch(/Newborn/)
  })
})
