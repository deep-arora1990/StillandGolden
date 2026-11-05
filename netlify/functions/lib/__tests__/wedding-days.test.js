// Stage 2, Task 5: a wedding day is exclusive. A booked wedding closes the
// whole day for every package, any booking at all closes the day for a
// wedding, and the wedding calendar is reached only through a valid link.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'
import { stubSetmore } from './helpers/setmore-stub.js'
import { createRequire } from 'node:module'

// The functions `require` each other through Node's own module cache, which
// vi.resetModules() leaves alone. Mock mode is read when setmore.js loads, so
// the mock test clears that cache to load the functions with it switched on.
const nodeRequire = createRequire(import.meta.url)
const clearFunctionsCache = () => {
  for (const k of Object.keys(nodeRequire.cache)) if (k.includes('/netlify/functions/')) delete nodeRequire.cache[k]
}

let TIERS
let t
let blobs

async function fresh(mod) {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test'
  delete process.env.SETMORE_MOCK
  return await import(mod)
}

async function call(fn, qs) {
  const { handler } = await fresh(`../../${fn}.js`)
  const res = await handler({ httpMethod: 'GET', queryStringParameters: qs })
  return { status: res.statusCode, body: JSON.parse(res.body) }
}
const availability = async (qs) => (await call('booking-availability', qs)).body
const month = (key, y, m, tok) => availability({ service_key: TIERS[key].serviceKey, year: String(y), month: String(m), ...(tok ? { t: tok } : {}) })
const slots = async (key, date, tok) => (await call('booking-slots', { service_key: TIERS[key].serviceKey, date, ...(tok ? { t: tok } : {}) })).body
const setmoreCalls = (s) => s.calls.filter((c) => c.url.includes('setmore.com'))

beforeAll(async () => { ({ TIERS } = await import('../setmore.js')) })

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-05T01:00:00Z')) // 12pm, 5 Nov 2026 in Melbourne
  blobs = installFreshBlobs()
  delete globalThis.__sgClosedDatesMemo
  process.env.BOOKING_LINK_SECRET = 'test-link-secret-0123456789'
  const W = await fresh('../weddings.js')
  t = W.mintWeddingLink({ firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' }, { now: Date.now() }).token
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  removeBlobs()
  delete process.env.BOOKING_LINK_SECRET
  delete process.env.SETMORE_MOCK
  delete process.env.SETMORE_MOCK_WEDDING
})

