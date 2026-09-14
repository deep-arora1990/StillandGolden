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

const { subscriptionCancelAt } = require('../deposits')

// A subscription as Stripe returns it: weekly periods, the period living on the
// item (where current API versions put it).
const WEEK = 7 * 86400
const startedAt = Date.parse('2026-09-14T11:00:00Z') / 1000
const subscription = {
  current_period_start: startedAt,
  current_period_end: startedAt + WEEK,
  items: { data: [{ current_period_start: startedAt, current_period_end: startedAt + WEEK }] },
}

describe('subscriptionCancelAt', () => {
  it('lands exactly on a period boundary, never inside one', () => {
    // The whole point. Stripe prorates a shortened final period: a cancel_at
    // mid-period made the second invoice $21.43 instead of $75 in test mode on
    // 14 Sep 2026, so the customer would have paid $96.43 for a $150 session.
    const cancelAt = subscriptionCancelAt(subscription)
    expect((cancelAt - startedAt) % WEEK).toBe(0)
  })

  it('ends after the second charge and before a third', () => {
    const cancelAt = subscriptionCancelAt(subscription)
    expect(cancelAt).toBe(startedAt + 2 * WEEK)
    expect(cancelAt).toBeGreaterThan(startedAt + WEEK)   // the second charge
  })

  it('prefers the item period over the subscription-level one', () => {
    // Current API versions carry the period on the item; the subscription-level
    // field is a fallback for older ones. If both are present the item wins.
    const mixed = {
      current_period_start: startedAt - 999, current_period_end: startedAt + 999,
      items: { data: [{ current_period_start: startedAt, current_period_end: startedAt + WEEK }] },
    }
    expect(subscriptionCancelAt(mixed)).toBe(startedAt + 2 * WEEK)
  })

  it('falls back to the subscription-level period when there is no item', () => {
    expect(subscriptionCancelAt({ current_period_start: startedAt, current_period_end: startedAt + WEEK }))
      .toBe(startedAt + 2 * WEEK)
  })

  it('refuses to guess when the period is missing', () => {
    // Better to alert and cap by hand than to invent a boundary and prorate.
    expect(() => subscriptionCancelAt({})).toThrow(/billing period/)
  })

  it('returns whole seconds, which is what Stripe wants', () => {
    expect(Number.isInteger(subscriptionCancelAt(subscription))).toBe(true)
  })
})
