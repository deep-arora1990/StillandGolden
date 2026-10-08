// Booking workflow, Stage A (8 Oct 2026): one email for the booking confirmation
// and the session terms, terms pages prefilled from a signed link, the
// questionnaire sent once the terms are signed, and "[S&G]" on every email that
// goes to Deep. Plan: stillandgolden-docs/2026-10-08-booking-workflow-plan.md
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')

async function fresh(mod) {
  vi.resetModules()
  process.env.RESEND_API_KEY = 're_test'
  process.env.SETMORE_API_KEY = 'test'
  delete process.env.SETMORE_MOCK
  return await import(mod)
}

let calls
function stubResend() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    url = String(url)
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
    return json(url.includes('/emails') ? { id: 'e1' } : {})
  }))
}
const emails = () => calls.filter((c) => c.url.endsWith('/emails')).map((c) => c.body)
const to = (addr) => emails().find((e) => [].concat(e.to).includes(addr))
const OWNER = 'hello@stillandgolden.com.au'
const post = (body) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) })

beforeEach(() => { process.env.BOOKING_LINK_SECRET = 'test-link-secret-0123456789' })
afterEach(() => { vi.unstubAllGlobals(); delete process.env.BOOKING_LINK_SECRET })

describe('signed booking links', () => {
  it('round-trips a booking, and refuses a tampered, expired or unsigned link', async () => {
    const links = await fresh('../booking-links.js')
    const token = links.sign({ a: 'appt1', s: 'golden', d: '2026-11-21', h: '10:00', e: 'm@example.com' })
    expect(links.verify(token)).toMatchObject({ a: 'appt1', s: 'golden', d: '2026-11-21' })

    const [data, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data, 'base64').toString()), s: 'bloom' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(links.verify(`${forged}.${sig}`)).toBeNull()
    expect(links.verify(token, Date.now() + 121 * 86400000)).toBeNull()
    expect(links.verify('nonsense')).toBeNull()

    delete process.env.BOOKING_LINK_SECRET
    expect(links.sign({ a: 'x' })).toBeNull()
    expect(links.verify(token)).toBeNull()
  })

  it('never puts a beach mini placeholder time into its link', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const links = await fresh('../booking-links.js')
    const token = links.tokenForBooking({ firstName: 'Mary', email: 'm@example.com', date: '2026-11-20', time: '18:30', notes: 'Location: Carrum\n' },
      'sunset-beach-minis', TIERS['sunset-beach-minis'], 'appt2')
    expect(links.verify(token)).toMatchObject({ h: '', loc: 'Carrum', s: 'sunset-beach-minis' })
  })
})

describe('booking confirmation carries the session terms', () => {
  const meta = { firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', date: '2026-11-21', time: '10:00' }

  it('has the terms button with the signed link, and says the questionnaire follows', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { render, valuesFromBooking } = await fresh('../booking-confirmation.js')
    const out = render(valuesFromBooking(meta, TIERS.golden, { termsUrl: 'https://stillandgolden.com.au/contract?t=TOKEN' }))
    expect(out.html).toContain('href="https://stillandgolden.com.au/contract?t=TOKEN"')
    expect(out.html).toMatch(/Review &amp; sign your session terms/i)
    expect(out.html).toMatch(/questionnaire/i)
    expect(out.text).toContain('https://stillandgolden.com.au/contract?t=TOKEN')
  })

  it('states what was paid — in full, or the split and when the balance comes off', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { render, valuesFromBooking } = await fresh('../booking-confirmation.js')
    const full = render(valuesFromBooking(meta, TIERS.golden, { termsUrl: 'x' }))
    expect(full.text).toMatch(/Paid \$475/)
    const split = render(valuesFromBooking({ ...meta, pay_mode: 'split', balance_cents: '23750', charge_on: '2026-10-15' }, TIERS.golden, { termsUrl: 'x' }))
    expect(split.text).toMatch(/\$237\.50 paid today/)
    expect(split.text).toMatch(/\$237\.50 on Thursday 15 October/)
  })

  it('leaves the Christmas minis confirmation as it is (no terms block)', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { render, valuesFromBooking } = await fresh('../booking-confirmation.js')
    const out = render(valuesFromBooking({ ...meta, date: '2026-11-08' }, TIERS['christmas-minis'], { termsUrl: 'x' }))
    expect(out.html).not.toMatch(/session terms/i)
    expect(out.html).toMatch(/Tell me who's coming/)
  })
})