describe('a wedding day is exclusive', () => {
  it('a wedding month lists every free day, any weekday, from one calendar read', async () => {
    const s = stubSetmore({ slots: [], appointments: [{ service_key: TIERS.golden.serviceKey, start_time: '2027-03-06T09:00', end_time: '2027-03-06T10:00' }] })
    const dates = (await month('wedding-short', 2027, 3, t)).availableDates
    expect(dates).toHaveLength(30); expect(dates).toContain('2027-03-02'); expect(dates).not.toContain('2027-03-06')
    expect(s.calls.filter((c) => c.url.includes('/slots'))).toHaveLength(0)
    expect(s.calls.filter((c) => c.url.includes('/bookingapi/appointments?'))).toHaveLength(1)
  })

  it('wedding availability needs the link', async () => {
    const W = await fresh('../weddings.js')
    const L = await fresh('../booking-links.js')
    const expired = W.mintWeddingLink({ firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' }, { now: Date.now() - 31 * 86400000 }).token
    const [data, sig] = t.split('.')
    const tampered = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data, 'base64').toString()), e: 'x@example.com' })).toString('base64url')}.${sig}`
    const terms = L.sign({ a: 'a1', s: 'golden', d: '2027-03-20' }, Date.now())
    const s = stubSetmore()
    for (const bad of [undefined, expired, tampered, terms]) {
      for (const key of ['wedding-short', 'wedding-full']) {
        const qs = { service_key: TIERS[key].serviceKey, ...(bad ? { t: bad } : {}) }
        const m = await call('booking-availability', { ...qs, year: '2027', month: '3' })
        expect(m.status).toBe(403); expect(m.body.error.code).toBe('LINK_INVALID')
        const d = await call('booking-slots', { ...qs, date: '2027-03-20' })
        expect(d.status).toBe(403); expect(d.body.error.code).toBe('LINK_INVALID')
      }
    }
    expect(setmoreCalls(s)).toHaveLength(0)
  })

  it('a cached wedding month is never served without the link', async () => {
    await blobs('availability').setJSON(`${TIERS['wedding-short'].serviceKey}/2027-03`, { availableDates: ['2027-03-20'], fetchedAt: Date.now() })
    stubSetmore()
    const m = await call('booking-availability', { service_key: TIERS['wedding-short'].serviceKey, year: '2027', month: '3' })
    expect(m.status).toBe(403)
    expect(m.body.availableDates).toBeUndefined()
    expect((await month('wedding-short', 2027, 3, t)).availableDates).toEqual(['2027-03-20'])
  })

  it('weddings reach 36 months ahead and start tomorrow', async () => {
    stubSetmore()
    const last = (await month('wedding-full', 2029, 11, t)).availableDates
    expect(last.length).toBeGreaterThan(0); expect(last.at(-1)).toBe('2029-11-30')

    const s = stubSetmore()
    expect((await month('wedding-full', 2029, 12, t)).availableDates).toEqual([])
    expect(setmoreCalls(s)).toHaveLength(0)

    stubSetmore()
    const now = (await month('wedding-full', 2026, 11, t)).availableDates
    expect(now[0]).toBe('2026-11-06')

    stubSetmore()
    const dec = (await month('wedding-full', 2026, 12, t)).availableDates
    expect(dec).toContain('2026-12-10')
    expect(dec.filter((d) => d >= '2026-12-11')).toEqual([])   // the summer break (closed-dates seed)
  })

  it('a wedding closes the whole day for every package', async () => {
    stubSetmore({ slots: ['5:00 PM'], appointments: [{ service_key: TIERS['wedding-full'].serviceKey, start_time: '2027-03-06T10:00', end_time: '2027-03-06T16:00' }] })
    expect((await month('golden', 2027, 3)).availableDates).not.toContain('2027-03-06')
    expect((await month('golden', 2027, 3)).availableDates).toContain('2027-03-13')
    for (const k of ['golden', 'sunset-beach-minis']) expect((await slots(k, '2027-03-06')).slots).toEqual([])
  })

  it('a wedding closes the day on a fixed-schedule package too, inside its window', async () => {
    const tier = TIERS['sunset-beach-minis']
    const day = tier.allowedDates.find((d) => d > '2027-01-20')
    stubSetmore({ appointments: [{ service_key: TIERS['wedding-short'].serviceKey, start_time: `${day}T10:00`, end_time: `${day}T13:00` }] })
    expect((await slots('sunset-beach-minis', day)).slots).toEqual([])
    stubSetmore()
    expect((await slots('sunset-beach-minis', day)).slots).toEqual(['18:30'])
  })

  it('the two wedding packages block each other', async () => {
    stubSetmore({ appointments: [{ service_key: TIERS['wedding-short'].serviceKey, start_time: '2027-03-06T10:00' }] })
    expect((await slots('wedding-full', '2027-03-06', t)).slots).toEqual([])
    expect((await month('wedding-full', 2027, 3, t)).availableDates).not.toContain('2027-03-06')
  })

  it('a late-evening booking stays on its own date', async () => {
    stubSetmore({ appointments: [{ service_key: TIERS.golden.serviceKey, start_time: '2027-03-06T23:30Z' }] })
    const dates = (await month('wedding-short', 2027, 3, t)).availableDates
    expect(dates).not.toContain('2027-03-06'); expect(dates).toContain('2027-03-07')
  })

  it('a free wedding day: the silent placeholder, and the 4-week split when 5+ weeks out', async () => {
    stubSetmore()
    expect(await slots('wedding-short', '2027-03-20', t)).toEqual({ slots: ['10:00'], split: { available: true, depositCents: 35000, balanceCents: 35000, chargeOn: '2026-12-03' } })
    expect((await slots('wedding-short', '2026-12-03', t)).split).toEqual({ available: false })
  })

  it('wedding slots refuse a date outside the wedding window, or one that does not exist', async () => {
    const s = stubSetmore()
    for (const date of ['2026-11-05', '2029-12-01', '2027-02-31']) {
      const r = await call('booking-slots', { service_key: TIERS['wedding-short'].serviceKey, date, t })
      expect(r.status).toBe(400)
      expect(r.body.error.message).toBeTruthy()
    }
    expect(setmoreCalls(s)).toHaveLength(0)
  })

  it('a family month that cannot read the calendar is busy, not open', async () => {
    const s = stubSetmore({ failAppointments: true })
    const r = await call('booking-availability', { service_key: TIERS.golden.serviceKey, year: '2027', month: '3' })
    expect(r.status).toBe(503)
    expect(r.body.error.code).toBe('SETMORE_BUSY')
    expect(s.calls.filter((c) => c.url.includes('/slots'))).toHaveLength(0)
    const w = await call('booking-availability', { service_key: TIERS['wedding-short'].serviceKey, year: '2027', month: '3', t })
    expect(w.status).toBe(503)
  })

  it('a family day view that cannot read the calendar fails rather than offering times', async () => {
    stubSetmore({ failAppointments: true })
    const r = await call('booking-slots', { service_key: TIERS.golden.serviceKey, date: '2027-03-06' })
    expect(r.status).toBe(502)
  })

  it('the local mock can show a wedding day', async () => {
    const network = vi.fn(async () => { throw new Error('no network in mock mode') })
    vi.stubGlobal('fetch', network)
    process.env.SETMORE_MOCK = '1'
    process.env.SETMORE_MOCK_WEDDING = '2027-03-06'
    clearFunctionsCache()
    try {
      const S = nodeRequire('../setmore.js')
      expect(S.MOCK).toBe(true)
      expect(await S.getFixedScheduleSlots(S.TIERS.golden, '2027-03-06')).toEqual([])
      expect(await S.getFixedScheduleSlots(S.TIERS['wedding-full'], '2027-03-06')).toEqual([])
      expect(await S.getFixedScheduleSlots(S.TIERS['wedding-full'], '2027-03-13')).toEqual(['10:00'])
      expect(await S.isDayOpen(S.TIERS.golden, '2027-03-06')).toBe(false)
      const { handler } = nodeRequire('../../booking-slots.js')
      const day = async (date) => JSON.parse((await handler({ httpMethod: 'GET', queryStringParameters: { service_key: S.TIERS.golden.serviceKey, date } })).body)
      expect((await day('2027-03-06')).slots).toEqual([])
      expect((await day('2027-03-13')).slots.length).toBeGreaterThan(0)
      expect(network).not.toHaveBeenCalled()
    } finally {
      delete process.env.SETMORE_MOCK
      clearFunctionsCache()
    }
  })
})

describe('the wedding date must be a real date', () => {
  it('rejects impossible calendar dates with a clear message', async () => {
    const W = await fresh('../weddings.js')
    for (const d of ['2027-02-31', '2027-13-01', '2027-04-31', '2027-00-10', '2027-02-29']) {
      expect(W.weddingDateProblem(d, '2026-11-05')).toMatch(/real date/i)
    }
    expect(W.weddingDateProblem('2028-02-29', '2026-11-05')).toBeNull()   // a leap day is real
  })
})
