// One Setmore token shared by every running copy of the site's functions.
//
// Each Netlify container used to fetch its own token, and a new token appears
// to cancel the last, so containers kept invalidating one another and the
// exchange endpoint throttled the account (24 Sep 2026). These tests stand up
// two independent copies of the lib over one shared store and pin the number
// of token exchanges.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

const reply = (body, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })

// A fresh module graph is a fresh container: its own memory, its own caches.
async function container() {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test-refresh-token'
  delete process.env.SETMORE_MOCK
  return await import('../setmore.js')
}

function stubSetmore(opts = {}) {
  const calls = { token: 0, slots: 0 }
  // A replacement must never re-issue a token the test has marked as rejected.
  let issued = opts.issueFrom || 0
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    url = String(url)
    if (url.includes('/o/oauth2/token')) {
      calls.token++
      if (opts.tokenReply) return opts.tokenReply(calls.token)
      issued++
      return reply({ response: true, data: { token: { access_token: `tok-${issued}`, expires_in: 3600 } } })
    }
    if (url.includes('/bookingapi/staffs')) return reply({ response: true, data: { staffs: [{ key: 'staff1' }] } })
    calls.slots++
    const auth = (init && init.headers && init.headers.Authorization) || ''
    if (opts.rejectToken && auth.endsWith(opts.rejectToken)) {
      return reply({ response: false, msg: 'Your access token has been deemed invalid or expired.' }, 401)
    }
    return reply({ response: true, data: { slots: ['10:00 AM'] } })
  }))
  return calls
}

describe('shared Setmore token across containers', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); removeBlobs() })

  it('a second container adopts the first one\'s token instead of fetching its own', async () => {
    const blobs = installFreshBlobs()
    const calls = stubSetmore()
    const a = await container()
    await a.getSlots('svc', '2026-10-03')
    const b = await container()
    await b.getSlots('svc', '2026-10-04')
    expect(calls.token).toBe(1)
  })

  it('on a rejected token, adopts a newer one another container already fetched', async () => {
    const blobs = installFreshBlobs()
    const calls = stubSetmore()
    const a = await container()
    await a.getSlots('svc', '2026-10-03')            // a holds tok-1
    // Another container replaces it (as Setmore would after a reissue).
    await blobs('setmore-token').setJSON('access-token', { value: 'tok-9', expiresAt: Date.now() + 3600e3 })
    vi.unstubAllGlobals()
    const calls2 = stubSetmore({ rejectToken: 'tok-1' })
    await a.getSlots('svc', '2026-10-04')            // tok-1 rejected → should pick up tok-9
    expect(calls2.token).toBe(0)
  })

  it('replaces the shared token when it is the one that was rejected', async () => {
    const blobs = installFreshBlobs()
    stubSetmore()
    const a = await container()
    await a.getSlots('svc', '2026-10-03')            // tok-1, also in the store
    vi.unstubAllGlobals()
    const calls = stubSetmore({ rejectToken: 'tok-1', issueFrom: 1 })
    await a.getSlots('svc', '2026-10-04')
    expect(calls.token).toBe(1)                      // exactly one replacement
    const stored = await blobs('setmore-token').get('access-token', { type: 'json' })
    expect(stored.value).not.toBe('tok-1')
  })

  it('shares the throttle cooldown, so other containers back off without asking', async () => {
    vi.useFakeTimers()
    const blobs = installFreshBlobs()
    const calls = stubSetmore({ tokenReply: () => reply({ error: 'too_many_requests' }, 429) })
    const a = await container()
    const first = a.getSlots('svc', '2026-10-03').catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    expect((await first).code).toBe('RATE_LIMITED')
    const afterA = calls.token

    const b = await container()                  // a different, cold container
    const err = await b.getSlots('svc', '2026-10-04').catch((e) => e)
    expect(err.code).toBe('RATE_LIMITED')
    expect(calls.token).toBe(afterA)                  // b never asked Setmore
  })
})

describe('shared store works within the platform\'s limits', () => {
  afterEach(() => { vi.unstubAllGlobals(); removeBlobs() })

  // Regression guard for 24 Sep 2026: the token store asked for strong
  // consistency, which these handlers cannot have, so every shared read and
  // write failed live while this suite stayed green.
  it('shares a token end to end without needing strong consistency', async () => {
    installFreshBlobs()
    const calls = stubSetmore()
    const a = await container()
    await a.getSlots('svc', '2026-10-03')
    const b = await container()
    await b.getSlots('svc', '2026-10-04')
    expect(calls.token).toBe(1)
  })
})
