// The site build (build.js, A+ build 16 Oct 2026): price tokens from
// data/prices.json, the shared menu and footer, the slim bar, and the checks
// that stop a broken page from ever being published.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const ROOT = path.resolve(__dirname, '../../../..')
const { CONFIG, priceToken, renderPage, pagePath, referencedFiles, publishable, checkLinks } = require('../../../../build.js')

describe('price tokens', () => {
  it('session price, gallery, valued-at and halves, as shown and as bare numbers', () => {
    expect(priceToken('price.golden')).toBe('$395')
    expect(priceToken('price.golden.number')).toBe('395')
    expect(priceToken('price.golden.gallery')).toBe('$175')
    expect(priceToken('price.glimpse')).toBe('$295')
    expect(priceToken('price.glimpse.gallery')).toBe('$175')
    expect(priceToken('price.gathered')).toBe('$450')
    expect(priceToken('price.bloom')).toBe('$795')
    expect(priceToken('price.bloom.half')).toBe('$397.50')
    expect(priceToken('price.golden.half')).toBe('$197.50')
    expect(priceToken('price.christmas-minis.half')).toBe('$75')
    expect(priceToken('price.in-home-christmas.valued')).toBe('$470')
    expect(priceToken('price.sunset-beach-minis.number')).toBe('295')
  })

  it('a session with its full gallery added, to compare with Gathered', () => {
    expect(priceToken('price.glimpse.withgallery')).toBe('$470')
    expect(priceToken('price.golden.withgallery')).toBe('$570')
    expect(() => priceToken('price.gathered.withgallery')).toThrow(/not set for gathered/)
  })

  it('refuses a misspelt tier or a value the tier does not have', () => {
    expect(() => priceToken('price.goldn')).toThrow(/unknown tier/)
    expect(() => priceToken('price.bloom.gallery')).toThrow(/not set for bloom/)
    expect(() => priceToken('price.golden.discount')).toThrow()
  })
})

describe('pages', () => {
  it('fills tokens, and stops the build on anything left unfilled', () => {
    expect(renderPage('x.html', '<p>From {{price.golden}}</p>')).toBe('<p>From $395</p>')
    expect(() => renderPage('x.html', '<p>{{price.nope}}</p>')).toThrow(/x\.html.*unknown tier/)
    expect(() => renderPage('x.html', '<p>{{ golden }}</p>')).toThrow(/unfilled/)
    expect(() => renderPage('x.html', '<!-- include:sidebar -->')).toThrow(/unfilled/)
  })

  it('writes the menu into the page, marking where you are', () => {
    const html = renderPage('packages/golden-family-photography.html', '<nav id="nav" data-sg-nav></nav>')
    expect(html).toContain('<a href="/packages" class="active" aria-current="page">Packages</a>')
    expect(html).toContain('<a href="/#contact" class="book">Enquire now</a>')
    expect(html).toContain('id="menu-close"')
    const blog = renderPage('blog/index.html', '<nav id="nav" data-sg-nav></nav>')
    expect(blog).toContain('<a href="/blog/" class="active" aria-current="page">Blog</a>')
  })

  it('writes the footer, and the slim bar on form pages (with an optional back link)', () => {
    expect(renderPage('a.html', '<footer data-sg-footer></footer>')).toContain('ABN 37 280 912 036')
    expect(renderPage('contract.html', '<!-- include:bar -->')).toContain('&larr; Back to site')
    expect(renderPage('christmas-minis-terms.html', '<!-- include:bar back="/christmas-minis" label="Back to Christmas minis" -->'))
      .toContain('<a href="/christmas-minis">&larr; Back to Christmas minis</a>')
    expect(renderPage('contract.html', '<!-- include:bar-footer -->')).toMatch(/<footer>[\s\S]*Still &amp; Golden/)
  })

  it('stops the build if anything links to the SEO-only cake smash page', () => {
    expect(() => renderPage('index.html', '<a href="/packages/golden-cake-smash-photography">x</a>')).toThrow(/SEO-only/)
    expect(() => renderPage('packages/golden-cake-smash-photography.html', '<a href="/packages/golden-cake-smash-photography">x</a>')).not.toThrow()
  })

  it('knows each page\'s address', () => {
    expect(pagePath('index.html')).toBe('/')
    expect(pagePath('blog/index.html')).toBe('/blog/')
    expect(pagePath('offers/in-home-christmas-photos.html')).toBe('/offers/in-home-christmas-photos')
  })
})