describe('signing the terms', () => {
  const body = { firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', sessionType: 'Glimpse', sessionDate: '2026-12-01', agreementDate: '2026-10-08' }

  it('trusts the signed link over the form for package and date, then sends the questionnaire', async () => {
    stubResend()
    const links = await fresh('../booking-links.js')
    const token = links.sign({ a: 'appt1', f: 'Mary', l: 'Jane', e: 'm@example.com', s: 'golden', d: '2026-11-21', h: '10:00' })
    const { handler } = await fresh('../../submit-contract.js')
    const res = await handler(post({ ...body, token }))
    expect(res.statusCode).toBe(200)
    const client = to('m@example.com')
    expect(client.subject).toMatch(/Thanks for signing/)
    expect(client.html).toContain(`/questionnaire?t=${encodeURIComponent(token)}`)
    expect(client.attachments).toHaveLength(1)
    const owner = to(OWNER)
    expect(owner.subject).toMatch(/^\[S&G\] Terms signed — Mary Jane · Golden/)
    expect(owner.text).toMatch(/Session date: 2026-11-21/)
  })

  it('refuses a link that has been tampered with or has expired', async () => {
    stubResend()
    const { handler } = await fresh('../../submit-contract.js')
    const res = await handler(post({ ...body, token: 'abc.def' }))
    expect(res.statusCode).toBe(400)
    expect(emails()).toHaveLength(0)
  })

  it('still works without a link (signed by hand), and still offers the questionnaire', async () => {
    stubResend()
    const { handler } = await fresh('../../submit-contract.js')
    const res = await handler(post(body))
    expect(res.statusCode).toBe(200)
    expect(to('m@example.com').html).toContain('https://stillandgolden.com.au/questionnaire')
  })

  it('the agreement PDF quotes the current full-gallery prices, matching the contract page', async () => {
    const { _test } = await fresh('../../submit-contract.js')
    expect(_test.TIERS.glimpse.upgrade).toBe(150)
    expect(_test.TIERS.golden.upgrade).toBe(125)
    const page = fs.readFileSync(path.join(ROOT, 'contract.html'), 'utf8')
    expect(page).toMatch(/Glimpse<\/strong> &mdash;[^<]*full gallery may be added for \$150/)
    expect(page).toMatch(/Golden<\/strong> &mdash;[^<]*full gallery may be added for \$125/)
  })

  it('knows the two seasonal offers (full gallery included)', async () => {
    const { _test } = await fresh('../../submit-contract.js')
    expect(_test.resolveTier('in-home-christmas')).toMatchObject({ name: 'In-home Christmas', upgrade: null })
    expect(_test.resolveTier('sunset-beach-minis')).toMatchObject({ name: 'Sunset beach mini', upgrade: null })
  })
})

describe('emails to Deep start with [S&G]', () => {
  it('enquiry and sign-up', async () => {
    stubResend()
    const enquiry = (await fresh('../../submit-enquiry.js')).handler
    await enquiry(post({ first_name: 'Mary', email: 'm@example.com', session_type: 'golden' }))
    expect(to(OWNER).subject).toMatch(/^\[S&G\] New enquiry/)
    stubResend()
    const signup = (await fresh('../../submit-signup.js')).handler
    await signup(post({ first_name: 'Mary', email: 'm@example.com', source: 'offers' }))
    expect(to(OWNER).subject).toMatch(/^\[S&G\] New email sign-up/)
  })

  it('a new booking notifies Deep with everything needed to review it', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../stripe-webhook.js')
    const sent = []
    const resend = { emails: { send: async (m) => { sent.push(m); return { id: 'e' } } } }
    await _test.notifyOwnerOfBooking(resend, { firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', phone: '0400', service_key: TIERS['sunset-beach-minis'].serviceKey,
      date: '2026-11-20', time: '18:30', notes: 'Location: Carrum\nBring the dog', pay_mode: 'split', balance_cents: '14750', charge_on: '2026-11-11' }, { key: 'appt9' })
    expect(sent[0].to).toBe(OWNER)
    expect(sent[0].subject).toMatch(/^\[S&G\] New booking — Mary Jane · Sunset beach mini · Fri 20 Nov/)
    expect(sent[0].text).toMatch(/Carrum/)
    expect(sent[0].text).toMatch(/\$147\.50 now, \$147\.50 on 2026-11-11/)
  })

  it('a balance payment going through tells Deep — the deposit invoice does not', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { _test } = await fresh('../../stripe-webhook.js')
    const sent = []
    const resend = { emails: { send: async (m) => { sent.push(m); return { id: 'e' } } } }
    const meta = { pay_mode: 'split', firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', service_key: TIERS.golden.serviceKey, date: '2026-11-21' }
    const stripe = { subscriptions: { retrieve: async () => ({ id: 'sub_1', metadata: meta }) } }
    await _test.notifyBalancePaid(stripe, resend, { billing_reason: 'subscription_create', subscription: 'sub_1', amount_paid: 23750 })
    expect(sent).toHaveLength(0)
    await _test.notifyBalancePaid(stripe, resend, { billing_reason: 'subscription_cycle', subscription: 'sub_1', amount_paid: 23750 })
    expect(sent[0].subject).toBe('[S&G] Balance paid — Mary Jane · $237.50')
  })
})

describe('Christmas minis confirmation is unchanged', () => {
  it('has no payment line either', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { valuesFromBooking } = await fresh('../booking-confirmation.js')
    expect(valuesFromBooking({ firstName: 'M', date: '2026-11-08', time: '10:30' }, TIERS['christmas-minis']).paymentLine).toBe('')
  })
})
