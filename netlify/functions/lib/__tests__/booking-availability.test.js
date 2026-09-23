// booking-availability must never show a day as unavailable just because its
// check failed. On 24 Sep 2026 rate-limited probes were treated as "no slots",
// the month was returned with bookable days missing, and the gap was cached for
// 30 minutes — a weekend showed as fully booked to every visitor.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

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
  beforeEach(() => { installFreshBlobs() })
  afterEach(() => { removeBlobs() })
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

describe('booking-availability shared cache', () => {
  let blobs
  beforeEach(() => { blobs = installFreshBlobs() })
  afterEach(() => { vi.unstubAllGlobals(); removeBlobs() })

  const MIN = 60 * 1000
  const seed = (month, minutesAgo, dates = ['2027-03-06']) =>
    blobs('availability').setJSON(`${GOLDEN}/${month}`, { availableDates: dates, fetchedAt: Date.now() - minutesAgo * MIN })

  it('serves a second container from the first one\'s answer, without asking Setmore', async () => {
    const calls = stub(() => ok)
    const a = await freshHandler()
    expect((await a(ev)).statusCode).toBe(200)
    const afterA = calls.slots
    const b = await freshHandler()                       // a different, cold container
    const res = await b(ev)
    expect(res.statusCode).toBe(200)
    expect(calls.slots).toBe(afterA)
    expect(JSON.parse(res.body).availableDates).toHaveLength(31)
  })

  it('keeps a far-off month for longer than a near one', async () => {
    // Both cached 20 minutes ago: stale for a near month (15-minute window),
    // still fresh for a far one (24-hour window).
    const now = new Date()
    const near = { year: now.getFullYear() + (now.getMonth() === 11 ? 1 : 0), month: (now.getMonth() + 1) % 12 + 1 }
    const nearKey = `${near.year}-${String(near.month).padStart(2, '0')}`
    await seed(nearKey, 20)
    await seed('2027-03', 20)
    const calls = stub(() => ok)
    const handler = await freshHandler()

    await handler(ev)                                    // 2027-03: fresh, no probes
    expect(calls.slots).toBe(0)
    await handler({ httpMethod: 'GET', queryStringParameters: { service_key: GOLDEN, year: String(near.year), month: String(near.month) } })
    expect(calls.slots).toBeGreaterThan(0)               // near month: re-checked
  })

  it('serves the last good copy when Setmore is throttling, instead of an error', async () => {
    await seed('2027-03', 48 * 60, ['2027-03-06', '2027-03-07'])   // two days old: stale
    stub(() => reply({ error: 'too_many_requests' }, 429))
    const handler = await freshHandler()
    const res = await handler(ev)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.stale).toBe(true)
    expect(body.availableDates).toEqual(['2027-03-06', '2027-03-07'])
  }, 15000)

  it('still reports busy when throttled and there is no earlier copy at all', async () => {
    stub(() => reply({ error: 'too_many_requests' }, 429))
    const handler = await freshHandler()
    expect((await handler(ev)).statusCode).toBe(503)
  }, 15000)
})
