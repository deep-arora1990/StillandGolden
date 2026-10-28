// The portfolio's photos live in data/portfolio.json (stage 3 of the Website
// tab, 29 Oct 2026). build/portfolio.js writes the tab buttons and the grid
// back into portfolio.html at build time, and Studio's preview runs the same
// code from /_cms/render.js, so the page must come out exactly as it was
// written by hand.
//
// Studio publishes change data/portfolio.json, so nothing here pins the live
// file's photos or counts: the byte-for-byte proof runs on a frozen copy of
// the data (fixtures/portfolio-29-oct-2026.json) against the markup the page
// had by hand that day, and the live data is only checked against itself.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const ROOT = path.resolve(__dirname, '../../../..')
const { renderTabs, renderGrid, checkPortfolio } = require('../../../../build/portfolio.js')
const { createRenderer } = require('../../../../build/render.js')
const { LIBRARY } = require('../../../../build/blocks.js')
const { CONFIG, renderPage } = require('../../../../build.js')

const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/portfolio.json'), 'utf8'))
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'))
const FROZEN = fixture('portfolio-29-oct-2026.json')
const HAND_WRITTEN = fixture('portfolio-29-oct-2026.markup.json')

const photo = (dir, name, ext, width, height, alt) => ({
  jpg: `New photos/${dir}/web/${name}.${ext}`,
  webp: `New photos/${dir}/webp/${name}.webp`,
  width, height, alt,
})
const SAMPLE = {
  version: 1,
  tabs: [
    {
      id: 'family', label: 'Family', folder: 'New photos/Family',
      caption: 'Family sessions &nbsp;&middot;&nbsp; South-east Melbourne',
      photos: [
        photo('Family', 'DSC09027 1', 'jpg', 1600, 1066, 'Two brothers on the playground'),
        photo('Family', 'DSC05197_websize', 'JPG', 1359, 1600, "Mum's picnic rug under the trees"),
      ],
    },
    {
      id: 'newborn', label: 'Newborn', folder: 'New photos/Newborn',
      caption: 'Newborn sessions &nbsp;&middot;&nbsp; In-home',
      photos: [photo('Newborn', 'DSC03381', 'jpg', 1600, 1067, 'Newborn asleep')],
    },
  ],
}
const INSTA = ' &nbsp;&middot;&nbsp; <a href="https://www.instagram.com/stillandgoldenphotography" target="_blank" rel="noopener">@stillandgoldenphotography</a></p>'

const clone = (o) => JSON.parse(JSON.stringify(o))
const sampleWith = (change) => { const d = clone(SAMPLE); change(d); return d }

