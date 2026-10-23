// Enquiries tracker (23 Oct 2026): the site remembers, for the visit, whether
// someone arrived from a Meta or Google ad, and carries that on every enquiry
// and through Stripe checkout into the booking Studio records. A bare fbclid
// is only 'fb_link': Meta adds it to ordinary Facebook and Instagram link
// clicks too, so it is a hint for Deep, not an ad.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'
import { fakeStripe } from './helpers/fake-stripe.js'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const SITE_TAGS = read('site-tags.js')

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
  }
}
const brokenStorage = {
  getItem() { throw new Error('SecurityError: storage disabled') },
  setItem() { throw new Error('SecurityError: storage disabled') },
}

// site-tags.js's own capture function, run as the page runs it.
const sgCaptureAd = (() => {
  const fn = SITE_TAGS.match(/function sgCaptureAd\(search, storage\) \{[\s\S]*?\n\}/)
  if (!fn) return () => 'missing'
  return new Function(fn[0] + '; return sgCaptureAd')()
})()

describe('sgCaptureAd: reading the landing URL', () => {
  const cases = [
    ['?gclid=Cj0KCQ', 'google'],
    ['?fbclid=IwAR0abc', 'fb_link'],
    ['?fbclid=IwAR0abc&utm_source=facebook&utm_medium=paid', 'meta'],
    ['?fbclid=IwAR0abc&utm_source=facebook&utm_medium=social', 'fb_link'],
    ['?utm_source=facebook&utm_medium=paid', 'meta'],
    ['?utm_source=instagram&utm_medium=cpc', 'meta'],
    ['?utm_source=fb&utm_medium=paid_social', 'meta'],
    ['?utm_source=ig&utm_medium=ads', 'meta'],
    ['?utm_source=Instagram&utm_medium=Paid', 'meta'],
    ['?gclid=abc&fbclid=def', 'google'],
    ['?utm_source=facebook&utm_medium=social', null],
    ['?utm_source=facebook', null],
    ['?utm_medium=paid', null],
    ['?utm_source=google&utm_medium=cpc', null],
    ['?gclid=', null],
    ['', null],
    ['?service=golden', null],
  ]
  for (const [search, expected] of cases) {
    it(`${search || '(no query)'} → ${expected}`, () => {
      const store = memoryStorage()
      expect(sgCaptureAd(search, store)).toBe(expected)
      expect(store.getItem('sg_ad')).toBe(expected)
    })
  }

  it('the first ad in the visit wins', () => {
    const store = memoryStorage()
    expect(sgCaptureAd('?utm_source=facebook&utm_medium=paid', store)).toBe('meta')
    expect(sgCaptureAd('?gclid=two', store)).toBe('meta')
    expect(sgCaptureAd('?fbclid=three', store)).toBe('meta')
    expect(sgCaptureAd('', store)).toBe('meta')
    expect(store.data).toEqual({ sg_ad: 'meta' })
  })

  it('a paid signal later in the visit replaces a bare Facebook link, never the other way', () => {
    const toMeta = memoryStorage()
    expect(sgCaptureAd('?fbclid=one', toMeta)).toBe('fb_link')
    expect(sgCaptureAd('', toMeta)).toBe('fb_link')
    expect(sgCaptureAd('?fbclid=two', toMeta)).toBe('fb_link')
    expect(sgCaptureAd('?utm_source=instagram&utm_medium=cpc', toMeta)).toBe('meta')
    expect(sgCaptureAd('?fbclid=three', toMeta)).toBe('meta')
    expect(toMeta.data).toEqual({ sg_ad: 'meta' })
    const toGoogle = memoryStorage({ sg_ad: 'fb_link' })
    expect(sgCaptureAd('?gclid=abc', toGoogle)).toBe('google')
    expect(toGoogle.data).toEqual({ sg_ad: 'google' })
  })

  it('a page with no ad keeps what landing stored', () => {
    const store = memoryStorage({ sg_ad: 'google' })
    expect(sgCaptureAd('?service=golden', store)).toBe('google')
  })

  it('storage that throws is ignored', () => {
    expect(() => sgCaptureAd('?gclid=abc', brokenStorage)).not.toThrow()
    expect(sgCaptureAd('?gclid=abc', brokenStorage)).toBe(null)
  })
})

