// describe/it/expect come from vitest's globals — see vitest.config.mjs.
const { balancePlan } = require('../deposits')
const { TIERS } = require('../setmore')

// A tier shaped like the real ones, so these tests don't break every time a
// price changes. The real tiers are exercised by the invariants at the bottom.
const splitTier = { name: 'Example', priceCents: 15000, depositCents: 7500 }
const fullOnlyTier = { name: 'No split', priceCents: 15000 }

describe('balancePlan', () => {
  it('charges the balance seven days after the deposit', () => {
    expect(balancePlan(splitTier, '2026-11-08', '2026-10-02')).toEqual({
      eligible: true,
      chargeOn: '2026-10-09',
      depositCents: 7500,
      balanceCents: 7500,
    })
  })

  it('allows a session exactly nine days away', () => {
    // 30 Oct + 9 = 8 Nov. Balance on 6 Nov, two clear days before the session.
    const plan = balancePlan(splitTier, '2026-11-08', '2026-10-30')
    expect(plan.eligible).toBe(true)
    expect(plan.chargeOn).toBe('2026-11-06')
  })

  it('refuses a session eight days away', () => {
    // The balance would land the day before the session — no runway to chase
    // a declined card.
    expect(balancePlan(splitTier, '2026-11-08', '2026-10-31')).toEqual({
      eligible: false,
      reason: 'too-close',
    })
  })

  it('refuses a session in the past', () => {
    expect(balancePlan(splitTier, '2026-11-08', '2026-11-09').reason).toBe('too-close')
  })

  it('refuses a tier that does not offer the split', () => {
    expect(balancePlan(fullOnlyTier, '2026-11-08', '2026-10-02')).toEqual({
      eligible: false,
      reason: 'not-offered',
    })
  })

  // Melbourne moves to daylight saving on 4 October 2026. Adding seven days by
  // local-time arithmetic across that boundary lands an hour out, which can
  // roll the date. The dates here are calendar dates, so the maths must be done
  // in UTC and never touch a local timezone.
  it('adds seven calendar days across the daylight saving boundary', () => {
    expect(balancePlan(splitTier, '2026-12-25', '2026-10-01').chargeOn).toBe('2026-10-08')
    expect(balancePlan(splitTier, '2026-12-25', '2026-10-03').chargeOn).toBe('2026-10-10')
  })

  it('adds seven calendar days across a month boundary', () => {
    expect(balancePlan(splitTier, '2026-12-25', '2026-09-28').chargeOn).toBe('2026-10-05')
  })

  it('splits an odd amount without losing or inventing a cent', () => {
    const odd = { name: 'Odd', priceCents: 19501, depositCents: 9751 }
    const plan = balancePlan(odd, '2026-12-25', '2026-10-01')
    expect(plan.depositCents + plan.balanceCents).toBe(19501)
  })
})

describe('deposit amounts on the real tiers', () => {
  it('is exactly half the price wherever a split is offered', () => {
    for (const [name, tier] of Object.entries(TIERS)) {
      if (!tier.depositCents) continue
      expect(tier.depositCents * 2, `${name} deposit is not half of priceCents`)
        .toBe(tier.priceCents)
    }
  })
})