describe('published photos', () => {
  it('finds every local file a page points to, decoded', () => {
    const refs = referencedFiles(`
      <source srcset="/New%20photos/Family/webp/DSC09027%201.webp" type="image/webp">
      <img src="/New%20photos/Family/web/DSC09027%201.jpg">
      <img srcset="/Images/a.jpg 1x, /Images/b.JPG 2x">
      <div style="background:url('/Images/hero.jpg')"></div>
      <meta property="og:image" content="https://stillandgolden.com.au/og-image.jpg">
      <script type="application/ld+json">{"image": "https://stillandgolden.com.au/Images/christmas-minis-hero.jpg"}</script>
      <img src="https://fonts.gstatic.com/x.png"><a href="/packages">x</a>`)
    expect([...refs].sort()).toEqual([
      'Images/a.jpg', 'Images/b.JPG', 'Images/christmas-minis-hero.jpg', 'Images/hero.jpg',
      'New photos/Family/web/DSC09027 1.jpg', 'New photos/Family/webp/DSC09027 1.webp', 'og-image.jpg',
    ])
  })
  it('publishes web/ and webp/ copies and anything referenced, never camera originals', () => {
    const refs = new Set(['Images/christmas-minis-hero.jpg'])
    expect(publishable('New photos/Family/web/DSC02307.jpg', refs)).toBe(true)
    expect(publishable('New photos/Family/webp/DSC02307.webp', refs)).toBe(true)
    expect(publishable('New photos/Family/DSC02307.jpg', refs)).toBe(false)
    expect(publishable('Images/christmas-minis-hero.jpg', refs)).toBe(true)
    expect(publishable('Images/DSC03550.jpg', refs)).toBe(false)
    expect(publishable('blog/index.html', refs)).toBe(true)
  })
  // Every page links this icon; it was tracked but never published, so it 404ed.
  it('publishes the apple touch icon', () => {
    expect(CONFIG.rootFiles).toContain('apple-touch-icon.png')
  })
  it('stops on a link whose case differs from the published file', () => {
    const published = new Set(['New photos/Family/web/DSC05234_websize.JPG'])
    const page = (p) => new Map([['packages/x.html', new Set([p])]])
    expect(() => checkLinks(page('New photos/Family/web/DSC05234_websize.jpg'), published))
      .toThrow("packages/x.html: points to New photos/Family/web/DSC05234_websize.jpg, which isn't published")
    expect(() => checkLinks(page('New photos/Family/web/DSC05234_websize.JPG'), published)).not.toThrow()
  })
  it('resolves page-relative references against the page folder', () => {
    expect([...referencedFiles('<img src="New%20photos/homepage-2_websize.JPG">')]).toEqual(['New photos/homepage-2_websize.JPG'])
    expect([...referencedFiles('<img src="../Images/x.jpg"><img src="./y.png">', 'blog/x.html')].sort())
      .toEqual(['Images/x.jpg', 'blog/y.png'])
  })
  it('ignores references inside HTML comments', () => {
    expect([...referencedFiles('<!-- <img src="Images/your-photo.jpg"> --><style>/* <img src="Images/x.jpg"> */</style><img src="/Images/real.jpg">')]).toEqual(['Images/real.jpg'])
  })
})

describe('checks workflow', () => {
  it('never publishes the workflow folder', () => {
    expect(CONFIG.rootFiles.some((f) => f.startsWith('.github'))).toBe(false)
    expect(CONFIG.dirs).not.toContain('.github')
  })
  it('a checks workflow runs the tests and the build', () => {
    const y = fs.readFileSync(path.join(ROOT, '.github/workflows/checks.yml'), 'utf8')
    expect(y).toMatch(/^name: checks$/m)
    expect(y).toMatch(/node-version: '22'/)
    expect(y).toMatch(/npx vitest run/)
    expect(y).toMatch(/node build\.js/)
    expect(y).toMatch(/^permissions:\n  contents: read$/m)
    expect(y).toMatch(/timeout-minutes: 10/)
  })
  it('keeps the photo the Christmas minis email links directly', () => {
    expect(CONFIG.keepImages).toContain('Images/christmas-minis-hero.jpg')
  })
})
