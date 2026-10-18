// The Bloom booking card (coach's audit, p89; Deep, 19 Oct 2026). It read
// "90 minutes · Two 90-minute sessions", saying the length twice and never
// what you get. Bloom is two sessions with the full gallery at both, and the
// date booked online is the first of them.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

process.env.SETMORE_API_KEY = process.env.SETMORE_API_KEY || 'test'
const ROOT = path.resolve(__dirname, '../../../..')
const { TIERS } = require('../setmore.js')

const services = async () => {
  const { handler } = require('../../booking-services.js')
  return JSON.parse((await handler({ httpMethod: 'GET' })).body).services
}

// The booking page's own wording function, run as the page runs it.
const lengthLabel = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'book.html'), 'utf8')
  const fn = src.match(/function lengthLabel\(s\) \{[\s\S]*?\n    \}/)
  if (!fn) return () => 'missing'
  return new Function(fn[0] + '; return lengthLabel')()
})()

describe('the Bloom card', () => {
  it('says two sessions once, and the full gallery at both', async () => {
    const bloom = (await services()).find((s) => s.tier === 'bloom')
    expect(bloom.sessions).toBe(2)
    expect(bloom.includes).toBe('Full gallery at both sessions')
    const card = lengthLabel(bloom) + ' · ' + bloom.includes
    expect(card).toBe('Two 90-minute sessions · Full gallery at both sessions')
  })

  it('leaves the one-session cards as they were', async () => {
    const golden = (await services()).find((s) => s.tier === 'golden')
    expect(golden.sessions).toBe(1)
    expect(lengthLabel(golden) + ' · ' + golden.includes).toBe('60 minutes · 20 edited images')
  })

  it('the booking page uses that wording on the card, its label and the summary', () => {
    const src = fs.readFileSync(path.join(ROOT, 'book.html'), 'utf8')
    expect(src).not.toMatch(/s\.durationMinutes \+ ' min(utes)? · '/)
    expect(src).not.toMatch(/state\.service\.durationMinutes \+ ' min · '/)
  })

  it('a Bloom gift voucher says two sessions and the full gallery', async () => {
    const { voucherPdf } = require('../voucher-delivery.js')
    const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/voucher-delivery.js'), 'utf8')
    expect(src).toMatch(/Two \$\{t\.durationMinutes\}-minute sessions, full gallery at both/)
    expect(typeof voucherPdf).toBe('function')
  })

  it('the confirmation email calls the booked date the first of two sessions', () => {
    const { valuesFromBooking } = require('../booking-confirmation.js')
    const v = valuesFromBooking({ firstName: 'A', date: '2026-11-21', time: '10:00', notes: '' }, TIERS.bloom)
    expect(v.sessionLength).toBe('First of two 90-minute sessions')
    expect(v.includes).toBe('Full gallery at both sessions')
    expect(valuesFromBooking({ firstName: 'A', date: '2026-11-21', time: '10:00', notes: '' }, TIERS.golden).sessionLength).toBe('60-minute session')
  })
})