describe('site-tags.js: window.sgAd() on every page, previews included', () => {
  function runSiteTags({ hostname = 'deploy-preview-1--stillandgolden.netlify.app', search = '', storage = memoryStorage() } = {}) {
    const sandbox = { location: { hostname, search }, URLSearchParams }
    sandbox.window = sandbox
    Object.defineProperty(sandbox, 'sessionStorage', {
      get() { if (storage === 'blocked') throw new Error('SecurityError: blocked'); return storage },
    })
    vm.runInNewContext(SITE_TAGS, sandbox)
    return sandbox
  }

  it('the capture runs above the production-host guard', () => {
    const guard = SITE_TAGS.indexOf('if (SG_PROD_HOSTS.indexOf(location.hostname) === -1)')
    expect(guard).toBeGreaterThan(-1)
    expect(SITE_TAGS.indexOf('sgCaptureAd(location.search')).toBeGreaterThan(-1)
    expect(SITE_TAGS.indexOf('sgCaptureAd(location.search')).toBeLessThan(guard)
    expect(SITE_TAGS.indexOf('window.sgAd = function')).toBeLessThan(guard)
  })

  it('remembers the ad from landing to a later page', () => {
    const storage = memoryStorage()
    expect(runSiteTags({ search: '?fbclid=abc', storage }).window.sgAd()).toBe('fb_link')
    expect(runSiteTags({ search: '', storage }).window.sgAd()).toBe('fb_link')
    expect(runSiteTags({ search: '?utm_source=fb&utm_medium=paid', storage }).window.sgAd()).toBe('meta')
  })

  it('returns null with no ad, or with storage blocked', () => {
    expect(runSiteTags({ search: '?utm_source=newsletter' }).window.sgAd()).toBe(null)
    let tags
    expect(() => { tags = runSiteTags({ search: '?gclid=abc', storage: 'blocked' }) }).not.toThrow()
    expect(tags.window.sgAd()).toBe(null)
  })

  it('ignores a value it did not write', () => {
    expect(runSiteTags({ storage: memoryStorage({ sg_ad: 'tiktok' }) }).window.sgAd()).toBe(null)
  })
})

describe('checkout bodies carry the ad source', () => {
  const AD = /ad: window\.sgAd \? window\.sgAd\(\) : null,/
  const checkoutBody = (page) => {
    const src = read(page)
    const start = src.indexOf("api('booking-checkout'")
    expect(start).toBeGreaterThan(-1)
    return src.slice(start, src.indexOf('}),', start))
  }
  it('book.html and christmas-minis.html', () => {
    expect(checkoutBody('book.html')).toMatch(AD)
    expect(checkoutBody('christmas-minis.html')).toMatch(AD)
  })
})

describe('booking-checkout: ad_source in the Stripe metadata', () => {
  let stripe
  async function fresh(mod) {
    vi.resetModules()
    process.env.SETMORE_API_KEY = 'test'
    delete process.env.SETMORE_MOCK
    return await import(mod)
  }
  const post = (body) => ({ httpMethod: 'POST', headers: { host: 'stillandgolden.com.au' }, body: JSON.stringify(body) })
  async function checkout(over) {
    const { TIERS } = await fresh('../setmore.js')
    const { handler } = await fresh('../../booking-checkout.js')
    const res = await handler(post({ service_key: TIERS.golden.serviceKey, date: '2026-11-21', time: '10:00',
      firstName: 'Mia', lastName: 'Example', email: 'mia@example.com', ...over }))
    expect(res.statusCode).toBe(200)
    return stripe._sessions[stripe._sessions.length - 1].metadata
  }

  beforeEach(() => { installFreshBlobs(); stripe = fakeStripe(); globalThis.__sgStripe = stripe; process.env.STRIPE_TEST_KEY = 'sk_test_x' })
  afterEach(() => { removeBlobs(); delete globalThis.__sgStripe; delete process.env.STRIPE_TEST_KEY })

  it('stores meta, google or fb_link', async () => {
    expect((await checkout({ ad: 'meta' })).ad_source).toBe('meta')
    expect((await checkout({ ad: 'google' })).ad_source).toBe('google')
    expect((await checkout({ ad: 'fb_link' })).ad_source).toBe('fb_link')
  })

  it('drops anything else, and leaves the rest of the metadata as it was', async () => {
    for (const ad of [undefined, null, '', 'tiktok', 'META', { x: 1 }]) {
      const meta = await checkout({ ad })
      expect(meta).not.toHaveProperty('ad_source')
      expect(meta).toMatchObject({ date: '2026-11-21', time: '10:00', email: 'mia@example.com', marketingConsent: 'no' })
    }
  })
})

describe('stripe-webhook: the booking tells Studio its ad source', () => {
  const STUDIO = 'https://studio.example/.netlify/functions/booking-intake'
  let calls
  beforeEach(() => {
    process.env.STUDIO_BOOKING_INGEST_URL = STUDIO
    process.env.BOOKING_INGEST_SECRET = 'ingest-secret-test'
    calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null })
      return new Response(JSON.stringify({ ok: true, matched: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.STUDIO_BOOKING_INGEST_URL
    delete process.env.BOOKING_INGEST_SECRET
  })

  async function reported(extraMeta) {
    vi.resetModules()
    process.env.RESEND_API_KEY = 're_test'
    process.env.SETMORE_API_KEY = 'test'
    const { TIERS } = await import('../setmore.js')
    const { _test } = await import('../../stripe-webhook.js')
    calls.length = 0
    await _test.reportBookingToStudio({ id: 'cs_1' }, { firstName: 'Mia', lastName: 'Example', email: 'mia@example.com',
      service_key: TIERS.golden.serviceKey, date: '2026-11-21', time: '10:00', ...extraMeta }, { key: 'appt1' })
    return calls.filter((c) => c.url === STUDIO)[0].body
  }

  it('adSource is meta, google or fb_link from the metadata, otherwise null', async () => {
    expect((await reported({ ad_source: 'meta' })).adSource).toBe('meta')
    expect((await reported({ ad_source: 'google' })).adSource).toBe('google')
    expect((await reported({ ad_source: 'fb_link' })).adSource).toBe('fb_link')
    expect((await reported({})).adSource).toBe(null)
    expect((await reported({ ad_source: 'tiktok' })).adSource).toBe(null)
  })
})
