// Stage 3: the agreement PDF can show two signers (weddings). A family
// agreement must draw exactly what it drew before, so that is pinned by a hash
// of every drawText call (text, position, size).
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { drawnText } from './helpers/pdf-text.js'

async function fresh(mod) {
  vi.resetModules()
  process.env.RESEND_API_KEY = 're_test'
  process.env.SETMORE_API_KEY = 'test'
  process.env.BOOKING_LINK_SECRET = 'link-secret-test'
  process.env.BOOKING_INGEST_SECRET = 'ingest-secret-test'
  delete process.env.SETMORE_MOCK
  return await import(mod)
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

const FAMILY = { firstName: 'Mary', lastName: 'Jane', email: 'm@example.com', sessionDate: '2026-11-21', agreementDate: '2026-11-10' }
const FAMILY_DRAW_SHA256 = 'c7fde52d825f60d24287eb693e9f3e39c52d0c48094f15fe2c64bf6dbe67fae3'

const COUPLE = {
  signers: [{ name: 'Sam Lee', email: 'sam@example.com' }, { name: 'Alex Kim', email: 'alex@example.com' }],
  sessionDate: '2027-03-06', agreementDate: '2026-11-10', dateLabel: 'WEDDING DATE',
}

describe('agreement PDF signers', () => {
  it('a family agreement draws exactly what it drew before stage 3', async () => {
    const { _test } = await fresh('../../submit-contract.js')
    const { calls, pages } = await drawnText(() => _test.generatePDF({ ...FAMILY, sessionType: 'golden' }))
    expect(sha256(JSON.stringify(calls))).toBe(FAMILY_DRAW_SHA256)
    expect(pages).toBe(2)
  })

  it('a couple: both names in the box, both signatures, wedding date', async () => {
    const { renderAgreementPDF } = await fresh('../agreement-pdf.js')
    const W = await fresh('../wedding-agreement.js')
    const { calls } = await drawnText(() => renderAgreementPDF(COUPLE, W.weddingAgreementSections('wedding-full')))
    const t = calls.map((c) => c.text)
    for (const s of ['COUPLE', 'Sam Lee', 'Alex Kim', 'WEDDING DATE', '2027-03-06', 'ACCEPTED BY', 'sam@example.com', 'alex@example.com', 'Wedding Photography Agreement'])
      expect(t).toContain(s)
    expect(t.filter((s) => s === 'Agreed: 2026-11-10')).toHaveLength(2)
    expect(t).not.toContain('CLIENT')
    expect(t).not.toContain('SESSION DATE')
  })

  it('a signer with no email draws no empty email line', async () => {
    const { renderAgreementPDF } = await fresh('../agreement-pdf.js')
    const W = await fresh('../wedding-agreement.js')
    const signers = [COUPLE.signers[0], { name: 'Alex Kim', email: '' }]
    const { calls } = await drawnText(() => renderAgreementPDF({ ...COUPLE, signers }, W.weddingAgreementSections('wedding-full')))
    const t = calls.map((c) => c.text)
    expect(t).toContain('Alex Kim'); expect(t).toContain('sam@example.com')
    expect(t).not.toContain(''); expect(t.some((x) => /<|>/.test(x))).toBe(false)
    expect(t.filter((s) => s === 'Agreed: 2026-11-10')).toHaveLength(2)
  })

  it("an emoji or a long name in a couple's names never breaks the PDF", async () => {
    const { renderAgreementPDF } = await fresh('../agreement-pdf.js')
    const W = await fresh('../wedding-agreement.js')
    const signers = [{ name: 'Sam \u{1F48D} Lee', email: 'sam@example.com' }, { name: 'Alexandria Montgomery-Papadopoulos', email: 'alexandria.montgomery.papadopoulos@example.com' }]
    const { calls } = await drawnText(() => renderAgreementPDF({ ...COUPLE, signers }, W.weddingAgreementSections('wedding-short')))
    expect(calls.map((c) => c.text)).toContain('Sam Lee')
    for (const c of calls.filter((c) => c.text.startsWith('alexandria'))) expect(c.x + c.size * 0.5 * c.text.length).toBeLessThan(595.28)
  })

  it('accented letters outside WinAnsi keep their base letter, emoji are dropped', async () => {
    const { renderAgreementPDF } = await fresh('../agreement-pdf.js')
    const W = await fresh('../wedding-agreement.js')
    const names = [['M\u0101ori Ng\u0101', 'Maori Nga'], ['Nguy\u1EC5n Th\u1ECB', 'Nguyen Thi'], ['Zo\u00EB M\u00FCller', 'Zo\u00EB M\u00FCller'], ['Sam \u{1F48D} Lee', 'Sam Lee']]
    for (const [input, expected] of names) {
      const signers = [{ name: input, email: 'a@example.com' }, { name: 'Alex Kim', email: 'b@example.com' }]
      const { calls } = await drawnText(() => renderAgreementPDF({ ...COUPLE, signers }, W.weddingAgreementSections('wedding-short')))
      expect(calls.map((c) => c.text)).toContain(expected)
    }
  })
})
