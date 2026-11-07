// Christmas minis come down at 5pm on the mini day (Deep, 7 Nov 2026).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const END = '2026-11-08T17:00:00+11:00'

describe('Christmas minis come down at 5pm on Sunday 8 November', () => {
  it('is 5pm Melbourne time (06:00 UTC)', () => {
    expect(Date.parse(END)).toBe(Date.UTC(2026, 10, 8, 6, 0, 0))
  })
  it('site.js flags the page after that time and blocks.css hides the offer', () => {
    expect(read('site.js')).toContain(`var XMAS_OVER_AT = '${END}';`)
    expect(read('site.js')).toContain("document.documentElement.setAttribute('data-xmas-over', '')")
    expect(read('blocks.css')).toMatch(/html\[data-xmas-over\] \.pkg\.xmas-card,\s*html\[data-xmas-over\] h2:has\(> \.xmas-open\) \{ display: none !important; \}/)
  })
  it('/christmas-minis sends visitors to /offers after that time, before anything else loads', () => {
    const head = read('christmas-minis.html').split('<head>')[1]
    expect(head.trimStart().startsWith(`<script>if (Date.now() >= Date.parse('${END}')) location.replace('/offers');</script>`)).toBe(true)
  })
  it('only /offers still links to /christmas-minis', () => {
    for (const f of ['offers/sunset-beach-mini-sessions.html', 'offers/in-home-christmas-photos.html', 'index.html'])
      expect(read(f), f).not.toContain('href="/christmas-minis"')
  })
})
