// Stage 3, Task 5: the wedding questionnaire goes to Deep, to both partners
// and to Studio, and it never asks about image consent.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(__dirname, '../../../..')
const FILE = 'netlify/functions/submit-wedding-questionnaire.js'
const OWNER = 'hello@stillandgolden.com.au'
const STUDIO = 'https://studio.example/.netlify/functions/booking-intake'
const nodeRequire = createRequire(import.meta.url)
const clearFunctionsCache = () => {
  for (const k of Object.keys(nodeRequire.cache)) if (k.includes('/netlify/functions/')) delete nodeRequire.cache[k]
}

let L
let calls
async function fresh(mod) {
  vi.resetModules()
  clearFunctionsCache()
  return await import(mod)
}
function stub() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    url = String(url)
    calls.push({ url, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null })
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })
    if (url === STUDIO) return json({ ok: true, matched: true })
    return json({ id: 'e1' })
  }))
}
const toStudio = () => calls.filter((c) => c.url === STUDIO)
const emails = () => calls.filter((c) => c.url.endsWith('/emails')).map((c) => c.body)
const to = (addr) => emails().find((e) => [].concat(e.to).includes(addr))
const post = (body) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) })
const link = (over = {}) => L.sign({ a: 'appt9', f: 'Sam', l: 'Lee', e: 'sam@example.com', s: 'wedding-full', d: '2027-03-06', h: '', ...over })

const A = { name: 'Sam Lee', partnerName: 'Alex Kim', email: 'sam@example.com', phone: '0400 000 000', howMet: 'At a gelato shop',
  whoFellFirst: 'Alex', ceremonyLocation: 'Melbourne Registry Office, 71 Queen St', ceremonyTime: '11:00am', gettingReady: 'Our place',
  groupShots: "Sam's mum and dad, Priya and Raj", sensitive: 'Dad and stepmum, keep them apart', planAfter: 'Pizza at Lygon St' }

let handler, _test
beforeEach(async () => {
  process.env.RESEND_API_KEY = 're_test'
  process.env.STUDIO_BOOKING_INGEST_URL = STUDIO
  process.env.BOOKING_INGEST_SECRET = 'ingest-secret-test'
  process.env.BOOKING_LINK_SECRET = 'link-secret-test'
  delete process.env.NETLIFY_DEV
  stub()
  ;({ handler, _test } = await fresh('../../submit-wedding-questionnaire.js'))
  L = nodeRequire('../booking-links.js')
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['RESEND_API_KEY', 'STUDIO_BOOKING_INGEST_URL', 'BOOKING_INGEST_SECRET', 'BOOKING_LINK_SECRET', 'NETLIFY_DEV', 'STUDIO_QUESTIONNAIRE_INGEST_URL', 'QUESTIONNAIRE_INGEST_SECRET']) delete process.env[k]
})

