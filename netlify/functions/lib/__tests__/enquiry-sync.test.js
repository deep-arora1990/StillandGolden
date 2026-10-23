// Website enquiries → Studio's enquiry tracker (23 Oct 2026). The enquiry has
// already reached Deep by email when this runs, so a Studio that is down,
// slow or unconfigured costs a row in the tracker and nothing else. The logs
// are public-facing (Netlify function logs), so they never carry who enquired.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const STUDIO = 'https://studio.example/.netlify/functions/enquiry-intake'
const SECRET = 'enquiry-secret-test'
const fields = {
  first_name: 'Mia', last_name: 'Example', email: 'mia@example.com', phone: '0400 000 000',
  session_type: 'golden', preferred_date: 'A Saturday in November', message: 'Hello',
  suburb: 'Clyde North', reason: 'Saw a reel', source: 'book', ad: 'meta',
}

async function fresh() {
  vi.resetModules()
  return await import('../enquiry-sync.js')
}

let logged
beforeEach(() => {
  process.env.STUDIO_ENQUIRY_INGEST_URL = STUDIO
  process.env.ENQUIRY_INGEST_SECRET = SECRET
  logged = []
  for (const level of ['log', 'error', 'warn']) {
    vi.spyOn(console, level).mockImplementation((...args) => { logged.push(args.map(String).join(' ')) })
  }
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete process.env.STUDIO_ENQUIRY_INGEST_URL
  delete process.env.ENQUIRY_INGEST_SECRET
})

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })
const noPersonalDetails = () => {
  for (const line of logged) {
    expect(line).not.toMatch(/@/)
    expect(line).not.toMatch(/Mia|Example|0400/)
  }
}

describe('postEnquiry', () => {
  it('sends the enquiry with the shared secret and resolves true on ok', async () => {
    const fetchSpy = vi.fn(async () => json({ ok: true, id: 7, created: true }))
    vi.stubGlobal('fetch', fetchSpy)
    const { postEnquiry } = await fresh()
    expect(await postEnquiry(fields)).toBe(true)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(STUDIO)
    expect(init.method).toBe('POST')
    expect(init.headers['x-ingest-secret']).toBe(SECRET)
    expect(JSON.parse(init.body)).toEqual(fields)
    noPersonalDetails()
  })

  it('does nothing without the URL or the secret', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    delete process.env.STUDIO_ENQUIRY_INGEST_URL
    expect(await (await fresh()).postEnquiry(fields)).toBe(false)
    process.env.STUDIO_ENQUIRY_INGEST_URL = STUDIO
    delete process.env.ENQUIRY_INGEST_SECRET
    expect(await (await fresh()).postEnquiry(fields)).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    noPersonalDetails()
  })

  it('resolves false, never throws, when Studio is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND studio.example') }))
    const { postEnquiry } = await fresh()
    await expect(postEnquiry(fields)).resolves.toBe(false)
    noPersonalDetails()
  })

  it('resolves false when Studio refuses it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, error: 'email is required' }, 400)))
    const { postEnquiry } = await fresh()
    expect(await postEnquiry(fields)).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })))
    expect(await postEnquiry(fields)).toBe(false)
    noPersonalDetails()
  })

  it('gives up after 5 seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })))
    })))
    const { postEnquiry } = await fresh()
    let settled = null
    const pending = postEnquiry(fields).then((v) => { settled = v })
    await vi.advanceTimersByTimeAsync(4900)
    expect(settled).toBe(null)
    await vi.advanceTimersByTimeAsync(200)
    await pending
    expect(settled).toBe(false)
    noPersonalDetails()
  })

  // submit-enquiry passes when its handler started: Studio gets what is left
  // of 8 s after the emails and the contact, and never less than 1 s.
  async function abortsAfter(startedAgoMs) {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })))
    })))
    const { postEnquiry } = await fresh()
    let settled = null
    const pending = postEnquiry(fields, { startedAt: Date.now() - startedAgoMs }).then((v) => { settled = v })
    let waited = 0
    while (settled === null && waited < 10000) {
      await vi.advanceTimersByTimeAsync(100)
      waited += 100
    }
    await pending
    expect(settled).toBe(false)
    return waited
  }

  it('with a start time, gives up when 8 seconds have passed since the form arrived', async () => {
    expect(await abortsAfter(1500)).toBe(6500)
    vi.useRealTimers()
    expect(await abortsAfter(6000)).toBe(2000)
  })

  it('always gives Studio at least 1 second', async () => {
    expect(await abortsAfter(7900)).toBe(1000)
    vi.useRealTimers()
    expect(await abortsAfter(20000)).toBe(1000)
  })
})

describe('submit-enquiry budgets the Studio call from when its handler started', () => {
  it('records the start time first and passes it to postEnquiry', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '../../submit-enquiry.js'), 'utf8')
    const handler = src.slice(src.indexOf('exports.handler = async (event) => {'))
    expect(handler.split('\n')[1]).toMatch(/const startedAt = Date\.now\(\);/)
    expect(handler).toMatch(/postEnquiry\(\{[\s\S]*?\}, \{ startedAt \}\)/)
  })
})
