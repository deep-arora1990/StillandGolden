// Block markers (Task 5): parsed and validated, then stripped by the build.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { parse } from 'parse5'
const require = createRequire(import.meta.url)
const { parseBlocks, stripBlockMarkers, LIBRARY } = require('../../../../build/blocks.js')
const { renderPage } = require('../../../../build.js')

const ROOT = require('node:path').resolve(__dirname, '../../../..')
const src = 'a\n  <!-- block:text text-1 -->\n  <p>x</p>\n  <!-- /block -->\r\nb'

describe('block markers', () => {
  it('finds blocks with exact offsets', () => {
    const [b] = parseBlocks(src)
    expect(b.type).toBe('text'); expect(b.id).toBe('text-1')
    expect(src.slice(...b.inner)).toBe('\n  <p>x</p>\n  ')
    expect(src.slice(...b.open)).toBe('<!-- block:text text-1 -->')
    expect(src.slice(...b.close)).toBe('<!-- /block -->')
  })
  it('strips markers to the exact original bytes', () => {
    expect(stripBlockMarkers(src)).toBe('a\n  <p>x</p>\nb')
  })
  it('keeps inline markers\' neighbours and a marker at end of file', () => {
    expect(stripBlockMarkers('<p><!-- block:text a -->x<!-- /block --></p>')).toBe('<p>x</p>')
    expect(stripBlockMarkers('<!-- block:text a -->\nx\n<!-- /block -->')).toBe('x\n')
  })
  it.each([
    ['<!-- block:text a -->', /unclosed/], ['<!-- /block -->', /without an opening/],
    ['<!-- block:text a --><!-- block:text b --><!-- /block --><!-- /block -->', /nested/],
    ['<!-- block:Text a --><!-- /block -->', /type/],
    ['<!-- block:text A --><!-- /block -->', /id/],
    ['<!-- block:text --><!-- /block -->', /id/],
    ['<!-- block:text a --><!-- /block --><!-- block:text a --><!-- /block -->', /duplicate/],
    ['<!-- block:text a extra --><!-- /block -->', /malformed block marker "<!-- block:text a extra -->" on line 1/],
    ['x\n<!-- block text a --><!-- /block -->', /malformed block marker .* on line 2/],
    ['<!-- block:text a --><!-- /block extra -->', /malformed block marker "<!-- \/block extra -->"/],
  ])('refuses bad markers: %s', (html, msg) => { expect(() => parseBlocks(html)).toThrow(msg) })
  it('leaves ordinary comments alone', () => {
    expect(parseBlocks('<!-- blockquote note --><!-- blocks -->')).toEqual([])
  })
  it('names the line', () => {
    expect(() => parseBlocks('x\ny\n<!-- /block -->')).toThrow(/line 3/)
  })
  it('the build strips markers and refuses unknown types', () => {
    expect(renderPage('x.html', '<!-- block:text t -->\n<p>x</p>\n<!-- /block -->\n')).toBe('<p>x</p>\n')
    expect(() => renderPage('x.html', '<!-- block:carousel c --><!-- /block -->')).toThrow(/x\.html: unknown block type "carousel"/)
    expect(() => renderPage('x.html', '<!-- block:text t -->')).toThrow(/x\.html: .*unclosed/)
  })
  it('the library names all twenty-three types', () => {
    expect(Object.keys(LIBRARY.types).sort()).toEqual([
      'areas', 'box-list', 'buttons', 'caption', 'gallery', 'heading', 'intro', 'list', 'note', 'notice',
      'package', 'package-row-three', 'package-row-two', 'portfolio-intro', 'portrait', 'price', 'question', 'quote', 'signature',
      'signup', 'text', 'voucher-form', 'xmas-card'])
  })
  it('blocks/ and build/ are never published', () => {
    const { CONFIG } = require('../../../../build.js')
    expect(CONFIG.dirs).not.toContain('blocks')
    expect(CONFIG.dirs).not.toContain('build')
    expect(CONFIG.rootFiles.filter((f) => /^(blocks|build)\//.test(f))).toEqual([])
  })
})

const PAGES7 = [
  'packages/glimpse-mini-sessions.html', 'packages/golden-family-photography.html',
  'packages/golden-cake-smash-photography.html', 'packages/gathered-newborn-photography.html',
  'packages/bloom-maternity-newborn-photography.html',
  'offers/in-home-christmas-photos.html', 'offers/sunset-beach-mini-sessions.html',
]
const PAGES = ['about.html', 'packages.html', 'offers.html', 'gift-vouchers.html', ...PAGES7]

const find = (n, tag) => {
  if (n.tagName === tag) return n
  for (const c of n.childNodes || []) { const r = find(c, tag); if (r) return r }
  return null
}
const cls = (el) => (el.attrs.find((a) => a.name === 'class') || { value: '' }).value.split(/\s+/).filter(Boolean)
// What each block type may hold, as [tag, required class or null] per element.
const kind = (el) => {
  const c = cls(el)
  const id = (el.attrs.find((a) => a.name === 'id') || { value: '' }).value
  if (el.tagName === 'h2' && (el.childNodes || []).some((n) => n.tagName && cls(n).includes('xmas-open'))) return 'xmas-heading'
  if (el.tagName === 'div' && c.includes('pkg') && c.includes('xmas-card')) return 'xmas-card'
  if (el.tagName === 'div' && c.includes('pkg-row')) return 'package-row'
  if (el.tagName === 'div' && c.includes('pkg')) return 'package'
  if (el.tagName === 'div' && c.includes('portrait')) return 'portrait'
  if (el.tagName === 'div' && c.includes('sig')) return 'signature'
  if (el.tagName === 'div' && c.includes('areas')) return 'areas'
  if (el.tagName === 'div' && c.includes('notice') && id === 'cancelled') return 'voucher-cancelled'
  if (el.tagName === 'div' && c.includes('notice')) return 'notice'
  if (el.tagName === 'div' && c.includes('box')) return 'box-list'
  if (el.tagName === 'details' && c.includes('faq-item')) return 'question'
  if (el.tagName === 'section' && c.includes('signup')) return 'signup'
  if (el.tagName === 'div' && c.includes('confirm-box')) return 'voucher-bought'
  if (el.tagName === 'form' && id === 'voucher-form') return 'voucher-form-el'
  if (el.tagName === 'div' && c.includes('label')) return 'intro-label'
  if (el.tagName === 'h1') return 'intro-h1'
  if (el.tagName === 'p' && c.includes('lead')) return 'intro-lead'
  if (el.tagName === 'p' && !c.length) return 'text'
  if (el.tagName === 'h2') return 'heading'
  if (el.tagName === 'ul' && c.includes('list')) return 'list'
  if (el.tagName === 'div' && c.includes('gallery')) return 'gallery'
  if (el.tagName === 'p' && c.includes('caption')) return 'caption'
  if (el.tagName === 'figure' && c.includes('client-quote')) return 'quote'
  if (el.tagName === 'div' && c.includes('price-box')) return 'price'
  if (el.tagName === 'p' && c.includes('value-note')) return 'price-note'
  if (el.tagName === 'a' && c.includes('btn')) return 'buttons'
  if (el.tagName === 'p' && c.includes('note')) return 'note'
  return null
}
const ALLOWED = {
  intro: ['intro-label', 'intro-h1', 'intro-lead'], text: ['text'], heading: ['heading'], list: ['list'],
  gallery: ['gallery'], caption: ['caption'], quote: ['quote'], price: ['price', 'price-note'],
  buttons: ['buttons'], note: ['note'],
  portrait: ['portrait'], signature: ['signature'], areas: ['areas'], package: ['package'],
  notice: ['notice'], 'box-list': ['box-list'], question: ['question'],
  'xmas-card': ['xmas-heading', 'xmas-card'], signup: ['signup'],
  'voucher-form': ['voucher-bought', 'voucher-cancelled', 'voucher-form-el'],
  'package-row-two': ['package-row'], 'package-row-three': ['package-row'],
}

describe('eleven pages are marked into blocks', () => {
  it.each(PAGES)('%s', (page) => {
    const raw = fs.readFileSync(require('node:path').join(ROOT, page), 'utf8')
    const blocks = parseBlocks(raw)
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks[0].type).toBe('intro')
    expect(blocks.filter((b) => b.type === 'intro')).toHaveLength(1)
    // ids stay stable across edits, so they are not forced into page order
    for (const b of blocks) expect(b.id).toMatch(/^[a-z][a-z0-9-]*$/)
    const main = find(parse(raw, { sourceCodeLocationInfo: true }), 'main')
    const kids = main.childNodes.filter((n) => n.tagName)
    const owner = new Map()
    for (const el of kids) {
      const { startOffset: s, endOffset: e } = el.sourceCodeLocation
      const inside = blocks.filter((b) => s >= b.inner[0] && e <= b.inner[1])
      expect(inside, `<${el.tagName}> at ${s} in exactly one block`).toHaveLength(1)
      const k = kind(el)
      expect(k, `<${el.tagName}> at ${s} fits a type`).not.toBeNull()
      expect(ALLOWED[inside[0].type], `${k} inside ${inside[0].id}`).toContain(k)
      owner.set(el, inside[0])
    }
    // cardinality and order, per block
    const SHAPE = {
      intro: /^intro-label intro-h1 intro-lead$/, heading: /^heading$/, list: /^list$/, gallery: /^gallery$/,
      caption: /^caption$/, quote: /^quote$/, note: /^note$/, price: /^price( price-note)?$/,
      text: /^text( text)*$/, buttons: /^buttons( buttons)*$/,
      portrait: /^portrait$/, signature: /^signature$/, areas: /^areas$/, package: /^package$/,
      notice: /^notice$/, 'box-list': /^box-list$/, question: /^question$/, signup: /^signup$/,
      'xmas-card': /^xmas-heading xmas-card$/,
      'package-row-two': /^package-row$/, 'package-row-three': /^package-row$/,
      'voucher-form': /^voucher-bought voucher-cancelled voucher-form-el$/,
    }
    for (const b of blocks) {
      const mine = kids.filter((el) => owner.get(el) === b).map(kind)
      expect(mine.length, `${b.id} is not empty`).toBeGreaterThan(0)
      expect(mine.join(' '), `${b.id} shape`).toMatch(SHAPE[b.type])
    }
    // a text block is a run of plain <p>; a price note only follows a price-box
    kids.forEach((el, i) => { if (kind(el) === 'price-note') expect(kind(kids[i - 1])).toBe('price') })
    // no block is empty, and nothing but whitespace/comments sits outside blocks in <main>
    for (const b of blocks) expect([...owner.values()].includes(b), `${b.id} holds an element`).toBe(true)
    expect(stripBlockMarkers(raw)).not.toMatch(/<!--\s*\/?block/)
  })
})

// Block library (Task 7): one snippet per type, and field selectors that find
// the words, photos and links inside every real block and inside the snippet.
const { selectAll } = require('css-select')
const { parseDocument } = require('htmlparser2')
const inner = (html, b) => parseDocument(html.slice(...b.inner))
const TYPES = Object.keys(LIBRARY.types)

describe('block library', () => {
  it.each(TYPES)('%s: snippet holds exactly one block of its type, id <type>-new', (type) => {
    const entry = LIBRARY.types[type]
    expect(entry.label).toBeTruthy()
    if (entry.families.join() === 'portfolio') {
      expect(entry.addable).toBe(false)
      expect(entry.snippet).toBeUndefined()
      expect(entry.locked).toBeUndefined()
      return
    }
    expect(entry.families).toEqual(['site'])
    expect(entry.addable).toBe(type !== 'intro' && !entry.locked)
    if (entry.locked) {
      expect(entry.fields).toEqual([])
      expect(entry.hint).toBe('This part has a form or live switching in it, so a developer edits it. You can move it.')
      expect(entry.hint).not.toMatch(/—/)
      expect(entry.snippet).toBeUndefined()
      return
    }
    expect(entry.snippet).toBe(`blocks/site/${type}.html`)
    const html = fs.readFileSync(require('node:path').join(ROOT, entry.snippet), 'utf8')
    const blocks = parseBlocks(html)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe(type)
    expect(blocks[0].id).toBe(`${type}-new`)
    expect(html).not.toMatch(/\$\s*\d/)
    expect(html).not.toMatch(/—/)
    // the same shape the pages are held to
    const el = find(parse(html.slice(...blocks[0].inner)), 'body').childNodes.filter((n) => n.tagName)
    expect(el.length).toBeGreaterThan(0)
    for (const e of el) expect(ALLOWED[type], `${type}: ${kind(e)}`).toContain(kind(e))
  })

  it.each(TYPES)('%s: every field selector matches inside the snippet and every real block', (type) => {
    const entry = LIBRARY.types[type]
    if (entry.locked) return
    const check = (html, b, where) => {
      const dom = inner(html, b)
      for (const f of entry.fields) {
        const n = selectAll(f.selector, dom).length
        if (!f.optional) expect(n, `${where} ${b.id} field ${f.key}`).toBeGreaterThan(0)
        if (!f.repeat) expect(n, `${where} ${b.id} field ${f.key} is single`).toBeLessThanOrEqual(1)
        if (f.min !== undefined) expect(n, `${where} ${b.id} ${f.key} min`).toBeGreaterThanOrEqual(f.min)
        if (f.max !== undefined) expect(n, `${where} ${b.id} ${f.key} max`).toBeLessThanOrEqual(f.max)
      }
    }
    if (entry.snippet) {
      const snip = fs.readFileSync(require('node:path').join(ROOT, entry.snippet), 'utf8')
      for (const b of parseBlocks(snip)) check(snip, b, 'snippet')
    }
    let seen = 0
    for (const page of entry.families.join() === 'portfolio' ? ['portfolio.html'] : PAGES) {
      const raw = fs.readFileSync(require('node:path').join(ROOT, page), 'utf8')
      for (const b of parseBlocks(raw).filter((x) => x.type === type)) { check(raw, b, page); seen++ }
    }
    // the two package rows are new: no page holds one yet
    if (!/^package-row-/.test(type)) expect(seen).toBeGreaterThan(0)
  })

  // Studio's setRepeat trims and extends a repeat field by position, so its
  // matches must be one unbroken run: same parent, no other element between.
  it.each(TYPES)('%s: every repeat field is one unbroken run of siblings', (type) => {
    const entry = LIBRARY.types[type]
    const run = (html, b, where) => {
      const dom = inner(html, b)
      for (const f of entry.fields.filter((x) => x.repeat)) {
        const hits = selectAll(f.selector, dom)
        if (hits.length < 2) continue
        const parent = hits[0].parent
        for (const h of hits) expect(h.parent, `${where} ${b.id} ${f.key}: same parent`).toBe(parent)
        const els = parent.children.filter((c) => c.type === 'tag' || c.type === 'script' || c.type === 'style')
        const at = hits.map((h) => els.indexOf(h)).sort((x, y) => x - y)
        expect(at[at.length - 1] - at[0], `${where} ${b.id} ${f.key}: no element between`).toBe(hits.length - 1)
      }
    }
    if (entry.snippet) {
      const snip = fs.readFileSync(require('node:path').join(ROOT, entry.snippet), 'utf8')
      for (const b of parseBlocks(snip)) run(snip, b, 'snippet')
    }
    for (const page of [...PAGES, 'portfolio.html']) {
      const raw = fs.readFileSync(require('node:path').join(ROOT, page), 'utf8')
      for (const b of parseBlocks(raw).filter((x) => x.type === type)) run(raw, b, page)
    }
  })

  it('the pages list holds the eleven files in order, each in git', () => {
    const { execSync } = require('node:child_process')
    const tracked = execSync("git ls-files '*.html'", { cwd: ROOT }).toString().split('\n')
    expect(LIBRARY.pages.map((p) => p.file)).toEqual([
      'about.html', 'portfolio.html', 'packages.html',
      'packages/glimpse-mini-sessions.html', 'packages/golden-family-photography.html',
      'packages/golden-cake-smash-photography.html', 'packages/gathered-newborn-photography.html',
      'packages/bloom-maternity-newborn-photography.html',
      'offers.html', 'offers/sunset-beach-mini-sessions.html', 'offers/in-home-christmas-photos.html',
      'gift-vouchers.html'])
    for (const p of LIBRARY.pages) { expect(tracked).toContain(p.file); expect(p.label).toBeTruthy() }
    expect(LIBRARY.pages.filter((p) => p.kind).map((p) => [p.file, p.kind])).toEqual([['portfolio.html', 'portfolio']])
    expect(LIBRARY.pages.find((p) => p.file === 'portfolio.html').label).toBe('Portfolio')
  })

  it('portfolio.html: one portfolio-intro block around .port-header, mounts outside it', () => {
    const raw = fs.readFileSync(require('node:path').join(ROOT, 'portfolio.html'), 'utf8')
    const blocks = parseBlocks(raw)
    expect(blocks.map((b) => `${b.type} ${b.id}`)).toEqual(['portfolio-intro portfolio-intro-1'])
    const [b] = blocks
    const dom = inner(raw, b)
    expect(selectAll('div.port-header', dom)).toHaveLength(1)
    expect(raw.slice(...b.inner).trim().startsWith('<div class="port-header">')).toBe(true)
    for (const f of LIBRARY.types['portfolio-intro'].fields) expect(selectAll(f.selector, dom), f.key).toHaveLength(1)
    for (const m of ['<!-- include:portfolio-tabs -->', '<!-- include:portfolio-grid -->']) {
      const at = raw.indexOf(m)
      expect(at).toBeGreaterThan(-1)
      expect(at < b.open[0] || at >= b.close[1]).toBe(true)
    }
    expect(raw.match(/<!--\s*\/?block/g) || []).toHaveLength(2)
  })

  it('the library is version 1', () => { expect(LIBRARY.version).toBe(1) })

  it('field keys are unique within a type and kinds are known', () => {
    for (const t of TYPES) {
      const keys = LIBRARY.types[t].fields.map((f) => f.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const f of LIBRARY.types[t].fields) expect(['text', 'inline', 'image', 'link']).toContain(f.kind)
    }
  })
})

// Placeholder guard: the words in the blocks/site snippets are for the editor
// to offer, never for a live page. Strings are collected from the snippets so
// the list cannot drift. These also belong on real pages, so they are skipped
// (fixed list, so a placeholder pasted into a page is still caught).
const LEGIT_ON_PAGES = ['heading', 'From {{price.golden}}',
  'Glimpse', 'Golden', 'Gathered', 'From {{price.glimpse}}', 'From {{price.gathered}}', 'From', '{{price.golden}}']
const placeholders = () => {
  const path = require('node:path')
  const out = new Set()
  const walk = (n, inLink) => {
    // link labels are real defaults: mirrors Studio's placeholderWarnings (inline.js)
    const link = inLink || n.name === 'a'
    if (n.type === 'text' && !link && n.data.trim()) out.add(n.data.trim())
    if (n.attribs && n.attribs.alt) out.add(n.attribs.alt)
    ;(n.children || []).forEach((c) => walk(c, link))
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'blocks/site'))) {
    walk(parseDocument(fs.readFileSync(path.join(ROOT, 'blocks/site', f), 'utf8'), { decodeEntities: false }))
  }
  return [...out].filter((t) => !LEGIT_ON_PAGES.includes(t))
}
// The guard's check: every placeholder the page still holds.
const placeholderHits = (html, list) => list.filter((t) => html.includes(t))

