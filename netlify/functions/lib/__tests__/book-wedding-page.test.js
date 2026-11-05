// The private wedding booking page /book-wedding: kept out of search and
// analytics, prices from prices.json, and the link token sent to every
// server step.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { scannedPages } from './copy-rules.js'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

describe('the wedding booking page', () => {
  const html = read('book-wedding.html')
  it('is private: noindex, out of the sitemap, robots-disallowed, untracked, unlinked', () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).not.toContain('site-tags.js')
    expect(read('sitemap.xml')).not.toContain('book-wedding')
    expect(read('robots.txt')).toMatch(/Disallow: \/book-wedding\n[\s\S]*Disallow: \/book-wedding\.html/)
    expect(read('netlify.toml')).toMatch(/from = "\/book-wedding\.html"\s+to = "\/book-wedding"\s+status = 301\s+force = true/)
    const linkers = scannedPages().filter((f) => f !== 'book-wedding.html' && read(f).includes('href="/book-wedding'))
    expect(linkers).toEqual([])
  })
  it('takes prices from prices.json and keeps the copy rules', () => {
    expect(html).toContain('{{price.wedding-short}}'); expect(html).toContain('{{price.wedding-full}}')
    expect(html).not.toMatch(/\$\s?\d/)
    expect(html).not.toMatch(/—|&mdash;|\p{Extended_Pictographic}/u)
    expect(html).not.toMatch(/7 days|seven days|nine days/i)
    expect(html).toContain('4 weeks later')
  })
  it('sends the link to every server step, and returns here', () => {
    for (const fn of ['wedding-link-check', 'booking-availability', 'booking-slots', 'booking-checkout', 'voucher-balance']) expect(html).toContain(fn)
    expect(html).toMatch(/weddingLink:/); expect(html).toContain("returnTo: '/book-wedding.html'")
    expect(html).toMatch(/['"]&t=['"]\s*\+\s*encodeURIComponent/)
  })
  it('never leaks the link token through the referrer', () => {
    expect(html).toContain('<meta name="referrer" content="no-referrer">')
  })
  it('turns a failed fetch into an error with no browser message', () => {
    const fn = html.match(/function networkFailure\([\s\S]*?\n    }\n/)
    expect(fn).toBeTruthy()
    const networkFailure = new Function(fn[0] + '; return networkFailure')()
    const e = networkFailure(new TypeError('Failed to fetch'))
    expect(e.network).toBe(true); expect(e.message).toBe('')
    expect(html).toMatch(/fetch\(FN \+ path, opts\)\.catch\(function \(e\) \{ throw networkFailure\(e\); \}\)/)
  })
  it('guards slot races, stale caches, bfcache and past dates', () => {
    expect(html).toContain('if (state.date !== iso || !state.pkg) return;')
    expect(html).toContain("addEventListener('pageshow'")
    expect(html).toContain('e.persisted')
    expect(html).toMatch(/id="details-heading" tabindex="-1"/)
  })
  it('/book still looks 12 months ahead', () => { expect(read('book.html')).toContain('var MAX_MONTHS_AHEAD = 12;') })
})
