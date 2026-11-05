// A family booking whose day went while the visitor was paying comes back from
// booking-checkout as 409 DAY_TAKEN. Both family pages must show that message
// and send the visitor back to pick again, not say "try again shortly".
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const catchBlock = (html) => {
  const i = html.indexOf("err.code === 'INVALID_DETAILS'")
  return html.slice(i, i + 900)
}

describe('DAY_TAKEN on the family booking pages', () => {
  it('book.html shows the server message and reloads that month and its times', () => {
    const b = catchBlock(read('book.html'))
    expect(b).toMatch(/err\.code === 'DAY_TAKEN'/)
    expect(b).toMatch(/showNotice\(err\.message, true\)/)
    expect(b).toMatch(/delete state\.availableDates\[/)
    expect(b).toMatch(/fetchAvailability\(/)
  })
  it('christmas-minis.html shows the server message and reloads the day’s slots', () => {
    const b = catchBlock(read('christmas-minis.html'))
    expect(b).toMatch(/err\.code === 'DAY_TAKEN'/)
    expect(b).toMatch(/showNotice\(err\.message, true\)/)
    expect(b).toMatch(/loadSlots\(\)/)
  })
})
