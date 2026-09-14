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

const { splitCheckoutParams, todayInMelbourne } = require('../deposits')

describe('splitCheckoutParams', () => {
  const tier = { name: 'Christmas Mini', serviceKey: 'svc_1', priceCents: 15000, depositCents: 7500, sessionMinutes: 15, durationMinutes: 25 }
  const plan = balancePlan(tier, '2026-12-25', '2026-10-02')
  const params = splitCheckoutParams(tier, plan, { date: '2026-12-25', time: '10:30', firstName: 'Tara', lastName: 'Smith' })

  it('charges the deposit, not the full price', () => {
    expect(params.line_items[0].price_data.unit_amount).toBe(7500)
  })

  it('is a weekly subscription so the second payment is seven days later', () => {
    expect(params.mode).toBe('subscription')
    expect(params.line_items[0].price_data.recurring).toEqual({ interval: 'week' })
  })

  it('tells the customer the balance amount, the date, and that nothing follows it', () => {
    const d = params.line_items[0].price_data.product_data.description
    expect(d).toContain('$75.00')
    expect(d).toContain('2026-10-09')
    expect(d).toMatch(/nothing is charged after it/i)
  })

  it('describes the subscription so it can be found in the Stripe dashboard', () => {
    // Cancelling a charge means finding this subscription among others.
    expect(params.subscription_data.description).toBe('Christmas Mini — 2026-12-25 at 10:30 — Tara Smith')
    expect(params.subscription_data.metadata).toMatchObject({
      service_key: 'svc_1', date: '2026-12-25', time: '10:30', pay_mode: 'split',
    })
  })

  it('never sets customer_creation, which subscription mode rejects', () => {
    expect(params).not.toHaveProperty('customer_creation')
  })
})

describe('todayInMelbourne', () => {
  it('uses the Melbourne date, not the UTC one', () => {
    // 2026-10-02T22:00Z is already 3 October in Melbourne (UTC+10). Using UTC
    // here would let a booking through the cutoff a day early.
    expect(todayInMelbourne(new Date('2026-10-02T22:00:00Z'))).toBe('2026-10-03')
  })

  it('returns YYYY-MM-DD', () => {
    expect(todayInMelbourne(new Date('2026-06-01T03:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

const { subscriptionCancelAt, CANCEL_AFTER_DAYS, BALANCE_AFTER_DAYS } = require('../deposits')

describe('subscriptionCancelAt', () => {
  const deposit = Date.parse('2026-10-02T09:00:00Z')

  it('lands after the second charge and before a third', () => {
    const cancelAt = subscriptionCancelAt(deposit)
    const secondCharge = deposit / 1000 + BALANCE_AFTER_DAYS * 86400
    const thirdCharge = deposit / 1000 + 14 * 86400
    expect(cancelAt).toBeGreaterThan(secondCharge)
    expect(cancelAt).toBeLessThan(thirdCharge)
  })

  it('leaves at least some room for Stripe to retry a declined second charge', () => {
    // Deliberately short (2 days, Deep's call 14 Sep): a card that would have
    // recovered later is chased by hand instead. Cancelling ON the second
    // charge would be the bug — no retry window at all.
    expect(CANCEL_AFTER_DAYS - BALANCE_AFTER_DAYS).toBeGreaterThanOrEqual(2)
  })

  it('returns whole seconds, which is what Stripe wants', () => {
    expect(Number.isInteger(subscriptionCancelAt(deposit))).toBe(true)
  })
})
