// Deep, 18 Oct 2026: show how many Google reviews sit behind the 5.0 (the
// coach's audit, p297: a rating means more with its count), and on the
// packages page let the four sessions come first, with the seasonal offers
// after them rather than in front of them.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

describe('Google review count', () => {
  it('the homepage gives the number of reviews beside the 5.0', () => {
    expect(read('index.html')).toMatch(/>5\.0<\/div>\s*<div[^>]*>Across 13 Google reviews, every one five stars\.<\/div>/)
  })
})

describe('packages page order', () => {
  it('the seasonal offers callout comes after the last package, before "Always included"', () => {
    const page = read('packages.html')
    const offers = page.indexOf('<a href="/offers">See the seasonal offers</a>')
    const bloom = page.indexOf('<a href="/book?service=bloom" class="btn">Book Bloom</a>')
    const always = page.indexOf('<h2>Always <em>included</em></h2>')
    expect(offers).toBeGreaterThan(-1)
    expect(offers).toBeGreaterThan(bloom)
    expect(offers).toBeLessThan(always)
  })
})

describe('packages page agrees with the audit work', () => {
  it('the rough guide sends newborns to Gathered, not Golden', () => {
    const guide = read('packages.html').match(/<p>A rough guide:.*?<\/p>/s)[0]
    expect(guide).not.toMatch(/Golden<\/strong>[^,]*newborn/)
    expect(guide).toMatch(/<strong>Gathered<\/strong> for newborns/)
  })

  it('the travel line starts from Cranbourne East and names Officer', () => {
    const travel = read('packages.html').match(/<li><strong>Travel included<\/strong>.*?<\/li>/s)[0]
    expect(travel).toMatch(/from Cranbourne East/)
    expect(travel).toMatch(/Officer/)
  })
})
