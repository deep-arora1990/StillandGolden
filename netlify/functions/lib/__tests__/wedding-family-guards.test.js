// Final-review fixes: the family questionnaire and agreement refuse wedding links.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)
let calls
let L
function clear() { for (const k of Object.keys(nodeRequire.cache)) if (k.includes('/netlify/functions/')) delete nodeRequire.cache[k] }
const post = (body) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) })
const tok = (over = {}) => L.sign({ a: 'appt9', f: 'Sam', l: 'Lee', e: 'sam@example.com', s: 'golden', d: '2027-03-06', h: '', ...over })

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_test'
  process.env.BOOKING_LINK_SECRET = 'link-secret-test'
  process.env.STUDIO_BOOKING_INGEST_URL = 'https://studio.example/ingest'
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => { calls.push(String(url)); return new Response('{}', { status: 200 }) }))
  vi.resetModules(); clear()
  L = nodeRequire('../booking-links.js')
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['RESEND_API_KEY', 'BOOKING_LINK_SECRET', 'STUDIO_BOOKING_INGEST_URL']) delete process.env[k]
})

describe('family questionnaire', () => {
  it('refuses a wedding token before sending anything', async () => {
    const { handler } = nodeRequire('../../submit-questionnaire.js')
    const res = await handler(post({ names: 'Sam Lee', email: 'sam@example.com', token: tok({ s: 'wedding-full' }) }))
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe("This link is for your wedding questionnaire. Reply to my email and I'll send you the right one.")
    expect(calls).toEqual([])
  })
})

describe('family agreement', () => {
  it('refuses a typed wedding even when a family token has an empty s', async () => {
    const { handler } = nodeRequire('../../submit-contract.js')
    const res = await handler(post({ token: tok({ s: '' }), sessionType: 'wedding-full', firstName: 'A', lastName: 'B', email: 'a@b.co', agreementDate: '2026-11-10' }))
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toContain('Weddings have their own agreement')
    expect(calls).toEqual([])
  })
})
