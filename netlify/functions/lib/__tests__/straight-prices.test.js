// Straight prices (Deep, 4 Nov 2026): each session has one price, so the site
// says "Golden $395", not "From $395". "from" stays only where a line sums up
// several sessions at once ("Glimpse, Golden, Gathered and Bloom, from $295"),
// because there it means the cheapest of them. Gift vouchers keep "From $100":
// that's a minimum amount, not a session price.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { copyRule, scannedPages } from './copy-rules.js'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
// Live pages, plus the block snippets and the blog template that new pages
// and blocks are made from.
const SOURCES = scannedPages().concat(
  execSync('git ls-files "blocks/site/*.html" blog/_template.html', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean),
)

// Lines that sum up several sessions keep "from".
const SUMMARIES = [
  'Glimpse, Golden, Gathered and Bloom, from {{price.glimpse}}',
  'In-home newborn and family photography from {{price.glimpse}}',
  'sessions from {{price.glimpse}}',
]

const SINGLE = /(?:\S+\s+){0,4}\bfrom\s+\{\{price\.(?:glimpse|golden|gathered|bloom)\}\}/gi

describe('straight prices', () => {
  it('no single session price says "from"', () => {
    const offenders = []
    for (const f of SOURCES) {
      for (const m of read(f).matchAll(SINGLE)) {
        if (SUMMARIES.some((s) => m[0].endsWith(s) || s.endsWith(m[0].trim()))) continue
        offenders.push({ page: f, found: m[0].trim() })
      }
    }
    copyRule('single-price-from', offenders)
  })

  it('the summary lines that keep "from" are still there (so the list above stays honest)', () => {
    const all = SOURCES.map(read).join('\n')
    for (const s of SUMMARIES) expect(all, s).toContain(s)
  })

  it('price boxes and cards have no FROM label', () => {
    const labelled = SOURCES.filter((f) => read(f).includes('class="from"'))
    expect(labelled).toEqual([])
  })

  it('Google sees a fixed price, not a minimum', () => {
    const ranged = SOURCES.filter((f) => /"(minPrice|lowPrice)"/.test(read(f)))
    expect(ranged).toEqual([])
  })
})
