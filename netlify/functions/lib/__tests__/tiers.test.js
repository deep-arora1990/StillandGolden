// Invariants on the tier config itself. No network, no Stripe, no Setmore.
//
// These exist because booking-checkout.js resolves a tier by its Setmore
// serviceKey and takes the FIRST match:
//
//   Object.entries(TIERS).find(([, t]) => t.serviceKey === serviceKey)
//
// so two tiers sharing a key makes the later one unreachable — silently. That
// happened on 14 Sep 2026: the xmas-test tier was written reusing the minis'
// key, and every request for it resolved to christmas-minis instead and was
// rejected against that tier's allowedDates. Nothing errored; the tier simply
// did not work.

// describe/it/expect come from vitest's globals — see vitest.config.js.
import { copyRule, scannedPages } from './copy-rules.js'
const { TIERS, WEDDING_TIER_KEYS } = require('../setmore')

describe('tier config', () => {
  it('gives every tier its own Setmore service key', () => {
    const byKey = new Map()
    for (const [name, tier] of Object.entries(TIERS)) {
      const clash = byKey.get(tier.serviceKey)
      if (clash) {
        throw new Error(
          `"${name}" and "${clash}" share serviceKey ${tier.serviceKey}. ` +
          'booking-checkout resolves tiers by key and takes the first match, ' +
          `so "${name}" would be unreachable.`
        )
      }
      byKey.set(tier.serviceKey, name)
    }
    expect(byKey.size).toBe(Object.keys(TIERS).length)
  })

  it('gives every tier a service key at all', () => {
    for (const [name, tier] of Object.entries(TIERS)) {
      expect(tier.serviceKey, `${name} has no serviceKey`).toBeTruthy()
      expect(typeof tier.serviceKey, `${name}.serviceKey is not a string`).toBe('string')
    }
  })

  it('keeps priceFrom and priceCents in step', () => {
    for (const [name, tier] of Object.entries(TIERS)) {
      expect(tier.priceCents, `${name}.priceCents`).toBe(tier.priceFrom * 100)
    }
  })

  it('only gives fixed-date tiers an allowedDates list, and never an empty one', () => {
    for (const [name, tier] of Object.entries(TIERS)) {
      if (!('allowedDates' in tier)) continue
      expect(Array.isArray(tier.allowedDates), `${name}.allowedDates`).toBe(true)
      expect(tier.allowedDates.length, `${name}.allowedDates is empty`).toBeGreaterThan(0)
    }
  })
})

describe('test-only tiers', () => {
  it('marks the 25 December test tier as test-only', () => {
    // Its page ships with the site and production uses the LIVE Stripe key, so
    // booking-checkout refuses it when CONTEXT=production. Losing this flag
    // would make a real charge for a session that does not exist possible.
    expect(TIERS['xmas-test'].testOnly).toBe(true)
  })

  it('leaves the $1 verification tier bookable in production', () => {
    // Deliberately live: it exists to verify the real payment chain after an
    // incident (BOOKING.md, Ops runbook).
    expect(TIERS.test.testOnly).toBeUndefined()
  })

  it('never marks a customer-facing tier as test-only', () => {
    for (const [name, tier] of Object.entries(TIERS)) {
      if (tier.hidden) continue
      expect(tier.testOnly, `${name} is customer-facing and must not be test-only`).toBeUndefined()
    }
  })
})

// Glimpse is up to 30 minutes and Golden up to an hour (Deep, 17 Oct 2026,
// reversing the 1 Oct lengthening). The booking code writes these lengths into
// Setmore, and "up to N minutes" on a page only ever describes these two
// tiers, so every such figure on the site must be one of them.
describe('session lengths', () => {
  it('books Glimpse for 30 minutes and Golden for 60', () => {
    expect(TIERS.glimpse.durationMinutes).toBe(30)
    expect(TIERS.golden.durationMinutes).toBe(60)
  })

  it('never quotes a Glimpse or Golden length on a page that the booking code does not book', () => {
    const fs = require('fs')
    const path = require('path')
    const { execFileSync } = require('child_process')
    const root = path.resolve(__dirname, '../../../..')
    const pages = scannedPages()
    const allowed = [TIERS.glimpse.durationMinutes, TIERS.golden.durationMinutes]
    const wrong = []
    for (const f of pages) {
      const html = fs.readFileSync(path.join(root, f), 'utf8')
      for (const m of html.matchAll(/up to (\d+)[ -]min/gi)) {
        if (!allowed.includes(Number(m[1]))) wrong.push({ page: f, found: m[0] })
      }
      for (const m of html.matchAll(/up to (forty-five|ninety|an hour and a half)/gi)) wrong.push({ page: f, found: m[0] })
    }
    copyRule('session-lengths', wrong)
  })
})

describe('wedding tiers', () => {
  it('two packages, 3 and 6 hours, date only, priced from prices.json', () => {
    expect(TIERS['wedding-short']).toMatchObject({ name: 'Short & sweet', durationMinutes: 180, priceCents: 70000, depositCents: 35000,
      wedding: true, fixedSchedule: true, timeTbc: true, slotTimes: ['10:00'], balanceAfterWeeks: 4, splitMinNoticeDays: 35, lengthLabel: '3 hours' })
    expect(TIERS['wedding-full']).toMatchObject({ name: 'The whole shebang', durationMinutes: 360, priceCents: 100000, depositCents: 50000,
      wedding: true, lengthLabel: '6 hours' })
    expect(WEDDING_TIER_KEYS).toEqual(['wedding-short', 'wedding-full'])
  })
  it("are not hidden, so Studio's send buttons can reach them in stage 3", () => {
    for (const k of WEDDING_TIER_KEYS) { expect(TIERS[k].hidden).toBeUndefined(); expect(TIERS[k].testOnly).toBeUndefined() }
  })
  it('stay off /book', async () => {
    const { handler } = require('../../booking-services.js')
    const tiers = JSON.parse((await handler({ httpMethod: 'GET' })).body).services.map((s) => s.tier)
    expect(tiers).not.toContain('wedding-short'); expect(tiers).not.toContain('wedding-full')
  })
  it('are not sold as gift vouchers', () => {
    const { PACKAGE_TIERS, validatePurchase } = require('../vouchers')
    expect(PACKAGE_TIERS).toEqual(['glimpse', 'golden', 'gathered', 'bloom'])
    expect(validatePurchase({ kind: 'package', tier: 'wedding-short', buyerName: 'A', buyerEmail: 'a@example.com', recipientName: 'R' }, TIERS).ok).toBe(false)
  })
})
