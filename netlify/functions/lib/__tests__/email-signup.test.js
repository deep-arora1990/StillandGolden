// Marketing consent on the enquiry forms, and the /offers email sign-up
// (Deep, 6 Oct 2026). Before this the homepage enquiry form added every
// enquirer to the list subscribed, without asking — the same fault fixed for
// bookings on 7 Sep. The rules are the ones in lib/resend-contacts.js: only an
// explicit tick subscribes; silence never changes an existing contact.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let calls
function stubResend({ contactStatus = 200 } = {}) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    url = String(url)
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, method: init.method || 'GET', body })
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes('/contacts')) return contactStatus === 200 ? json({ id: 'c1' }) : json({ message: 'boom' }, contactStatus)
    if (url.includes('/emails')) return json({ id: 'e1' })
    return json({})
  }))
}
const emails = () => calls.filter((c) => c.url.endsWith('/emails')).map((c) => c.body)
const contactCreate = () => calls.find((c) => c.url.includes('/audiences/') && c.method === 'POST')
const post = (body) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) })

async function load(mod) {
  vi.resetModules()
  process.env.RESEND_API_KEY = 're_test'
  return (await import(mod)).handler
}

const enquiry = { first_name: 'Mary', last_name: 'Jane', email: 'mary@example.com', phone: '', session_type: 'golden', preferred_date: '', message: '' }

describe('enquiry form: marketing consent', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a ticked box subscribes the enquirer', async () => {
    stubResend()
    const handler = await load('../../submit-enquiry.js')
    const res = await handler(post({ ...enquiry, marketing_consent: true }))
    expect(res.statusCode).toBe(200)
    expect(contactCreate().body.unsubscribed).toBe(false)
  })

  it('an unticked box still saves the contact, but unsubscribed', async () => {
    stubResend()
    const handler = await load('../../submit-enquiry.js')
    await handler(post({ ...enquiry, marketing_consent: false }))
    expect(contactCreate().body.unsubscribed).toBe(true)
  })

  it('a missing box (old cached page) is not consent', async () => {
    stubResend()
    const handler = await load('../../submit-enquiry.js')
    await handler(post({ ...enquiry }))
    expect(contactCreate().body.unsubscribed).toBe(true)
  })

  it('only a real true counts — "false" as a string is not a tick', async () => {
    stubResend()
    const handler = await load('../../submit-enquiry.js')
    await handler(post({ ...enquiry, marketing_consent: 'false' }))
    expect(contactCreate().body.unsubscribed).toBe(true)
  })

  it('the notification says whether they opted in', async () => {
    stubResend()
    const handler = await load('../../submit-enquiry.js')
    await handler(post({ ...enquiry, marketing_consent: true }))
    const note = emails().find((e) => e.to === 'hello@stillandgolden.com.au' || (Array.isArray(e.to) && e.to.includes('hello@stillandgolden.com.au')))
    expect(note.text).toMatch(/Marketing emails: yes/)
  })

  it('a list failure does not fail an enquiry that was delivered', async () => {
    stubResend({ contactStatus: 500 })
    const handler = await load('../../submit-enquiry.js')
    const res = await handler(post({ ...enquiry, marketing_consent: true }))
    expect(res.statusCode).toBe(200)
  })
})

describe('enquiry from the booking page ("dates don\'t suit")', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is flagged as coming from the booking page and names the offer', async () => {
    stubResend()
    const handler = await load('../../submit-enquiry.js')
    const res = await handler(post({ ...enquiry, session_type: 'sunset-beach-minis', preferred_date: 'any Friday in November', source: 'book' }))
    expect(res.statusCode).toBe(200)
    const note = emails().find((e) => /enquiry/i.test(e.subject || ''))
    expect(note.subject).toMatch(/booking page/i)
    expect(note.subject).toMatch(/Sunset beach mini/)
    expect(note.text).toMatch(/Dates that would suit: any Friday in November/)
  })
})

describe('/offers email sign-up', () => {
  afterEach(() => vi.unstubAllGlobals())
  const signup = { first_name: 'Mary', email: 'mary@example.com', source: 'offers' }

  it('subscribes, welcomes the subscriber and tells Deep', async () => {
    stubResend()
    const handler = await load('../../submit-signup.js')
    const res = await handler(post(signup))
    expect(res.statusCode).toBe(200)
    expect(contactCreate().body).toMatchObject({ email: 'mary@example.com', unsubscribed: false })
    const sent = emails()
    expect(sent.some((e) => [].concat(e.to).includes('mary@example.com'))).toBe(true)
    const note = sent.find((e) => [].concat(e.to).includes('hello@stillandgolden.com.au'))
    expect(note.subject).toMatch(/sign-up/i)
    expect(note.text).toMatch(/mary@example\.com/)
  })

  it('the welcome email carries a working unsubscribe link', async () => {
    stubResend()
    const handler = await load('../../submit-signup.js')
    await handler(post(signup))
    const welcome = emails().find((e) => [].concat(e.to).includes('mary@example.com'))
    expect(welcome.html).toContain('https://stillandgolden.com.au/unsubscribe?e=mary%40example.com')
  })

  it('rejects a missing or malformed email without touching the list', async () => {
    stubResend()
    const handler = await load('../../submit-signup.js')
    for (const email of ['', 'not-an-email']) {
      const res = await handler(post({ ...signup, email }))
      expect(res.statusCode).toBe(400)
    }
    expect(calls).toHaveLength(0)
  })

  it('quietly accepts a bot (honeypot filled) and sends nothing', async () => {
    stubResend()
    const handler = await load('../../submit-signup.js')
    const res = await handler(post({ ...signup, 'bot-field': 'x' }))
    expect(res.statusCode).toBe(200)
    expect(calls).toHaveLength(0)
  })

  it('reports failure if the list itself refuses — the sign-up is the whole point', async () => {
    stubResend({ contactStatus: 500 })
    const handler = await load('../../submit-signup.js')
    const res = await handler(post(signup))
    expect(res.statusCode).toBe(500)
  })
})
