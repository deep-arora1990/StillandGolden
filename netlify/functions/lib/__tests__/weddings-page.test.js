// The /weddings page: block order, prices from prices.json, copy rules, wiring.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { parseBlocks } = require('../../../../build/blocks.js')

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

describe('the Weddings page', () => {
  const html = read('weddings.html')
  it('is built from site blocks in the agreed order, with no hero', () => {
    expect(parseBlocks(html).map((b) => b.type)).toEqual([
      'intro', 'text', 'gallery', 'caption', 'heading', 'package-row-two', 'heading', 'box-list',
      'heading', 'list', 'photo-pair', 'heading', 'areas', 'heading', 'question', 'question',
      'question', 'cta-box'])
  })
  it('takes its prices from prices.json', () => {
    expect(html).toContain('{{price.wedding-short}}')
    expect(html).toContain('{{price.wedding-full}}')
    expect(html).not.toMatch(/\$\s?700|\$\s?1,?000/)
  })
  it('keeps the copy rules', () => {
    expect(html).not.toMatch(/—|&mdash;/)
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(html).not.toMatch(/Hey, I'm Deep|road trip/)
    expect(html).toContain('Short &amp; sweet')
    expect(html).toContain('The whole shebang')
    expect(html).toContain('South-east Melbourne &middot; Mornington Peninsula &middot; Inner Melbourne &middot; City registry office')
  })
  it('is wired in like every public page', () => {
    expect(html).toContain('<script src="/site-tags.js"></script>')
    expect(html).toContain('<link rel="canonical" href="https://stillandgolden.com.au/weddings">')
    expect(html).toContain('href="/?enquire=wedding#contact"')
    expect(read('netlify.toml')).toMatch(/from = "\/weddings\.html"\s+to = "\/weddings"\s+status = 301\s+force = true/)
    expect(read('sitemap.xml')).toContain('<loc>https://stillandgolden.com.au/weddings</loc>')
  })
  it('links the caption to the Weddings tab, and texts via sms', () => {
    expect(html).toContain('<a href="/portfolio#weddings">')
    expect(html.match(/<a href="sms:\+61426834359">Text me<\/a>/g)).toHaveLength(2)
    expect(read('index.html')).toContain('tel:+61426834359')
    expect(html).toContain('Yep, if your wedding\'s more than 5 weeks away. Pay half when you book and the rest 4 weeks later, or pay it all upfront and get it out of the way.')
  })
})
