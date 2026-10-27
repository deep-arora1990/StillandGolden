// One service area everywhere (Deep, 18 Oct 2026). The Google Business Profile
// became a service-area business with twenty suburbs led by Cranbourne East,
// and the coach's audit asks the site and the profile to tell the same location
// story (p367, p536). Frankston stays in the list, it just no longer leads.
// Real places stay as they are: the beach minis at Frankston, Seaford and
// Carrum, the outdoor-minis post's parks, and where a photo was taken.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const PAGES = execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/^(brand|reel|print|blocks)\//.test(f))

// The Google profile's service areas, plus the council and the city.
const AREA = [
  'Cranbourne East', 'Cranbourne', 'Cranbourne North', 'Cranbourne West', 'Botanic Ridge',
  'Clyde', 'Clyde North', 'Berwick', 'Narre Warren', 'Narre Warren South', 'Hampton Park',
  'Lynbrook', 'Officer', 'Pakenham', 'Carrum', 'Chelsea', 'Seaford', 'Frankston',
  'Langwarrin', 'Mornington',
]

describe('service area matches the Google profile', () => {
  it('no page offers Mt Eliza any more (Mornington replaced it), except where a photo was taken', () => {
    for (const f of PAGES) {
      const text = read(f).replace(/alt="[^"]*"/g, '')
      expect(text, f).not.toMatch(/Mt Eliza|Mount Eliza/)
    }
  })

  it('no page leads its location with Frankston', () => {
    for (const f of PAGES) {
      const text = read(f)
      expect(text, f).not.toMatch(/(&middot;|across) Frankston &amp; South-East Melbourne|Cranbourne, Frankston &amp;|Cranbourne, Frankston and|Cranbourne &amp; Frankston|Cranbourne & Frankston|travel across Frankston|across Frankston, Chelsea/)
    }
  })

  it('the shared footer on every page starts from Cranbourne East, without Mt Eliza', () => {
    const chrome = read('build/site-chrome.js')
    const area = chrome.match(/footer-area">([^<]*)</)[1]
    expect(area).toMatch(/^Cranbourne East/)
    expect(area).toMatch(/Officer/)
    expect(area).not.toMatch(/Mt Eliza/)
  })

  it('no doubled-up place names', () => {
    for (const f of PAGES) expect(read(f), f).not.toMatch(/Cranbourne, Cranbourne East|Narre Warren, Cranbourne East/)
  })

  it('every suburb list starts from Cranbourne East and names Officer and Pakenham', () => {
    for (const f of PAGES) {
      for (const m of read(f).matchAll(/Clyde North(?:,| &middot;)[^<"]*/g)) {
        const list = m[0]
        if (!/Berwick/.test(list)) continue
        expect(list, `${f}: ${list}`).toMatch(/Officer/)
        expect(list, `${f}: ${list}`).toMatch(/Pakenham/)
      }
    }
  })

  it('structured data lists the same areas on every page that has them (the beach minis keep their beaches)', () => {
    for (const f of PAGES.filter((p) => p !== 'offers/sunset-beach-mini-sessions.html')) {
      const page = read(f)
      const block = page.match(/"areaServed": \[([\s\S]*?)\]/)
      if (!block) continue
      const names = [...block[1].matchAll(/"name": "([^"]+)"/g)].map((m) => m[1])
      expect(names.filter((n) => n !== 'City of Casey' && n !== 'Melbourne').sort(), f).toEqual([...AREA].sort())
      expect(names, f).toContain('City of Casey')
    }
  })

  it('the homepage travel question is answered with the new list', () => {
    const page = read('index.html')
    expect(page).toMatch(/<summary>Which suburbs do you travel to\?<\/summary>/)
    expect(page).toMatch(/"name": "Which suburbs do you travel to\?"/)
    expect(page).not.toMatch(/"text": "Yes\. Still & Golden is based in Cranbourne East/)
    expect(page).not.toMatch(/<p>Yes\. I&rsquo;m based in Cranbourne East/)
  })
})
