// Block markers (Task 5): parsed and validated, then stripped by the build.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const ROOT = path.resolve(__dirname, '../../../..')
const { parseBlocks, stripBlockMarkers, LIBRARY } = require('../../../../build/blocks.js')
const { renderPage } = require('../../../../build.js')

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
  ])('refuses bad markers: %s', (html, msg) => { expect(() => parseBlocks(html)).toThrow(msg) })
  it('names the line', () => {
    expect(() => parseBlocks('x\ny\n<!-- /block -->')).toThrow(/line 3/)
  })
  it('the build strips markers and refuses unknown types', () => {
    expect(renderPage('x.html', '<!-- block:text t -->\n<p>x</p>\n<!-- /block -->\n')).toBe('<p>x</p>\n')
    expect(() => renderPage('x.html', '<!-- block:carousel c --><!-- /block -->')).toThrow(/x\.html: unknown block type "carousel"/)
    expect(() => renderPage('x.html', '<!-- block:text t -->')).toThrow(/x\.html: .*unclosed/)
  })
  it('the library names all ten types', () => {
    expect(Object.keys(LIBRARY.types).sort()).toEqual(['buttons', 'caption', 'gallery', 'heading', 'intro', 'list', 'note', 'price', 'quote', 'text'])
  })
  it('blocks/ and build/ are never published', () => {
    expect(fs.existsSync(path.join(ROOT, 'dist'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'dist/blocks'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'dist/build'))).toBe(false)
  })
})
