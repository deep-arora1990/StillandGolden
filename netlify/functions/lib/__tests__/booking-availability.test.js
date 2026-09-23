// booking-availability must never show a day as unavailable just because its
// check failed. On 24 Sep 2026 rate-limited probes were treated as "no slots",
// the month was returned with bookable days missing, and the gap was cached for
// 30 minutes — a weekend showed as fully booked to every visitor.
import { describe, it, expect, afterEach, vi } from 'vitest'

const GOLDEN = 'cbad199e-41dd-4572-803b-7f27ae3e2bb3'
const reply = (body, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })

async function freshHandler() {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test-refresh-token'
  delete process.env.SETMORE_MOCK
  return (await import('../../booking-availability.js')).handler
}

// slotsFor(date, attempt) decides each probe's reply.
function stub(slotsFor) {
  const seen = {}
  const calls = { slots: 0 }
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    url = String(url)
    if (url.includes('/o/oauth2/token')) return reply({ response: true, data: { token: { access_token: 'tok', expires_in: 3600 } } })
    if (url.includes('/bookingapi/staffs')) return reply({ response: true, data: { staffs: [{ key: 'staff1' }] } })
    calls.slots++
    const d = JSON.parse(opts.body).selected_date // dd/MM/yyyy — slashes on the website, unlike Studio
    const iso = d.split('/').reverse().join('-')
    seen[iso] = (seen[iso] || 0) + 1
    return slotsFor(iso, seen[iso])
  }))
  return calls
}

const ok = reply({ response: true, data: { slots: ['10:00 AM'] } })
const none = reply({ response: true, data: { slots: [] } })
const ev = { httpMethod: 'GET', queryStringParameters: { service_key: GOLDEN, year: '2027', month: '3' } }

describe('booking-availability failure handling', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns a retryable error, not a month with holes, when Setmore is throttling', async () => {
    const handler = await freshHandler()
    stub((iso) => (iso === '2027-03-06' || iso === '2027-03-07')
      ? reply({ error: 'too_many_requests' }, 429)
      : ok)
    const res = await handler(ev)
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).error.code).toBe('SETMORE_BUSY')
  }, 15000)

  it('does not cache a failed month, so the next visitor gets a fresh answer', async () => {
    const handler = await freshHandler()
    let throttled = true
    const calls = stub(() => (throttled ? reply({ error: 'too_many_requests' }, 429) : ok))
    expect((await handler(ev)).statusCode).toBe(503)

    throttled = false
    const before = calls.slots
    const res = await handler(ev)
    expect(res.statusCode).toBe(200)
    expect(calls.slots).toBeGreaterThan(before) // re-probed, not served from cache
    expect(JSON.parse(res.body).availableDates).toHaveLength(31)
  }, 15000)

  it('stops probing once a systemic failure is seen', async () => {
    const handler = await freshHandler()
    const calls = stub(() => reply({ error: 'too_many_requests' }, 429))
    expect((await handler(ev)).statusCode).toBe(503)
    expect(calls.slots).toBeGreaterThan(0) // really probed
    // First batch of five, each retried once by setmoreFetch — not all 31 days.
    expect(calls.slots).toBeLessThanOrEqual(10)
  }, 15000)

  it('retries an isolated failure instead of dropping the day', async () => {
    const handler = await freshHandler()
    stub((iso, attempt) => (iso === '2027-03-06' && attempt === 1)
      ? reply({ response: false, msg: 'transient' }, 500)
      : iso.endsWith('-07') ? none : ok)
    const res = await handler(ev)
    expect(res.statusCode).toBe(200)
    const dates = JSON.parse(res.body).availableDates
    expect(dates).toContain('2027-03-06')
    expect(dates).not.toContain('2027-03-07') // genuinely empty day stays empty
    expect([...dates].sort()).toEqual(dates) // still in order after the retry
  })

  it('caches a healthy month', async () => {
    const handler = await freshHandler()
    const calls = stub(() => ok)
    const first = await handler(ev)
    expect(first.statusCode).toBe(200)
    expect(calls.slots).toBe(31) // really probed, not short-circuited
    const before = calls.slots
    await handler(ev)
    expect(calls.slots).toBe(before)
  })
})
