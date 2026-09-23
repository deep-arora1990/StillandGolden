import { describe, it, expect } from 'vitest'
const { ttlForMonth, isFresh, MINUTE } = require('../availability-ttl')

const today = { year: 2026, month: 9, day: 24 }

describe('ttlForMonth', () => {
  it('keeps this month and next for 15 minutes', () => {
    expect(ttlForMonth(2026, 9, today)).toBe(15 * MINUTE)
    expect(ttlForMonth(2026, 10, today)).toBe(15 * MINUTE)
  })
  it('keeps the following two months for 2 hours', () => {
    expect(ttlForMonth(2026, 11, today)).toBe(120 * MINUTE)
    expect(ttlForMonth(2026, 12, today)).toBe(120 * MINUTE)
  })
  it('keeps anything further out for 24 hours', () => {
    expect(ttlForMonth(2027, 1, today)).toBe(24 * 60 * MINUTE)
    expect(ttlForMonth(2027, 9, today)).toBe(24 * 60 * MINUTE)
  })
  // Year boundaries are where month arithmetic goes wrong.
  it('counts across the new year correctly', () => {
    const dec = { year: 2026, month: 12, day: 1 }
    expect(ttlForMonth(2027, 1, dec)).toBe(15 * MINUTE)   // next month
    expect(ttlForMonth(2027, 3, dec)).toBe(120 * MINUTE)  // three ahead
    expect(ttlForMonth(2027, 4, dec)).toBe(24 * 60 * MINUTE)
  })
})

describe('isFresh', () => {
  it('is fresh inside the window and stale after it', () => {
    const now = 1_000_000_000
    expect(isFresh({ fetchedAt: now - 14 * MINUTE }, 15 * MINUTE, now)).toBe(true)
    expect(isFresh({ fetchedAt: now - 16 * MINUTE }, 15 * MINUTE, now)).toBe(false)
  })
  it('treats a missing or malformed entry as stale', () => {
    expect(isFresh(null, 15 * MINUTE)).toBe(false)
    expect(isFresh({}, 15 * MINUTE)).toBe(false)
    expect(isFresh({ fetchedAt: 'yesterday' }, 15 * MINUTE)).toBe(false)
  })
})
