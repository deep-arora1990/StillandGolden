// Model call questionnaire (15 Oct 2026): the pre-session form for the two free
// sunset beach model sessions, plus the "What are the kids into at the moment?"
// question added to the main and mini questionnaires.
// Copy: brand/model-call/model-call-forms.md §1–2.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

async function fresh(mod) {
  vi.resetModules()
  process.env.RESEND_API_KEY = 're_test'
  delete process.env.STUDIO_BOOKING_INGEST_URL
  delete process.env.STUDIO_QUESTIONNAIRE_INGEST_URL
  return await import(mod)
}

let calls
function stubResend() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    url = String(url)
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
    return json(url.includes('/emails') ? { id: 'e1' } : {})
  }))
}
const emails = () => calls.filter((c) => c.url.endsWith('/emails')).map((c) => c.body)
const to = (addr) => emails().find((e) => [].concat(e.to).includes(addr))
const OWNER = 'hello@stillandgolden.com.au'
const post = (body) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) })

const ROOT = path.resolve(__dirname, '../../../..')
beforeEach(() => stubResend())
afterEach(() => { vi.unstubAllGlobals() })

describe('model call questionnaire', () => {
  const MOD = '../../submit-model-call-questionnaire.js'
  const answers = {
    name: 'Mia Tran',
    email: 'mia@example.com',
    mobile: '0400 000 000',
    sessionDate: '2026-11-20',
    joining: 'Mia, Tom, Ava (4) and Leo (2), plus Nana',
    kidsInto: 'Bluey, digging holes, the Wiggles',
    shy: 'Tom hates photos',
    anythingElse: 'Leo naps until 3pm',
  }

  it('rejects a submission missing any required answer, and sends nothing', async () => {
    const { handler } = await fresh(MOD)
    for (const field of ['name', 'email', 'mobile', 'joining']) {
      const res = await handler(post({ ...answers, [field]: '' }))
      expect(res.statusCode, field).toBe(400)
    }
    const badEmail = await handler(post({ ...answers, email: 'not-an-email' }))
    expect(badEmail.statusCode).toBe(400)
    expect(emails()).toHaveLength(0)
  })

  it('sends Deep every answer, and the client their copy, kids interests included', async () => {
    const { handler } = await fresh(MOD)
    const res = await handler(post(answers))
    expect(res.statusCode).toBe(200)
    expect(emails()).toHaveLength(2)

    const owner = to(OWNER)
    expect(owner.subject).toMatch(/^\[S&G\] Model call questionnaire — Mia Tran/)
    expect(owner.reply_to || owner.replyTo).toBe('mia@example.com')
    for (const v of Object.values(answers)) expect(owner.text).toContain(v)

    const client = to('mia@example.com')
    expect(client.text).toContain('Bluey, digging holes, the Wiggles')
    expect(client.text).toContain(answers.joining)
    expect(client.text).toMatch(/style-guide/)
  })

  it('is generic, for any future model call: nothing about a beach (Deep, 15 Oct 2026)', async () => {
    const { handler } = await fresh(MOD)
    await handler(post({ ...answers, beach: 'Seaford' }))
    for (const e of emails()) {
      expect(`${e.subject} ${e.text}`).not.toMatch(/beach|sunset|towel|Seaford/i)
    }
    const page = fs.readFileSync(path.join(ROOT, 'model-call-questionnaire.html'), 'utf8')
    expect(page).toMatch(/<p class="page-label">Before your session<\/p>/)
    expect(page).not.toMatch(/beach|sunset|golden hour|towel|waves/i)
  })

  it('has no session-type question: the model call is for the free sessions only', async () => {
    const { handler } = await fresh(MOD)
    await handler(post(answers))
    for (const e of emails()) expect(e.text).not.toMatch(/half.price/i)
  })

  it('escapes what the client typed wherever it lands in HTML', async () => {
    const { handler } = await fresh(MOD)
    const res = await handler(post({ ...answers, name: '<b>Mia & Tom</b>', kidsInto: '<script>x</script>' }))
    expect(res.statusCode).toBe(200)
    for (const e of emails()) {
      if (!e.html) continue
      expect(e.html).not.toContain('<b>Mia')
      expect(e.html).not.toContain('<script>')
    }
    const owner = to(OWNER)
    expect(owner.html).toContain('&lt;b&gt;Mia &amp; Tom&lt;/b&gt;')
    expect(owner.text).toContain('<b>Mia & Tom</b>')
  })

  it('discards a honeypot submission silently', async () => {
    const { handler } = await fresh(MOD)
    const res = await handler(post({ ...answers, company: 'Spam Pty Ltd' }))
    expect(res.statusCode).toBe(200)
    expect(emails()).toHaveLength(0)
  })

  it('rejects anything but POST', async () => {
    const { handler } = await fresh(MOD)
    const res = await handler({ httpMethod: 'GET', headers: {} })
    expect(res.statusCode).toBe(405)
    expect(emails()).toHaveLength(0)
  })
})

describe('"What are the kids into at the moment?" on the other questionnaires', () => {
  it('reaches Deep from the main questionnaire', async () => {
    const { handler } = await fresh('../../submit-questionnaire.js')
    const res = await handler(post({ names: 'Mary Jane', email: 'm@example.com', imageConsent: 'Yes', kidsInto: 'Dinosaurs and Peppa Pig' }))
    expect(res.statusCode).toBe(200)
    expect(to(OWNER).text).toMatch(/Dinosaurs and Peppa Pig/)
  })

  it('reaches Deep and the client from the mini questionnaire', async () => {
    const { handler } = await fresh('../../submit-mini-questionnaire.js')
    const res = await handler(post({ name: 'Mary Jane', email: 'm@example.com', joining: 'Ava (3)', kidsInto: 'Trains, always trains' }))
    expect(res.statusCode).toBe(200)
    expect(to(OWNER).text).toMatch(/Trains, always trains/)
    expect(to('m@example.com').text).toMatch(/Trains, always trains/)
  })
})
