// Stage 2, Task 4: the private signed wedding link.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'

const ROOT = require('node:path').resolve(__dirname, '../../../..')
const NOW = Date.UTC(2026, 10, 5, 1) // 5 Nov 2026, 12pm in Melbourne
const COUPLE = { firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' }

async function fresh(mod) {
  vi.resetModules()
  return await import(mod)
}

beforeEach(() => {
  process.env.BOOKING_LINK_SECRET = 'test-link-secret-0123456789'
  process.env.BOOKING_INGEST_SECRET = 'ingest-secret-test'
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['BOOKING_LINK_SECRET', 'BOOKING_INGEST_SECRET']) delete process.env[k]
})

describe('wedding link', () => {
  it('a wedding link carries the couple and lasts 30 days', async () => {
    const W = await fresh('../weddings.js')
    const { token, url, expiresAt } = W.mintWeddingLink(COUPLE, { now: NOW })
    expect(url).toBe(`https://stillandgolden.com.au/book-wedding?t=${encodeURIComponent(token)}`)
    expect(expiresAt).toBe('2026-12-05')
    expect(W.verifyWeddingLink(token, NOW + 29 * 86400000)).toMatchObject(COUPLE)
    expect(W.verifyWeddingLink(token, NOW + 31 * 86400000)).toBeNull()
  })

  it('a tampered link, or a family terms link, is not a wedding link, and a wedding link is not a terms link', async () => {
    const W = await fresh('../weddings.js'); const L = await fresh('../booking-links.js')
    const { token } = W.mintWeddingLink(COUPLE, { now: NOW })
    const [data, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data, 'base64').toString()), e: 'x@example.com' })).toString('base64url')
    expect(W.verifyWeddingLink(`${forged}.${sig}`, NOW)).toBeNull()
    expect(W.verifyWeddingLink(L.sign({ a: 'a1', s: 'golden', d: '2026-11-21' }, NOW), NOW)).toBeNull()
    expect(L.verify(token, NOW)).toBeNull()
  })

  it('garbage tokens return null rather than throwing', async () => {
    const W = await fresh('../weddings.js')
    for (const t of ['abc', '', 'a.b.c', '.', undefined, null, 42, 'x'.repeat(3000)]) {
      expect(W.verifyWeddingLink(t, NOW)).toBeNull()
    }
  })

  it('the wedding date window: after today, up to the end of the 36th month', async () => {
    const W = await fresh('../weddings.js')
    expect(W.lastWeddingDate('2026-11-05')).toBe('2029-11-30')
    expect(W.weddingDateProblem('2029-11-30', '2026-11-05')).toBeNull()
    expect(W.weddingDateProblem('2029-12-01', '2026-11-05')).toMatch(/further out/i)
    expect(W.weddingDateProblem('2026-11-05', '2026-11-05')).toMatch(/after today/i)
  })
})

describe('wedding endpoints', () => {
  it('wedding-link-check: the couple and both packages for a good link, 403 otherwise', async () => {
    const W = await fresh('../weddings.js')
    const { TIERS } = await fresh('../setmore.js')
    const { handler } = await fresh('../../wedding-link-check.js')
    const { token } = W.mintWeddingLink(COUPLE, { now: Date.now() })
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { t: token } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toMatchObject({ firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', monthsAhead: 36 })
    expect(body.packages).toEqual([
      { tier: 'wedding-short', name: 'Short & sweet', lengthLabel: '3 hours', priceCents: 70000, serviceKey: TIERS['wedding-short'].serviceKey },
      { tier: 'wedding-full', name: 'The whole shebang', lengthLabel: '6 hours', priceCents: 100000, serviceKey: TIERS['wedding-full'].serviceKey },
    ])
    const old = W.mintWeddingLink(COUPLE, { now: Date.now() - 31 * 86400000 })
    const [data, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data, 'base64').toString()), e: 'x@example.com' })).toString('base64url')
    for (const qs of [{}, null, { t: old.token }, { t: `${forged}.${sig}` }]) {
      const r = await handler({ httpMethod: 'GET', queryStringParameters: qs })
      expect(r.statusCode).toBe(403)
      expect(JSON.parse(r.body).error.code).toBe('LINK_INVALID')
    }
  })

  it('wedding-link-mint: needs the shared secret, sends nothing, returns a link that verifies', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('no network in tests') })
    vi.stubGlobal('fetch', fetchSpy)
    const W = await fresh('../weddings.js')
    const { handler } = await fresh('../../wedding-link-mint.js')
    const post = (body, secret) => handler({ httpMethod: 'POST', headers: secret ? { 'x-ingest-secret': secret } : {}, body: JSON.stringify(body) })
    expect((await post(COUPLE, 'wrong')).statusCode).toBe(401)
    expect((await post(COUPLE)).statusCode).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
    const ok = await post(COUPLE, 'ingest-secret-test')
    expect(ok.statusCode).toBe(200)
    const { url, expiresAt } = JSON.parse(ok.body)
    expect(url.startsWith('https://stillandgolden.com.au/book-wedding?t=')).toBe(true)
    expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const token = decodeURIComponent(url.split('?t=')[1])
    expect(W.verifyWeddingLink(token)).toMatchObject(COUPLE)
    expect((await post({ firstName: 'Sam', lastName: 'Lee' }, 'ingest-secret-test')).statusCode).toBe(400)
    expect((await post({ ...COUPLE, firstName: '' }, 'ingest-secret-test')).statusCode).toBe(400)
    delete process.env.BOOKING_LINK_SECRET
    expect((await post(COUPLE, 'ingest-secret-test')).statusCode).toBe(500)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the local CLI mints a link for netlify dev, and refuses without the secret', () => {
    const run = (env) => execFileSync('node', ['scripts/wedding-link.js', '--first', 'Sam', '--last', 'Lee', '--email', 'sam@example.com', '--base', 'http://localhost:8888'],
      { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    expect(run({ BOOKING_LINK_SECRET: 'local-only' })).toMatch(/^http:\/\/localhost:8888\/book-wedding\?t=\S+/m)
    expect(() => run({ BOOKING_LINK_SECRET: '' })).toThrow(/BOOKING_LINK_SECRET/)
  })
})