describe('the wedding questionnaire', () => {
  it('asks Deep\'s own "You two" questions, word for word, and no consent question', async () => {
    expect(_test.QUESTIONS.filter((q) => q.section === 'You two').map((q) => q.label)).toEqual(['How did you meet?', 'Who fell for whom first?',
      'Favourite movies and TV shows?', 'What do you two do for fun?', 'Your ideal meal after a big night out?', 'Who has the best dance moves?'])
    expect([...new Set(_test.QUESTIONS.map((q) => q.section))]).toEqual(['The basics', 'You two', 'The day', 'Your people', 'Must-haves'])
    expect(JSON.stringify(_test.QUESTIONS)).not.toMatch(/consent|Faceless|permission/i)
  })
  it('sends Deep every answer and the couple their copy', async () => {
    const res = await handler(post({ ...A, token: link() }))
    expect(res.statusCode).toBe(200); expect(emails()).toHaveLength(2)
    expect(to(OWNER).subject).toBe('[S&G] Wedding questionnaire: Sam Lee & Alex Kim')
    for (const v of Object.values(A)) expect(to(OWNER).text).toContain(v)
    expect(to(OWNER).text).toContain('Wedding: The whole shebang, 2027-03-06')
    expect(to(OWNER).reply_to).toBe('sam@example.com')
    expect(to('sam@example.com').html).toContain('At a gelato shop')
    expect(to('sam@example.com').subject).toBe('Your wedding questionnaire answers')
    expect(to('sam@example.com').html).toContain('Thanks, Sam.')
  })
  it('reaches Studio like the family questionnaire, ceremony as the location, and never as a consent answer', async () => {
    process.env.STUDIO_QUESTIONNAIRE_INGEST_URL = 'https://studio.example/q'; process.env.QUESTIONNAIRE_INGEST_SECRET = 'q'
    await handler(post({ ...A, token: link() }))
    expect(calls.filter((c) => c.url === 'https://studio.example/q')).toHaveLength(0)
    const ev = toStudio()[0].body
    expect(ev).toMatchObject({ type: 'questionnaire', appointmentId: 'appt9', email: 'sam@example.com', sessionDate: '2027-03-06', address: 'Melbourne Registry Office, 71 Queen St' })
    expect(ev.answers).toMatchObject({ form: 'wedding', package: 'The whole shebang', howMet: 'At a gelato shop' })
    expect(ev.answers).not.toHaveProperty('imageConsent')
  })
  it('getting ready is only for The whole shebang', async () => {
    await handler(post({ ...A, token: link({ s: 'wedding-short' }) }))
    expect(toStudio()[0].body.answers).not.toHaveProperty('gettingReady'); expect(to(OWNER).text).not.toContain('Our place')
  })
  it('works without a link when the date is given; a family link is refused; a stale link loses nothing', async () => {
    expect((await handler(post({ ...A, weddingDate: '2027-03-06' }))).statusCode).toBe(200)
    expect((await handler(post({ ...A }))).statusCode).toBe(400)
    expect((await handler(post({ ...A, token: link({ s: 'golden' }) }))).statusCode).toBe(400)
    expect((await handler(post({ ...A, token: 'junk.sig', weddingDate: '2027-03-06' }))).statusCode).toBe(200)
  })
  it('needs a name, an email and a mobile; sends nothing otherwise', async () => {
    for (const f of ['name', 'email', 'phone']) expect((await handler(post({ ...A, weddingDate: '2027-03-06', [f]: '' }))).statusCode, f).toBe(400)
    expect((await handler(post({ ...A, weddingDate: '2027-03-06', phone: '1234' }))).statusCode).toBe(400)
    expect(emails()).toHaveLength(0)
  })
  it('a bot in the honeypot gets a quiet 200 and nothing is sent', async () => {
    const res = await handler(post({ ...A, token: link(), company: 'x' }))
    expect(res.statusCode).toBe(200); expect(emails()).toEqual([]); expect(toStudio()).toEqual([])
  })
  it('escapes answers in HTML, and the source has no em dash or emoji', async () => {
    await handler(post({ ...A, token: link(), sensitive: '<script>x</script>' }))
    for (const m of emails()) expect(m.html).not.toContain('<script>x')
    expect(to(OWNER).html).toContain('&lt;script&gt;')
    const src = fs.readFileSync(path.join(ROOT, FILE), 'utf8')
    expect(src).not.toMatch(/—|&mdash;|\p{Extended_Pictographic}/u)
  })
  it('caps each answer at 5,000 characters', async () => {
    await handler(post({ ...A, token: link(), howMet: 'x'.repeat(6000) }))
    expect(toStudio()[0].body.answers.howMet).toHaveLength(5000)
  })
  it('does nothing but log in dev without a Resend key', async () => {
    delete process.env.RESEND_API_KEY; process.env.NETLIFY_DEV = 'true'
    const res = await handler(post({ ...A, token: link() }))
    expect(res.statusCode).toBe(200); expect(JSON.parse(res.body)).toEqual({ success: true, dev: true }); expect(calls).toEqual([])
  })
})

describe('Partner 2 is copied in', () => {
  it('the couple copy goes to both when partnerEmail is valid', async () => {
    await handler(post({ ...A, token: link(), partnerEmail: 'alex@example.com' }))
    expect([].concat(to('sam@example.com').to)).toEqual(['sam@example.com', 'alex@example.com'])
    expect(emails()).toHaveLength(2)
  })
  it('only to email when partnerEmail is missing or invalid', async () => {
    for (const partnerEmail of [undefined, 'not-an-email', 'a@b.co'.padEnd(250, 'x')]) {
      calls.length = 0
      await handler(post({ ...A, token: link(), ...(partnerEmail ? { partnerEmail } : {}) }))
      expect([].concat(to('sam@example.com').to)).toEqual(['sam@example.com'])
    }
  })
  it('deduped when equal, ignoring case', async () => {
    await handler(post({ ...A, token: link(), partnerEmail: 'SAM@Example.com' }))
    expect([].concat(to('sam@example.com').to)).toEqual(['sam@example.com'])
  })
})
