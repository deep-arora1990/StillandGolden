// After a paid booking is written to Setmore, the webhook drops that month's
// saved availability for every package so the taken day stops showing as
// open. The clear itself is tested in availability-cache; this proves a real
// booking actually triggers it, and that it says so in the function log —
// before this (cutover step 9, done 8 Oct 2026) it ran silently.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

const reply = (body, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })

function stubSetmore() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    url = String(url)
    if (url.includes('/o/oauth2/token')) return reply({ response: true, data: { token: { access_token: 't', expires_in: 3600 } } })
    if (url.includes('/staffs')) return reply({ response: true, data: { staffs: [{ key: 's' }] } })
    if (url.includes('/customer/create')) return reply({ response: true, data: { customer: { key: 'c1' } } })
    if (url.includes('/bookingapi/customer')) return reply({ response: true, data: { customer: [] } })
    if (url.includes('/appointment/create')) return reply({ response: true, data: { appointment: { key: 'a1' } } })
    return reply({ response: true, data: {} })
  }))
}

describe('a booking clears its month of saved availability', () => {
  let log
  beforeEach(() => { installFreshBlobs(); log = vi.spyOn(console, 'log').mockImplementation(() => {}) })
  afterEach(() => { vi.unstubAllGlobals(); removeBlobs(); log.mockRestore() })

  it('drops the booked month for every package, keeps other months, and logs it', async () => {
    stubSetmore()
    vi.resetModules()
    process.env.SETMORE_API_KEY = 'test'
    delete process.env.SETMORE_MOCK
    const { TIERS } = await import('../setmore.js')
    const cache = await import('../availability-cache.js')
    await cache.writeMonth(TIERS.golden.serviceKey, 2026, 11, ['2026-11-21'])
    await cache.writeMonth(TIERS.glimpse.serviceKey, 2026, 11, ['2026-11-21'])
    await cache.writeMonth(TIERS.golden.serviceKey, 2026, 12, ['2026-12-05'])

    const { _test } = await import('../../stripe-webhook.js')
    await _test.bookAppointment({ service_key: TIERS.golden.serviceKey, date: '2026-11-21', time: '10:00',
      firstName: 'Mary', lastName: 'Jane', email: 'mary@example.com', phone: '' })

    expect(await cache.readMonth(TIERS.golden.serviceKey, 2026, 11)).toBeNull()
    expect(await cache.readMonth(TIERS.glimpse.serviceKey, 2026, 11)).toBeNull()
    expect(await cache.readMonth(TIERS.golden.serviceKey, 2026, 12)).not.toBeNull()
    expect(log.mock.calls.flat().join('\n')).toMatch(/cleared 2026-11 availability \(2 saved months\) after booking/)
  })
})