describe('placeholder guard', () => {
  const path = require('node:path')
  const { execSync } = require('node:child_process')
  it('no page holds a snippet placeholder', () => {
    const list = placeholders()
    expect(list.length).toBeGreaterThan(10)
    const pages = execSync("git ls-files '*.html'", { cwd: ROOT }).toString().trim().split('\n')
      .filter((p) => !/^(blocks|brand|reel|print)\//.test(p))
    expect(pages.length).toBeGreaterThan(30)
    for (const p of pages) {
      const html = fs.readFileSync(path.join(ROOT, p), 'utf8')
      expect(placeholderHits(html, list), `${p} contains a placeholder`).toEqual([])
    }
  })
  it('link labels are real defaults, not placeholders', () => {
    const list = placeholders()
    for (const t of ['See Glimpse &rarr;', 'See Golden &rarr;', 'See Gathered &rarr;', 'Book this', 'Find out more',
      'Book directly', 'Enquire now']) expect(list).not.toContain(t)
  })
  // Pins the website guard to Studio's placeholderWarnings: a snippet whose
  // sample words are all filled in publishes, links and one-word text untouched.
  const ADDABLE = TYPES.filter((t) => LIBRARY.types[t].addable)
  it.each(ADDABLE)('%s: a filled-in snippet added to a page passes the guard', (type) => {
    const snip = fs.readFileSync(path.join(ROOT, LIBRARY.types[type].snippet), 'utf8')
    const edits = []
    const walk = (n, inLink) => {
      const link = inLink || n.name === 'a'
      if (n.type === 'text' && !link && n.data.trim().split(/\s+/).length >= 2) edits.push(n)
      ;(n.children || []).forEach((c) => walk(c, link))
    }
    walk(parseDocument(snip, { decodeEntities: false, withStartIndices: true, withEndIndices: true }), false)
    let filled = snip
    let n = 0
    for (const t of [...edits].sort((a, b) => b.startIndex - a.startIndex)) {
      filled = filled.slice(0, t.startIndex) + `Real copy here ${++n}` + filled.slice(t.startIndex + t.data.length)
    }
    // Studio flags a sample alt too, so the editor fills those in as well
    filled = filled.replace(/alt="[^"]*"/g, () => `alt="Real photo ${++n}"`)
    const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8')
    const at = about.indexOf('</main>')
    expect(at).toBeGreaterThan(0)
    const page = about.slice(0, at) + filled + about.slice(at)
    expect(parseBlocks(page).map((b) => b.id)).toContain(`${type}-new`)
    expect(placeholderHits(page, placeholders())).toEqual([])
  })
})
