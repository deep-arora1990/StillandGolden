// The wedding agreement page /wedding-agreement: says what the signed PDF says,
// both partners sign, and it stays private.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { scannedPages } from './copy-rules.js'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
async function fresh(mod) { vi.resetModules(); return await import(mod) }

describe('the wedding agreement page', () => {
  const html = read('wedding-agreement.html')
  const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim()
  const section = (h) => { const i = html.indexOf(`<h2>${h}</h2>`); return html.slice(i, html.indexOf('</div>', i)) }
  const ps = (s) => (s.match(/<p>[\s\S]*?<\/p>/g) || []).map(text)

  it('says word for word what the signed PDF says', async () => {
    const W = await fresh('../wedding-agreement.js')
    for (const s of W.SHARED_SECTIONS) expect(ps(section(s.title.replace('&', '&amp;'))), s.title).toEqual(s.paras)
    expect(ps(section("What's Included")).slice(1)).toEqual(W.INCLUDED_COMMON)
    for (const k of ['wedding-short', 'wedding-full']) expect(text(html)).toContain(W.PACKAGE_COVERS[k])
  })
  it('takes prices from prices.json and keeps the copy rules', () => {
    expect(html).toContain('{{price.wedding-short}}'); expect(html).toContain('{{price.wedding-full}}')
    expect(html).not.toMatch(/\$\s?\d/)
    expect(html).not.toMatch(/—|&mdash;|\p{Extended_Pictographic}/u)
    expect(html).not.toMatch(/7 days|seven days|nine days|sneak peek|image_consent|Faceless/i)
  })
  it('both partners sign: two names, two emails, two required ticks', () => {
    for (const id of ['p1name', 'p1email', 'p2name', 'p2email']) expect(html).toMatch(new RegExp(`id="${id}"[^>]*required`))
    expect(html.match(/type="checkbox"[^>]*required/g)).toHaveLength(2)
    expect(html).toContain('submit-wedding-agreement'); expect(html).toMatch(/partners:\s*\[/)
    expect(html).not.toContain('submit-contract')
  })
  it('is private: noindex, no site tags, robots-disallowed, out of the sitemap, unlinked', () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).toContain('<meta name="referrer" content="no-referrer">')
    expect(html).not.toContain('site-tags.js')
    expect(read('robots.txt')).toMatch(/Disallow: \/wedding-agreement\n[\s\S]*Disallow: \/wedding-agreement\.html/)
    expect(read('sitemap.xml')).not.toContain('wedding-agreement')
    expect(scannedPages().filter((f) => f !== 'wedding-agreement.html' && read(f).includes('href="/wedding-agreement'))).toEqual([])
  })
  it('a link that is missing, or for a family session, shows the fresh-link message', () => {
    expect(html).toMatch(/\^wedding-/); expect(html).toContain("This link has expired or isn't quite right. Reply to your booking email and I'll send you a fresh one.")
  })
})
