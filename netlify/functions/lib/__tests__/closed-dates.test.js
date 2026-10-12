// Closed dates managed from Studio (12 Oct 2026). Deep adds a break in Studio,
// Studio sends the whole list here, and every booking route honours it — no
// code change per break. Until Studio first sends a list, the summer break
// written in code still holds.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

const SECRET = 'ingest-secret-test'
const reply = (body, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })
async function fresh(mod) {
  process.env.SETMORE_API_KEY = 'test'
  delete process.env.SETMORE_MOCK
  return await import(mod)
}
function stubOpenSetmore() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    url = String(url)
    if (url.includes('/o/oauth2/token')) return reply({ response: true, data: { token: { access_token: 't', expires_in: 3600 } } })
    if (url.includes('/staffs')) return reply({ response: true, data: { staffs: [{ key: 's' }] } })
    if (url.includes('/slots')) return reply({ response: true, data: { slots: ['10:00 AM', '11:00 AM'] } })
    if (url.includes('/appointments')) return reply({ response: true, data: { appointments: [] } })
    return reply({ response: true, data: {} })
  }))
}
const post = (body, headers = { 'x-ingest-secret': SECRET }) => ({ httpMethod: 'POST', headers, body: JSON.stringify(body) })

async function send(ranges) {
  const { handler } = await fresh('../../closed-dates.js')
  return handler(post({ ranges }))
}
async function daySlots(tierKey, date) {
  const { TIERS } = await fresh('../setmore.js')
  const { handler } = await fresh('../../booking-slots.js')
  const res = await handler({ httpMethod: 'GET', queryStringParameters: { service_key: TIERS[tierKey].serviceKey, date } })
  return JSON.parse(res.body).slots
}
async function monthDates(tierKey, year, month) {
  const { TIERS } = await fresh('../setmore.js')
  const { handler } = await fresh('../../booking-availability.js')
  const res = await handler({ httpMethod: 'GET', queryStringParameters: { service_key: TIERS[tierKey].serviceKey, year: String(year), month: String(month) } })
  return JSON.parse(res.body).availableDates
}
async function checkout(date) {
  const { TIERS } = await fresh('../setmore.js')
  const { handler } = await fresh('../../booking-checkout.js')
  return handler({ httpMethod: 'POST', headers: { origin: 'https://stillandgolden.com.au' },
    body: JSON.stringify({ service_key: TIERS.golden.serviceKey, date, time: '10:00', firstName: 'A', lastName: 'B', email: 'a@example.com' }) })
}

let blobs
beforeEach(() => {
  vi.resetModules()
  blobs = installFreshBlobs()
  delete globalThis.__sgClosedDatesMemo
  process.env.BOOKING_INGEST_SECRET = SECRET
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); removeBlobs()
  delete process.env.BOOKING_INGEST_SECRET
})

describe('the list Studio sends', () => {
  it('replaces the summer break written in code', async () => {
    stubOpenSetmore()
    expect(await daySlots('golden', '2027-01-09')).toEqual([])
    expect((await send([{ from: '2027-03-01', to: '2027-03-05' }])).statusCode).toBe(200)
    expect(await daySlots('golden', '2027-01-09')).toEqual(['10:00', '11:00'])
    expect(await daySlots('golden', '2027-03-03')).toEqual([])
    expect(await daySlots('christmas-minis', '2027-03-01')).toEqual([])
  })

  it('an empty list reopens everything — it is not "no list yet"', async () => {
    stubOpenSetmore()
    await send([])
    expect(await daySlots('golden', '2026-12-12')).toEqual(['10:00', '11:00'])
  })

  it('the month view and checkout honour it too', async () => {
    stubOpenSetmore()
    await send([{ from: '2027-03-01', to: '2027-03-05' }])
    const march = await monthDates('golden', 2027, 3)
    expect(march.filter((d) => d <= '2027-03-05')).toEqual([])
    expect(march).toContain('2027-03-06')
    const res = await checkout('2027-03-03')
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.message).toMatch(/not taking bookings/i)
  })

  it('a month cached before the break was added still hides it', async () => {
    stubOpenSetmore()
    await send([])
    expect(await monthDates('golden', 2027, 3)).toContain('2027-03-03')
    // Written straight to the store, as another instance would — no cache clear.
    await blobs('closed-dates').setJSON('ranges', { ranges: [{ from: '2027-03-01', to: '2027-03-05' }] })
    vi.setSystemTime(new Date('2026-10-12T00:02:00Z'))
    expect(await monthDates('golden', 2027, 3)).not.toContain('2027-03-03')
  })

  it('clears cached availability, so a reopened day shows straight away', async () => {
    const { writeMonth, readMonth } = await fresh('../availability-cache.js')
    await writeMonth('svc', 2027, 1, ['2027-01-23'])
    await send([])
    expect(await readMonth('svc', 2027, 1)).toBeNull()
  })
})

describe('the endpoint', () => {
  it('refuses without the shared secret, and when none is configured', async () => {
    const { handler } = await fresh('../../closed-dates.js')
    expect((await handler(post({ ranges: [] }, { 'x-ingest-secret': 'wrong' }))).statusCode).toBe(401)
    delete process.env.BOOKING_INGEST_SECRET
    expect((await handler(post({ ranges: [] }, { 'x-ingest-secret': '' }))).statusCode).toBe(401)
    expect(await blobs('closed-dates').get('ranges', { type: 'json' })).toBeNull()
  })

  it('rejects the whole list if any range is bad, and keeps the old one', async () => {
    await send([{ from: '2027-03-01', to: '2027-03-05' }])
    for (const bad of [
      [{ from: '2027-03-09', to: '2027-03-01' }],
      [{ from: '2027-02-30', to: '2027-03-01' }],
      [{ from: '1/3/2027', to: '2027-03-01' }],
      'not a list',
    ]) {
      expect((await send(bad)).statusCode).toBe(400)
    }
    expect((await blobs('closed-dates').get('ranges', { type: 'json' })).ranges).toEqual([{ from: '2027-03-01', to: '2027-03-05' }])
  })
})

describe('when the list cannot be read', () => {
  function breakStore() {
    const inner = globalThis.__sgStoreFactory
    globalThis.__sgStoreFactory = (name, o) => name === 'closed-dates'
      ? { async get() { throw new Error('blobs down') }, async setJSON() { throw new Error('blobs down') } }
      : inner(name, o)
  }

  it('checkout refuses rather than risk selling a closed day', async () => {
    breakStore()
    const res = await checkout('2027-03-03')
    expect(res.statusCode).toBe(503)
  })

  it('the calendar still shows, with the summer break kept closed', async () => {
    stubOpenSetmore()
    breakStore()
    expect(await daySlots('golden', '2026-12-12')).toEqual([])
    expect(await daySlots('golden', '2027-03-03')).toEqual(['10:00', '11:00'])
  })
})
