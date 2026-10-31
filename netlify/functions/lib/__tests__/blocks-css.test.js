// About, packages, offers, gift vouchers and the package and offer pages share
// one stylesheet (/blocks.css) and carry no inline styles, so a block added to
// any of them looks the same everywhere.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const ROOT = path.resolve(__dirname, '../../../..')
const { CONFIG } = require('../../../../build.js')

const PAGES = [
  'about.html',
  'packages.html',
  'offers.html',
  'gift-vouchers.html',
  'packages/glimpse-mini-sessions.html',
  'packages/golden-family-photography.html',
  'packages/golden-cake-smash-photography.html',
  'packages/gathered-newborn-photography.html',
  'packages/bloom-maternity-newborn-photography.html',
  'offers/in-home-christmas-photos.html',
  'offers/sunset-beach-mini-sessions.html',
]
const POSTS = [
  'blog/how-i-bring-the-studio-to-your-house.html',
  'blog/how-much-does-newborn-photography-cost.html',
  'blog/how-to-choose-a-smash-cake.html',
  'blog/preparing-your-home-newborn-session.html',
  'blog/what-happens-at-a-cake-smash-session.html',
  'blog/what-happens-at-a-family-session.html',
  'blog/what-happens-at-a-maternity-session.html',
  'blog/what-happens-at-a-newborn-session.html',
  'blog/what-happens-at-an-outdoor-mini-session.html',
  'blog/what-to-wear-family-photo-session.html',
  'blog/when-to-book-newborn-photos.html',
]
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

describe('blocks.css', () => {
  it.each([...PAGES, ...POSTS])('%s uses the shared block styles and nothing inline', (f) => {
    const html = read(f)
    expect(html).toMatch(/<link rel="stylesheet" href="\/site\.css">\s*<link rel="stylesheet" href="\/blocks\.css">/)
    expect(html).not.toMatch(/<style[\s>]/)
    expect(html).not.toMatch(/\sstyle="/)
  })
  it.each(POSTS)('%s reads at the article width', (f) => {
    expect(read(f)).toMatch(/<main class="article">/)
  })
  it('post rules never style a bare figure', () => {
    expect(read('blocks.css')).not.toMatch(/(^|[\s,}])figure\s*[{,]/m)
  })
  it('blocks.css is published', () => { expect(CONFIG.rootFiles).toContain('blocks.css') })
})
