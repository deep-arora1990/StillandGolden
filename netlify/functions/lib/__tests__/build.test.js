// The site build (build.js, A+ build 16 Oct 2026): price tokens from
// data/prices.json, the shared menu and footer, the slim bar, and the checks
// that stop a broken page from ever being published.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { priceToken, renderPage, pagePath } = require('../../../../build.js')

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
