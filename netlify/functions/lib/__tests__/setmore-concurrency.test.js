// Setmore call budget under concurrency.
//
// The availability function probes a month one day at a time, five days in
// parallel. On a cold container every probe needs a token and a staff key, and
// until 24 Sep 2026 each probe fetched both itself — five simultaneous token
// exchanges, which Setmore throttles. The throttle then cascaded through the
// retries and later batches, and months took 17–28 seconds before failing.
//
// These tests pin call counts rather than returned data: a regression here is
// invisible until it throttles production.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

const TOKEN_URL = '/o/oauth2/token'

function reply(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } }
}

// The lib reads SETMORE_API_KEY at load and keeps its caches in module scope,
// so each test gets a fresh copy.
async function freshLib() {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test-refresh-token'
  delete process.env.SETMORE_MOCK
  return await import('../setmore.js')
}

function stubSetmore({ tokenReply } = {}) {
  const calls = { token: 0, staffs: 0, slots: 0 }
  const fetchMock = vi.fn(async (url) => {
    url = String(url)
    if (url.includes(TOKEN_URL)) {
      calls.token++
      return tokenReply ? tokenReply(calls.token) : reply({ response: true, data: { token: { access_token: 'tok', expires_in: 3600 } } })
    }
    if (url.includes('/bookingapi/staffs')) {
      calls.staffs++
      return reply({ response: true, data: { staffs: [{ key: 'staff1' }] } })
    }
    calls.slots++
    return reply({ response: true, data: { slots: ['10:00 AM'] } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

describe('Setmore token and staff key under parallel probes', () => {
  beforeEach(() => { installFreshBlobs() })
  afterEach(() => { removeBlobs() })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('shares one token exchange between five parallel probes', async () => {
    const lib = await freshLib()
    const calls = stubSetmore()
    await Promise.all(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']
      .map((d) => lib.getSlots('svc', d)))
    expect(calls.token).toBe(1)
    expect(calls.slots).toBe(5)
  })

  it('shares one staff lookup between five parallel probes', async () => {
    const lib = await freshLib()
    const calls = stubSetmore()
    await Promise.all(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']
      .map((d) => lib.getSlots('svc', d)))
    expect(calls.staffs).toBe(1)
  })

  it('stops asking for a token during the cooldown after a rate-limited exchange', async () => {
    vi.useFakeTimers()
    const lib = await freshLib()
    const calls = stubSetmore({ tokenReply: () => reply({ error: 'too_many_requests' }, 429) })

    // First caller runs the full exchange-with-backoff and fails.
    const first = lib.getSlots('svc', '2026-10-01').catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    const err = await first
    expect(err.code).toBe('RATE_LIMITED')
    const afterFirst = calls.token

    // Within the cooldown, further callers fail fast without touching Setmore.
    const results = await Promise.all(['2026-10-02', '2026-10-03', '2026-10-04']
      .map((d) => lib.getSlots('svc', d).catch((e) => e)))
    for (const r of results) expect(r.code).toBe('RATE_LIMITED')
    expect(calls.token).toBe(afterFirst)
  })

  it('tries again once the cooldown has passed', async () => {
    vi.useFakeTimers()
    const lib = await freshLib()
    let throttled = true
    const calls = stubSetmore({
      tokenReply: () => throttled
        ? reply({ error: 'too_many_requests' }, 429)
        : reply({ response: true, data: { token: { access_token: 'tok', expires_in: 3600 } } }),
    })
    const first = lib.getSlots('svc', '2026-10-01').catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    await first

    throttled = false
    await vi.advanceTimersByTimeAsync(25_000)
    const slots = await lib.getSlots('svc', '2026-10-02')
    expect(slots.length).toBe(1)
  })
})
