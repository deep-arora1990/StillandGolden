// Local preview only: SETMORE_MOCK_FULL marks mock days as fully booked, so
// the sold-out versions of the Christmas minis can be reviewed without Setmore.
import { describe, it, expect, afterEach, vi } from 'vitest'

async function mockLib(full) {
  vi.resetModules()
  process.env.SETMORE_MOCK = '1'
  if (full) process.env.SETMORE_MOCK_FULL = full; else delete process.env.SETMORE_MOCK_FULL
  return await import('../setmore.js')
}
afterEach(() => { delete process.env.SETMORE_MOCK; delete process.env.SETMORE_MOCK_FULL })

describe('mock mode, fully booked days', () => {
  it('every minis time is free by default', async () => {
    const { TIERS, getFixedScheduleSlots } = await mockLib()
    expect((await getFixedScheduleSlots(TIERS['christmas-minis'], '2026-11-08')).length).toBe(15)
  })
  it('a listed day has nothing free', async () => {
    const { TIERS, getFixedScheduleSlots } = await mockLib('2026-11-08')
    expect(await getFixedScheduleSlots(TIERS['christmas-minis'], '2026-11-08')).toEqual([])
  })
})
