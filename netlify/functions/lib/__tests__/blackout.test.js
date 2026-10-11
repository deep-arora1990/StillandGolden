// Website-wide closed dates (12 Oct 2026): Deep's break 11 Dec 2026 – 20 Jan
// 2027. Enforced by the website itself, whatever Setmore says — on 12 Oct
// Setmore's API was still offering the January weekends inside the break.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

const reply = (body, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })
async function fresh(mod) {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test'
  delete process.env.SETMORE_MOCK
  return await import(mod)
}
// Setmore offering every day, the way it was for 2, 9 and 16 January.
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

describe('closed dates', () => {
  beforeEach(() => { installFreshBlobs(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T00:00:00Z')) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); removeBlobs() })

  it('covers 11 Dec 2026 to 20 Jan 2027 inclusive, and nothing either side', async () => {
    const { isClosedDate } = await fresh('../setmore.js')
    for (const d of ['2026-12-11', '2026-12-25', '2027-01-02', '2027-01-17', '2027-01-20']) expect(isClosedDate(d)).toBe(true)
    for (const d of ['2026-12-10', '2027-01-21', '2027-01-23']) expect(isClosedDate(d)).toBe(false)
  })

  it('the month calendar offers none of them, even when Setmore does', async () => {
    stubOpenSetmore()
    const { TIERS } = await fresh('../setmore.js')
    const { handler } = await fresh('../../booking-availability.js')
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { service_key: TIERS.golden.serviceKey, year: '2027', month: '1' } })
    const dates = JSON.parse(res.body).availableDates
    expect(dates.filter((d) => d <= '2027-01-20')).toEqual([])
    expect(dates).toContain('2027-01-23')
  })

  it('the day view shows no times, for packages and fixed-schedule offers alike', async () => {
    stubOpenSetmore()
    const { TIERS } = await fresh('../setmore.js')
    const { handler } = await fresh('../../booking-slots.js')
    for (const k of ['golden', 'christmas-minis']) {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { service_key: TIERS[k].serviceKey, date: '2026-12-25' } })
      expect(JSON.parse(res.body).slots).toEqual([])
    }
  })

  it('checkout refuses a closed date before any payment page', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { handler } = await fresh('../../booking-checkout.js')
    const res = await handler({ httpMethod: 'POST', headers: { origin: 'https://stillandgolden.com.au' },
      body: JSON.stringify({ service_key: TIERS.golden.serviceKey, date: '2027-01-09', time: '10:00', firstName: 'A', lastName: 'B', email: 'a@example.com' }) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.message).toMatch(/not taking bookings/i)
  })
})
