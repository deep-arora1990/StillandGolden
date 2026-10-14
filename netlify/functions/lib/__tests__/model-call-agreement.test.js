// Model Call Session Agreement (15 Oct 2026): for the two free beach mini
// families only, sent by hand. Image use is the condition of the session, so
// the signature confirms parent/guardian consent for the children. Wording:
// brand/model-call/model-call-forms.md §3 (Deep settled the terms on 15 Oct).
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const OWNER = 'hello@stillandgolden.com.au'

async function fresh(mod) {
  vi.resetModules()
  process.env.RESEND_API_KEY = 're_test'
  return await import(mod)
}
let calls
function stub() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null })
    return new Response(JSON.stringify({ id: 'e1' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}
const emails = () => calls.filter((c) => c.url.endsWith('/emails')).map((c) => c.body)
const to = (addr) => emails().find((e) => [].concat(e.to).includes(addr))
const post = (body) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) })
const body = { firstName: 'Mia', lastName: 'Example', email: 'mia@example.com', sessionDate: '2026-10-24', agreementDate: '2026-10-18', accepted: true }

afterEach(() => vi.unstubAllGlobals())

describe('signing the model call agreement', () => {
  it('sends Deep the signed PDF, and the family their copy with the model call questionnaire', async () => {
    stub()
    const { handler } = await fresh('../../submit-model-call-agreement.js')
    const res = await handler(post(body))
    expect(res.statusCode).toBe(200)
    const owner = to(OWNER)
    expect(owner.subject).toMatch(/^\[S&G\] Model call agreement signed — Mia Example/)
    expect(owner.text).toMatch(/Session date: 2026-10-24/)
    expect(owner.attachments).toHaveLength(1)
    const client = to('mia@example.com')
    expect(client.html).toContain('https://stillandgolden.com.au/model-call-questionnaire')
    expect(client.attachments).toHaveLength(1)
  })

  it('refuses without the parent/guardian tick, or with details missing', async () => {
    stub()
    const { handler } = await fresh('../../submit-model-call-agreement.js')
    expect((await handler(post({ ...body, accepted: false }))).statusCode).toBe(400)
    expect((await handler(post({ ...body, email: 'nope' }))).statusCode).toBe(400)
    expect((await handler(post({ ...body, sessionDate: '' }))).statusCode).toBe(400)
    expect(emails()).toHaveLength(0)
  })

  it('escapes the name in the email', async () => {
    stub()
    const { handler } = await fresh('../../submit-model-call-agreement.js')
    await handler(post({ ...body, firstName: '<b>Mia</b>' }))
    expect(to('mia@example.com').html).not.toContain('<b>Mia</b>')
  })

  it('the PDF carries the agreed terms, and not the two that were dropped', async () => {
    const { _test } = await fresh('../../submit-model-call-agreement.js')
    const all = _test.SECTIONS.map((s) => `${s.title} ${s.paras.join(' ')}`).join(' ')
    expect(all).toMatch(/parent or legal guardian/)
    expect(all).toMatch(/including paid ads/)
    expect(all).toMatch(/swimwear only/)
    expect(all).not.toMatch(/14 days|48 hours|forfeit/)
  })

  it('is generic, for any future model call: a 45-minute session, no place or time of day (Deep, 15 Oct 2026)', async () => {
    const { _test } = await fresh('../../submit-model-call-agreement.js')
    const all = _test.SECTIONS.map((s) => `${s.title} ${s.paras.join(' ')}`).join(' ')
    expect(all).toMatch(/A 45-minute session\./)
    expect(all).not.toMatch(/beach|sunset|Frankston|Seaford|Carrum|evening|water/i)
    const page = fs.readFileSync(path.join(ROOT, 'model-call-agreement.html'), 'utf8')
    expect(page).toMatch(/A 45-minute session\./)
    expect(page).not.toMatch(/beach|sunset|Frankston|Seaford|Carrum|evening|water/i)
  })
})

describe('the page', () => {
  const page = fs.readFileSync(path.join(ROOT, 'model-call-agreement.html'), 'utf8')
  it('is the Model Call Session Agreement, unindexed, posting to its own function', () => {
    expect(page).toMatch(/<h1 class="page-title">Model Call Session Agreement<\/h1>/)
    expect(page).toMatch(/<meta name="robots" content="noindex, nofollow">/)
    expect(page).toMatch(/submit-model-call-agreement/)
    expect(page).toMatch(/I'm the parent or legal guardian of the children attending, and I agree to the terms of this Model Call Session Agreement\./)
    expect(page).not.toMatch(/14 days|48 hours|forfeit|\$/)
  })
})