describe('renderGrid', () => {
  it('writes the page\'s markup exactly', () => {
    expect(renderGrid(SAMPLE)).toBe(
      '<div id="tab-family" class="port-section visible">\n'
      + '      <div class="masonry">\n'
      + '    <div class="masonry-item reveal"><picture><source srcset="New%20photos/Family/webp/DSC09027%201.webp" type="image/webp"><img decoding="async" width="1600" height="1066" src="New%20photos/Family/web/DSC09027%201.jpg" alt="Two brothers on the playground"></picture></div>\n'
      + '    <div class="masonry-item reveal d1"><picture><source srcset="New%20photos/Family/webp/DSC05197_websize.webp" type="image/webp"><img decoding="async" width="1359" height="1600" src="New%20photos/Family/web/DSC05197_websize.JPG" alt="Mum\'s picnic rug under the trees" loading="lazy"></picture></div>\n'
      + '      </div>\n'
      + '      <p class="grid-caption">Family sessions &nbsp;&middot;&nbsp; South-east Melbourne' + INSTA + '\n'
      + '    </div>\n'
      + '\n'
      + '    <div id="tab-newborn" class="port-section">\n'
      + '      <div class="masonry">\n'
      + '    <div class="masonry-item reveal"><picture><source srcset="New%20photos/Newborn/webp/DSC03381.webp" type="image/webp"><img decoding="async" width="1600" height="1067" src="New%20photos/Newborn/web/DSC03381.jpg" alt="Newborn asleep"></picture></div>\n'
      + '      </div>\n'
      + '      <p class="grid-caption">Newborn sessions &nbsp;&middot;&nbsp; In-home' + INSTA + '\n'
      + '    </div>')
  })

  it('cycles reveal, d1, d2, d3 and loads only the first photo eagerly, starting again on each tab', () => {
    const d = sampleWith((d) => {
      const p = d.tabs[0].photos[1]
      d.tabs[0].photos = [0, 1, 2, 3, 4, 5].map(() => clone(p))
      d.tabs[1].photos = [0, 1].map(() => clone(p))
    })
    const items = renderGrid(d).split('\n').filter((l) => l.includes('masonry-item'))
    expect(items.map((l) => l.match(/class="masonry-item ([^"]+)"/)[1])).toEqual([
      'reveal', 'reveal d1', 'reveal d2', 'reveal d3', 'reveal', 'reveal d1',
      'reveal', 'reveal d1'])
    expect(items.map((l) => l.includes(' loading="lazy"'))).toEqual([
      false, true, true, true, true, true, false, true])
  })

  it('escapes a description so it stays one attribute', () => {
    const d = sampleWith((d) => { d.tabs[0].photos[0].alt = 'Mum & "Bub" <3' })
    expect(renderGrid(d)).toContain('alt="Mum &amp; &quot;Bub&quot; &lt;3"')
  })

  it('writes the 29 Oct 2026 data back byte for byte as the page had it by hand (frozen copy)', () => {
    expect(renderGrid(FROZEN)).toBe(HAND_WRITTEN.grid)
    expect(renderTabs(FROZEN)).toBe(HAND_WRITTEN.tabs)
    expect(FROZEN.tabs.map((t) => [t.id, t.photos.length])).toEqual([
      ['family', 56], ['motherhood', 36], ['fatherhood', 29], ['newborn', 77]])
  })

  it('writes every photo of the live data into the page, each tab with its button and section', () => {
    const page = fs.readFileSync(path.join(ROOT, 'portfolio.html'), 'utf8')
    expect(page).toContain('      <!-- include:portfolio-tabs -->')
    expect(page).toContain('    <!-- include:portfolio-grid -->')
    const out = renderPage('portfolio.html', page)
    const total = LIVE.tabs.reduce((n, t) => n + t.photos.length, 0)
    expect(out.match(/class="masonry-item/g)).toHaveLength(total)
    expect(out.match(/class="port-tab[ "]/g)).toHaveLength(LIVE.tabs.length)
    for (const t of LIVE.tabs) {
      expect(out, t.id).toContain(`data-tab="${t.id}"`)
      expect(out, t.id).toContain(`<div id="tab-${t.id}" class="port-section`)
      const section = out.slice(out.indexOf(`<div id="tab-${t.id}"`)).split('<p class="grid-caption">')[0]
      expect(section.match(/class="masonry-item/g), t.id).toHaveLength(t.photos.length)
    }
  })
})

describe('renderTabs', () => {
  it('marks only the first button active', () => {
    expect(renderTabs(SAMPLE)).toBe(
      '<button class="port-tab active" data-tab="family">Family</button>\n'
      + '      <button class="port-tab" data-tab="newborn">Newborn</button>')
  })
})

describe('checkPortfolio', () => {
  const refuses = (change, message) => {
    expect(() => checkPortfolio(sampleWith(change))).toThrow(message)
  }

  it('accepts today\'s data/portfolio.json', () => {
    expect(() => checkPortfolio(LIVE)).not.toThrow()
    expect(() => checkPortfolio(SAMPLE)).not.toThrow()
  })

  it('names the file in every refusal', () => {
    refuses((d) => { d.tabs[1].id = 'family' }, /^data\/portfolio\.json: /)
  })

  it('refuses a duplicate tab id', () => {
    refuses((d) => { d.tabs[1].id = 'family' }, /tab 2 \("family"\): the id "family" is used twice/)
  })

  it('refuses a tab id that cannot go in an id attribute as it is', () => {
    refuses((d) => { d.tabs[1].id = 'New born' }, /tab 2: the id must be lower-case letters, digits and hyphens/)
    refuses((d) => { d.tabs[1].id = 'x" onclick="y' }, /tab 2: the id/)
  })

  it('refuses a tab with no photos', () => {
    refuses((d) => { d.tabs[1].photos = [] }, /tab "newborn": no photos/)
  })

  it('refuses a jpg that is not in a web/ folder, or not .jpg or .JPG', () => {
    refuses((d) => { d.tabs[0].photos[1].jpg = 'New photos/Family/DSC05197_websize.JPG' }, /tab "family" photo 2: jpg/)
    refuses((d) => { d.tabs[0].photos[1].jpg = 'New photos/Family/web/DSC05197_websize.png' }, /tab "family" photo 2: jpg/)
    refuses((d) => { d.tabs[0].photos[1].jpg = 'New photos/Family/web/DSC05197_websize.Jpg' }, /tab "family" photo 2: jpg/)
    refuses((d) => { d.tabs[0].photos[1].jpg = 'web/DSC05197_websize.jpg' }, /tab "family" photo 2: jpg/)
  })

  it('accepts a photo from another tab\'s folder', () => {
    const d = sampleWith((d) => { d.tabs[1].photos.push(clone(d.tabs[0].photos[0])) })
    expect(() => checkPortfolio(d)).not.toThrow()
  })

  it('refuses a webp that is not the same name in the same parent\'s webp/ folder', () => {
    refuses((d) => { d.tabs[1].photos[0].webp = 'New photos/Newborn/webp/DSC03382.webp' }, /tab "newborn" photo 1: webp/)
    refuses((d) => { d.tabs[1].photos[0].webp = 'New photos/Family/webp/DSC03381.webp' }, /tab "newborn" photo 1: webp/)
    refuses((d) => { d.tabs[1].photos[0].webp = 'New photos/Newborn/web/DSC03381.webp' }, /tab "newborn" photo 1: webp/)
    refuses((d) => { d.tabs[1].photos[0].webp = 'New photos/Newborn/webp/DSC03381.WEBP' }, /tab "newborn" photo 1: webp/)
  })

  it('refuses a width or height that is not a whole number from 1 to 1600', () => {
    for (const bad of [0, 1601, 1066.5, '1066', -1, null]) {
      refuses((d) => { d.tabs[0].photos[0].width = bad }, /tab "family" photo 1: width/)
      refuses((d) => { d.tabs[0].photos[0].height = bad }, /tab "family" photo 1: height/)
    }
    expect(() => checkPortfolio(sampleWith((d) => { d.tabs[0].photos[0].width = 1 }))).not.toThrow()
  })

  it('refuses an empty description', () => {
    refuses((d) => { d.tabs[0].photos[1].alt = '' }, /tab "family" photo 2: no description/)
    refuses((d) => { d.tabs[0].photos[1].alt = '   ' }, /tab "family" photo 2: no description/)
  })

  it('refuses a photo still waiting to upload', () => {
    refuses((d) => { d.tabs[1].photos[0].jpg = 'upload:abc123' }, /tab "newborn" photo 1: .*upload:/)
    refuses((d) => { d.tabs[1].photos[0].webp = 'New photos/Newborn/webp/upload:abc.webp' }, /tab "newborn" photo 1: .*upload:/)
    refuses((d) => { d.tabs[1].photos[0].jpg = 'New photos/Newborn/web/upload:abc.jpg'; d.tabs[1].photos[0].webp = 'New photos/Newborn/webp/upload:abc.webp' }, /tab "newborn" photo 1: .*upload:/)
  })
})

describe('renderPage and the portfolio mounts', () => {
  const page = fs.readFileSync(path.join(ROOT, 'portfolio.html'), 'utf8')

  it('fills the mounts from the live data', () => {
    const out = renderPage('portfolio.html', page)
    expect(out).toContain(`src="${encodeURI(LIVE.tabs[0].photos[0].jpg)}"`)
    expect(out).not.toMatch(/include:portfolio/)
  })

  it('uses the data it is given instead of the live data', () => {
    const out = renderPage('portfolio.html', page, { portfolio: SAMPLE })
    expect(out).toContain('src="New%20photos/Family/web/DSC09027%201.jpg"')
    expect(out).toContain('<button class="port-tab" data-tab="newborn">Newborn</button>')
    expect(out).not.toContain('data-tab="motherhood"')
    expect(out).not.toContain(encodeURI(LIVE.tabs[0].photos[0].jpg))
  })

  it('refuses a page with a mount and no data', () => {
    const { renderPage: noData } = createRenderer({
      prices: {}, chrome: CONFIG.chrome, mounts: CONFIG.mounts, unlinked: [], library: LIBRARY,
    })
    expect(() => noData('x.html', '<div><!-- include:portfolio-grid --></div>')).toThrow('x.html: no portfolio data')
    expect(() => noData('x.html', '<div><!-- include:portfolio-tabs --></div>')).toThrow('x.html: no portfolio data')
    expect(noData('x.html', '<p>no mounts</p>')).toBe('<p>no mounts</p>')
  })
})
