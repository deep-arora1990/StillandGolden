// Stage 3, Task 3: both partners sign the wedding agreement on one form; Deep
// and the couple get the same signed PDF, and Studio hears it once.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
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
const good = () => ({ token: link(), agreementDate: '2026-11-10',
  partners: [{ name: 'Sam Lee', email: 'sam@example.com', agreed: true }, { name: 'Alex Kim', email: 'alex@example.com', agreed: true }] })

let handler
beforeEach(async () => {
  process.env.RESEND_API_KEY = 're_test'
  process.env.STUDIO_BOOKING_INGEST_URL = STUDIO
  process.env.BOOKING_INGEST_SECRET = 'ingest-secret-test'
  process.env.BOOKING_LINK_SECRET = 'link-secret-test'
  delete process.env.NETLIFY_DEV
  stub()
  ;({ handler } = await fresh('../../submit-wedding-agreement.js'))
  L = nodeRequire('../booking-links.js')
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['RESEND_API_KEY', 'STUDIO_BOOKING_INGEST_URL', 'BOOKING_INGEST_SECRET', 'BOOKING_LINK_SECRET', 'NETLIFY_DEV']) delete process.env[k]
})

describe('signing the wedding agreement', () => {
  it('both sign: Deep and the couple get the signed PDF', async () => {
    const res = await handler(post(good()))
    expect(res.statusCode).toBe(200)
    expect(emails()).toHaveLength(2)
    const deep = to(OWNER), couple = to('sam@example.com')
    expect(deep.subject).toBe('[S&G] Wedding agreement signed: Sam Lee & Alex Kim · The whole shebang')
    expect(deep.text).toContain('Partner 2: Alex Kim <alex@example.com>, agreed'); expect(deep.text).toContain('Wedding date: 2027-03-06')
    expect([].concat(couple.to)).toEqual(['sam@example.com', 'alex@example.com'])
    expect(couple.subject).toBe('Your signed wedding agreement')
    for (const m of [deep, couple]) { expect(m.attachments).toHaveLength(1); expect(m.attachments[0].filename).toBe('wedding-agreement-lee-kim.pdf') }
  })
  it('signing sends no questionnaire', async () => {
    await handler(post(good()))
    for (const m of emails()) expect(`${m.html || ''}${m.text || ''}`).not.toMatch(/questionnaire\?|\/wedding-questionnaire|\/questionnaire/)
    expect(to('sam@example.com').html).toContain("I'll send you a short questionnaire then")
  })
  it('refuses unless both partners are named and both have ticked', async () => {
    const g = good()
    for (const bad of [
      { ...g, partners: [g.partners[0], { ...g.partners[1], agreed: false }] },
      { ...g, partners: [{ ...g.partners[0], agreed: 'true' }, g.partners[1]] },
      { ...g, partners: [g.partners[0]] },
      { ...g, partners: [g.partners[0], { name: '', email: 'alex@example.com', agreed: true }] },
      { ...g, partners: [g.partners[0], { name: 'Alex Kim', email: 'nope', agreed: true }] },
      { ...g, partners: [{ ...g.partners[0], email: '' }, g.partners[1]] },
      { ...g, partners: [{ ...g.partners[0], email: 'nope' }, g.partners[1]] },
      { ...g, partners: [g.partners[0], { name: ' sam lee ', email: 'x@example.com', agreed: true }] },
    ]) expect((await handler(post(bad))).statusCode).toBe(400)
    expect(emails()).toHaveLength(0); expect(toStudio()).toHaveLength(0)
  })
  it('a shared inbox is fine: one email to it', async () => {
    const g = good(); g.partners[1].email = 'sam@example.com'
    expect((await handler(post(g))).statusCode).toBe(200)
    expect([].concat(to('sam@example.com').to)).toEqual(['sam@example.com'])
  })
  it('Partner 2 email is optional: one recipient, clean Deep line, blank Studio email', async () => {
    const g = good(); g.partners[1].email = ''
    expect((await handler(post(g))).statusCode).toBe(200)
    expect(emails()).toHaveLength(2)
    expect([].concat(to('sam@example.com').to)).toEqual(['sam@example.com'])
    expect(to(OWNER).text).toContain('Partner 2: Alex Kim, agreed')
    expect(to(OWNER).text).not.toContain('<>')
    expect(toStudio()[0].body.signers).toEqual([{ name: 'Sam Lee', email: 'sam@example.com' }, { name: 'Alex Kim', email: '' }])
  })
  it('a Partner 2 email that is given but invalid is refused with a clear message', async () => {
    const g = good(); g.partners[1].email = 'nope'
    const res = await handler(post(g))
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe("Partner 2's email doesn't look quite right. Leave it blank if you share an inbox.")
  })
  it('missing Partner 1 email gets the new message', async () => {
    const g = good(); g.partners[0].email = ''
    expect(JSON.parse((await handler(post(g))).body).error).toBe('Please add both your names, and at least Partner 1\'s email.')
  })
  it('Studio hears terms_signed once, with both signers', async () => {
    await handler(post(good()))
    expect(toStudio()).toHaveLength(1)
    expect(toStudio()[0].body).toEqual({ type: 'terms_signed', appointmentId: 'appt9', email: 'sam@example.com', sessionDate: '2027-03-06', agreement: 'wedding',
      signers: [{ name: 'Sam Lee', email: 'sam@example.com' }, { name: 'Alex Kim', email: 'alex@example.com' }] })
  })
  it('a family booking link can\'t sign the wedding agreement; no link, a tampered or an expired one neither', async () => {
    for (const token of [link({ s: 'golden' }), undefined, link().slice(0, -2) + 'xx', L.sign({ s: 'wedding-full', d: '2027-03-06' }, Date.now() - 121 * 86400000)])
      expect((await handler(post({ ...good(), token }))).statusCode).toBe(400)
    expect(emails()).toHaveLength(0); expect(toStudio()).toHaveLength(0)
  })
  it('the package and date come from the link, never the form', async () => {
    await handler(post({ ...good(), sessionType: 'golden', sessionDate: '2026-12-01', tierKey: 'wedding-short' }))
    expect(to(OWNER).subject).toMatch(/The whole shebang$/); expect(to(OWNER).text).toContain('Wedding date: 2027-03-06')
  })
  it('escapes names in the HTML email', async () => {
    const g = good(); g.partners[1].name = '<b>Alex</b> Kim'
    await handler(post(g)); expect(to('sam@example.com').html).not.toContain('<b>Alex</b>')
  })
  it('local preview (netlify dev, no Resend key) sends nothing', async () => {
    delete process.env.RESEND_API_KEY; process.env.NETLIFY_DEV = 'true'
    expect(JSON.parse((await handler(post(good()))).body)).toEqual({ success: true, dev: true })
    expect(emails()).toHaveLength(0); expect(toStudio()).toHaveLength(0)
  })
  it('new source has no em dash or emoji', () => { expect(read('netlify/functions/submit-wedding-agreement.js')).not.toMatch(/—|&mdash;|\p{Extended_Pictographic}/u) })
})

describe('a wedding-booking token', () => {
  it('cannot sign the agreement as a link', async () => {
    const res = await handler(post({ ...good(), token: link({ k: 'wedding-booking' }) }))
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toContain('expired or')
    expect(emails()).toHaveLength(0)
  })
})
