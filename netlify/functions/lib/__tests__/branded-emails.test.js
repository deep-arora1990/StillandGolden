// Every email a client receives uses the brand template (Deep, 15 Oct 2026):
// the booking confirmation's frame (gold bar, sprig, cream body, signature,
// dark footer) via lib/email-layout.js, with a plain-text version alongside.
// Emails to Deep ([S&G]) stay plain on purpose.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

const SECRET = 'ingest-secret-test'
async function fresh(mod) {
  vi.resetModules()
  process.env.RESEND_API_KEY = 're_test'
  process.env.SETMORE_API_KEY = 'test'
  process.env.BOOKING_LINK_SECRET = 'link-secret-test'
  process.env.BOOKING_INGEST_SECRET = SECRET
  delete process.env.SETMORE_MOCK
  delete process.env.STUDIO_BOOKING_INGEST_URL
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
const to = (addr) => emails().find((e) => [].concat(e.to).includes(addr))
const post = (body, headers = {}) => ({ httpMethod: 'POST', headers, body: JSON.stringify(body) })

// The marks of the brand frame.
function expectBranded(mail) {
  expect(mail, 'email was sent').toBeTruthy()
  expect(mail.html).toMatch(/viewBox="0 0 100 200"/)        // the sprig
  expect(mail.html).toMatch(/background-color:#F8F5F1/)      // cream body
  expect(mail.html).toMatch(/ABN 37 280 912 036/)            // footer
  expect(mail.html).toMatch(/Still &amp; Golden Photography/)
  expect(mail.text, 'plain-text version').toBeTruthy()
  expect(mail.text).not.toMatch(/<[a-z][^>]*>/i)
}

beforeEach(() => { installFreshBlobs(); stub() })
afterEach(() => { removeBlobs(); vi.unstubAllGlobals() })

describe('the layout', () => {
  it('frames the content, escapes nothing it is handed as HTML, and builds the text version', async () => {
    const { brandedEmail } = await fresh('../email-layout.js')
    const out = brandedEmail({
      eyebrow: 'One last step', heading: 'Hi Mia,',
      paragraphs: ['Your session terms &mdash; a minute to sign.'],
      buttons: [{ label: 'Sign', url: 'https://stillandgolden.com.au/contract?t=a&b=c' }],
      details: [['Beach', 'Carrum & Seaford']],
    })
    expectBranded(out)
    expect(out.html).toContain('href="https://stillandgolden.com.au/contract?t=a&amp;b=c"')
    expect(out.html).toContain('Carrum &amp; Seaford')
    expect(out.text).toContain('Sign: https://stillandgolden.com.au/contract?t=a&b=c')
    expect(out.text).toContain('Your session terms — a minute to sign.')
    expect(out.text).toContain('Beach: Carrum & Seaford')
  })
})

describe('emails sent from Studio', () => {
  const body = { appointmentId: 'a1', firstName: 'Mia', lastName: 'Example', email: 'mia@example.com', tierKey: 'golden', date: '2026-11-21', time: '10:00', location: '' }
  for (const kind of ['terms', 'questionnaire', 'model-call']) {
    it(`${kind}`, async () => {
      const { handler } = await fresh('../../booking-link-send.js')
      await handler(post({ ...body, kind }, { 'x-ingest-secret': SECRET }))
      expectBranded(to('mia@example.com'))
    })
  }
})

describe('after signing and after the questionnaires', () => {
  it('session agreement: thanks for signing', async () => {
    const { handler } = await fresh('../../submit-contract.js')
    await handler(post({ firstName: 'Mia', lastName: 'Example', email: 'mia@example.com', sessionType: 'Golden', sessionDate: '2026-11-21', agreementDate: '2026-10-15' }))
    expectBranded(to('mia@example.com'))
  })

  it('model call agreement: thanks for signing', async () => {
    const { handler } = await fresh('../../submit-model-call-agreement.js')
    await handler(post({ firstName: 'Mia', lastName: 'Example', email: 'mia@example.com', sessionDate: '2026-10-25', agreementDate: '2026-10-15', accepted: true }))
    expectBranded(to('mia@example.com'))
  })

  it('model call questionnaire: their copy', async () => {
    const { handler } = await fresh('../../submit-model-call-questionnaire.js')
    await handler(post({ name: 'Mia Example', email: 'mia@example.com', mobile: '0400 000 000', joining: 'Mia and Ava (4)', kidsInto: 'Bluey' }))
    const mail = to('mia@example.com')
    expectBranded(mail)
    expect(mail.html).toContain('Bluey')
  })

  it('session questionnaire: their copy', async () => {
    const { handler } = await fresh('../../submit-questionnaire.js')
    await handler(post({ names: 'Mia Example', email: 'mia@example.com', sessionDate: '2026-11-21', imageConsent: 'Yes' }))
    expectBranded(to('mia@example.com'))
  })

  it('Christmas minis form: their copy', async () => {
    const { handler } = await fresh('../../submit-mini-questionnaire.js')
    await handler(post({ name: 'Mia Example', email: 'mia@example.com', joining: 'Mia and Ava (4)' }))
    expectBranded(to('mia@example.com'))
  })
})

describe('payments', () => {
  const meta = { firstName: 'Mia', lastName: 'Example', email: 'mia@example.com', date: '2026-11-21', time: '10:00', service_key: 'svc' }

  it('a held booking', async () => {
    const { _test } = await fresh('../../stripe-webhook.js')
    const sent = []
    await _test.holdFailedBooking(null, { emails: { send: async (m) => { sent.push(m); return {} } } }, { id: 'cs_1' }, meta, new Error('x'))
    expectBranded(sent.find((m) => m.to === 'mia@example.com'))
  })

  it('the balance reminder and the failed-payment note', async () => {
    const { _test } = await fresh('../../stripe-webhook.js')
    const reminder = _test.balanceReminderEmail(meta, '$237.50', 'Thursday 12 November')
    expectBranded(reminder)
    expect(reminder.text).toMatch(/\$237\.50/)
    const failed = _test.balanceFailedEmail(meta, '$237.50', 'https://invoice.stripe.com/i/x')
    expectBranded(failed)
    expect(failed.html).toContain('href="https://invoice.stripe.com/i/x"')
  })
})
