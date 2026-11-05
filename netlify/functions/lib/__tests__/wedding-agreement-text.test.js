// Stage 3, Task 1: the wedding agreement wording lives in one module.
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

function fresh() {
  vi.resetModules()
  const W = require('../wedding-agreement')
  const { TIERS, WEDDING_TIER_KEYS } = require('../setmore')
  const { splitRule } = require('../deposits')
  return { W, TIERS, WEDDING_TIER_KEYS, splitRule }
}

const all = (W, k) => { const s = W.weddingAgreementSections(k); return [s.title, ...s.sections.flatMap((x) => [x.title, ...x.paras])].join('\n') }

describe('wedding agreement wording', () => {
  it('one agreement per wedding package, naming the package and its hours', () => {
    const { W } = fresh()
    expect(W.weddingAgreementSections('wedding-short').title).toBe('Wedding Photography Agreement')
    expect(W.weddingAgreementSections('wedding-short').sections.map((s) => s.title))
      .toEqual(["What's Included", 'Payment Terms', 'Cancellation & Rescheduling', 'Image Usage & Rights', 'General'])
    expect(W.packageLine('wedding-short')).toMatch(/^Package booked: Short & sweet, 3 hours of wedding photography\./)
    expect(W.packageLine('wedding-full')).toMatch(/^Package booked: The whole shebang, 6 hours of wedding photography\..*getting ready/)
  })

  it('never falls back to Golden', () => {
    const { W } = fresh()
    for (const k of ['golden', 'glimpse', 'sunset-beach-minis', '', 'wedding', undefined]) {
      expect(() => W.weddingAgreementSections(k)).toThrow(/Not a wedding package/)
      expect(() => W.packageLine(k)).toThrow(/Not a wedding package/)
    }
  })

  it('the wording keeps the money rules and the copy rules', () => {
    const { W, TIERS, WEDDING_TIER_KEYS, splitRule } = fresh()
    for (const k of WEDDING_TIER_KEYS) {
      const t = all(W, k), rule = splitRule(TIERS[k])
      expect(t).toContain(`the other half ${rule.inWords} later`)
      expect(rule.minNoticeDays).toBe(35); expect(t).toContain('at least 5 weeks away')
      expect(t).toContain('within 4 weeks of the wedding')
      expect(t).toContain("at least 14 days (2 weeks) before the wedding date, everything you've paid is refunded in full")
      expect(t).toContain('fewer than 14 days before the wedding date, half the fee is refunded')
      expect(t).toContain("The photographer doesn't send a replacement.")
      expect(t).toContain('a handful of dates'); expect(t).toContain('measured from the original wedding date')
      expect(t).toContain('just let me know before the wedding')
      expect(t).toContain('South-east Melbourne, the Mornington Peninsula, Inner Melbourne and the City registry office')
      expect(t).toContain('laws of Victoria, Australia')
      expect(t).not.toMatch(/\$\s?\d|—|&mdash;|\p{Extended_Pictographic}/u)
      expect(t).not.toMatch(/7 days|seven days|nine days|sneak peek|Faceless|session/i)
    }
  })

  it('the gallery stays online for 3 months, never 2', () => {
    const { W, WEDDING_TIER_KEYS } = fresh()
    expect(W.INCLUDED_COMMON[0].endsWith('Your gallery stays online for 3 months from delivery, so download your favourites early.')).toBe(true)
    for (const k of WEDDING_TIER_KEYS) {
      expect(all(W, k)).toContain('Your gallery stays online for 3 months from delivery, so download your favourites early.')
      expect(all(W, k)).not.toMatch(/2 months|two months/i)
    }
  })

  it('the source file itself has no em dash or emoji', () => {
    expect(read('netlify/functions/lib/wedding-agreement.js')).not.toMatch(/—|&mdash;|\p{Extended_Pictographic}/u)
  })
})
