// The coach's audit, first two weeks (Deep, 17 Oct 2026): ask every enquirer
// their suburb and what made them get in touch, so where clients come from and
// why they choose Still & Golden are known rather than guessed. And sell
// Gathered on the full gallery, not on thirty extra minutes.
import { describe, it, expect, afterEach, vi } from 'vitest'
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
