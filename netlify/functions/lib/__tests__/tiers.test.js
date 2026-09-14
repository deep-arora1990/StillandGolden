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
const { TIERS } = require('../setmore')

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
