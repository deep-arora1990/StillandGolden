// The coach's audit, first two weeks (Deep, 17 Oct 2026): ask every enquirer
// their suburb and what made them get in touch, so where clients come from and
// why they choose Still & Golden are known rather than guessed. And sell
// Gathered on the full gallery, not on thirty extra minutes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

let calls
function stubResend() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null })
    return new Response(JSON.stringify({ id: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}
const toDeep = () => calls.filter((c) => c.url.endsWith('/emails')).map((c) => c.body).find((m) => m.to === 'hello@stillandgolden.com.au' || (Array.isArray(m.to) && m.to.includes('hello@stillandgolden.com.au')))
const post = (body) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) })
async function handler() {
  vi.resetModules()
  process.env.RESEND_API_KEY = 're_test'
  return (await import('../../submit-enquiry.js')).handler
}
const enquiry = { first_name: 'Mary', last_name: 'Jane', email: 'mary@example.com', session_type: 'gathered' }

afterEach(() => { vi.unstubAllGlobals(); delete process.env.RESEND_API_KEY })

describe('enquiry form: suburb and what made them get in touch', () => {
  it('the homepage form asks both, and sends them', () => {
    const page = read('index.html')
    expect(page).toMatch(/<input[^>]*name="suburb"/)
    expect(page).toMatch(/<textarea[^>]*name="reason"/)
    expect(page).toMatch(/suburb: document\.getElementById\('[a-z]+'\)\.value\.trim\(\)/)
    expect(page).toMatch(/reason: document\.getElementById\('[a-z]+'\)\.value\.trim\(\)/)
  })

  it('both are optional: an enquiry without them still goes through', async () => {
    stubResend()
    const res = await (await handler())(post(enquiry))
    expect(res.statusCode).toBe(200)
    expect(toDeep().text).not.toMatch(/Suburb:|got in touch/)
  }, 10000)

  it('reach Deep in the enquiry email', async () => {
    stubResend()
    await (await handler())(post({ ...enquiry, suburb: 'Clyde North', reason: 'Saw your reel about the toddler who would not sit still' }))
    expect(toDeep().text).toMatch(/Suburb: Clyde North/)
    expect(toDeep().text).toMatch(/What made them get in touch: Saw your reel/)
  }, 10000)
})

