// The private wedding questionnaire /wedding-questionnaire: every question
// verbatim from the function's QUESTIONS, no consent block, kept private.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { scannedPages } from './copy-rules.js'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
async function fresh(rel) { vi.resetModules(); return import(rel) }

describe('the wedding questionnaire page', () => {
  const html = read('wedding-questionnaire.html')
  it('asks every question, verbatim, under the five headings', async () => {
    const mod = await fresh('../../submit-wedding-questionnaire.js')
    const _test = mod._test || mod.default._test
    const flat = html.replace(/&#39;|&rsquo;/g, "'")
    for (const q of _test.QUESTIONS) { expect(html).toContain(`name="${q.key}"`); expect(flat).toContain(q.label) }
    for (const h of ['The basics', 'You two', 'The day', 'Your people', 'Must-haves']) expect(html).toContain(`<div class="form-section-heading">${h}</div>`)
  })
  it('has no image consent question', () => { expect(html).not.toMatch(/image_consent|Faceless|permission to share|consent/i) })
  it('getting ready only for The whole shebang', () => { expect(html).toMatch(/['"]wedding-short['"][\s\S]{0,200}gettingReady|gettingReady[\s\S]{0,200}['"]wedding-short['"]/) })
  it('is private and keeps the copy rules', () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">'); expect(html).not.toContain('site-tags.js')
    expect(html).toContain('<meta name="referrer" content="no-referrer">')
    expect(read('robots.txt')).toMatch(/Disallow: \/wedding-questionnaire\n[\s\S]*Disallow: \/wedding-questionnaire\.html/)
    expect(read('sitemap.xml')).not.toContain('wedding-questionnaire')
    expect(scannedPages().filter((f) => f !== 'wedding-questionnaire.html' && read(f).includes('href="/wedding-questionnaire'))).toEqual([])
    expect(html).not.toMatch(/—|&mdash;|\p{Extended_Pictographic}|\$\s?\d/u)
    expect(html).toContain('submit-wedding-questionnaire'); expect(html).not.toContain("'/.netlify/functions/submit-questionnaire'")
  })
  it('never sends a partner email', () => { expect(html).not.toMatch(/partnerEmail|p2/) })
})