describe('Gathered is sold on the full gallery', () => {
  it('everywhere a session is chosen', () => {
    const { TIERS } = require('../setmore.js')
    expect(TIERS.gathered.includes).toMatch(/full gallery/i)
    expect(read('netlify/functions/submit-enquiry.js')).toMatch(/gathered: 'Gathered — 90 min, full gallery/)
    expect(read('index.html')).toMatch(/<option value="gathered">Gathered &mdash; 90 min, full gallery/)
    expect(read('packages.html')).toMatch(/pkg-name">Gathered<\/span><span class="pkg-tag">90 minutes &middot; full gallery/)

    // The full gallery averages 60+ images (Deep, 17 Oct 2026). The contract
    // keeps its guaranteed minimum of 30 or more.
    expect(TIERS.gathered.includes).toMatch(/usually 60\+/)
    expect(read('index.html')).toMatch(/full gallery \(usually 60\+ images\)/)
  })

  it('shows what the full gallery costs on the smaller sessions', () => {
    for (const f of ['packages.html', 'packages/gathered-newborn-photography.html']) {
      expect(read(f)).toContain('{{price.golden.withgallery}}')
    }
  })
})

// Enquiries tracker (23 Oct 2026): after its emails have gone and the contact
// is saved, each enquiry is posted to Studio. Studio being down changes
// nothing the enquirer sees.
describe('the enquiry reaches Studio after its emails', () => {
  const STUDIO = 'https://studio.example/.netlify/functions/enquiry-intake'
  const mia = { first_name: 'Mia', last_name: 'Example', email: 'mia@example.com', phone: '0400 000 000', session_type: 'golden',
    preferred_date: 'Any Saturday', message: 'Hi', suburb: ' Clyde North ', reason: 'A reel', marketing_consent: true }

  function stubWithStudio(studio) {
    calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      url = String(url)
      calls.push({ url, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null })
      if (url === STUDIO) return studio()
      return new Response(JSON.stringify({ id: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
  }
  const okStudio = () => new Response(JSON.stringify({ ok: true, id: 1, created: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  const toStudio = () => calls.filter((c) => c.url === STUDIO)
  const emailsSent = () => calls.filter((c) => c.url.endsWith('/emails'))

  beforeEach(() => {
    process.env.STUDIO_ENQUIRY_INGEST_URL = STUDIO
    process.env.ENQUIRY_INGEST_SECRET = 'enquiry-secret-test'
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.STUDIO_ENQUIRY_INGEST_URL
    delete process.env.ENQUIRY_INGEST_SECRET
  })

  it('posts the form fields Studio reads, last, after both emails and the contact', async () => {
    stubWithStudio(okStudio)
    const res = await (await handler())(post({ ...mia, ad: 'google' }))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ success: true })
    expect(emailsSent()).toHaveLength(2)
    expect(toStudio()).toHaveLength(1)
    expect(calls[calls.length - 1].url).toBe(STUDIO)
    expect(calls.findIndex((c) => c.url.includes('/contacts'))).toBeLessThan(calls.findIndex((c) => c.url === STUDIO))
    expect(toStudio()[0].headers['x-ingest-secret']).toBe('enquiry-secret-test')
    expect(toStudio()[0].body).toEqual({
      first_name: 'Mia', last_name: 'Example', email: 'mia@example.com', phone: '0400 000 000', session_type: 'golden',
      preferred_date: 'Any Saturday', message: 'Hi', suburb: 'Clyde North', reason: 'A reel', ad: 'google',
    })
  }, 10000)

  it('says when it came from the booking page, and only passes a known ad', async () => {
    stubWithStudio(okStudio)
    await (await handler())(post({ ...mia, source: 'book', ad: 'tiktok' }))
    expect(toStudio()[0].body).toMatchObject({ source: 'book', ad: null })
    stubWithStudio(okStudio)
    await (await handler())(post({ ...mia, source: 'homepage' }))
    expect(toStudio()[0].body.source).toBeUndefined()
    expect(toStudio()[0].body.ad).toBe(null)
    expect(toStudio()[0].body).not.toHaveProperty('marketing_consent')
    stubWithStudio(okStudio)
    await (await handler())(post({ ...mia, ad: 'fb_link' }))
    expect(toStudio()[0].body.ad).toBe('fb_link')
  }, 10000)

  it('with Studio unreachable, the enquirer still gets a success and both emails go', async () => {
    stubWithStudio(() => { throw new Error('getaddrinfo ENOTFOUND studio.example') })
    const res = await (await handler())(post(mia))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ success: true })
    expect(emailsSent()).toHaveLength(2)
    expect(toStudio()).toHaveLength(1)
  }, 10000)

  it('with Studio refusing it, the response is unchanged', async () => {
    stubWithStudio(() => new Response('Unauthorized', { status: 401 }))
    const res = await (await handler())(post(mia))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ success: true })
  }, 10000)

  it('the honeypot path never reaches Studio', async () => {
    stubWithStudio(okStudio)
    const res = await (await handler())(post({ ...mia, 'bot-field': 'http://spam.example' }))
    expect(res.statusCode).toBe(200)
    expect(toStudio()).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('both forms send the visit\'s ad source', () => {
    expect(read('index.html')).toMatch(/ad: window\.sgAd \? window\.sgAd\(\) : null,/)
    const book = read('book.html')
    const alt = book.slice(book.indexOf("api('submit-enquiry'"))
    expect(alt.slice(0, alt.indexOf('}),'))).toMatch(/ad: window\.sgAd \? window\.sgAd\(\) : null,/)
  })
})
