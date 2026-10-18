// Two ways in from the website (Deep, 19 Oct 2026): send an enquiry or book
// directly. DMs on Instagram stay a normal way to book too, so captions can
// keep saying so. The coach's audit (p90) asked for one decision so the calls
// to action stop arguing; this is it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const PAGES = execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/^(brand|reel|print)\//.test(f))

describe('enquire or book', () => {
  it('the homepage contact section offers booking online as well as the form', () => {
    const contact = read('index.html').split('<section id="contact">')[1].split('</section>')[0]
    expect(contact).toContain('id="enquiry-form"')
    expect(contact).toMatch(/href="\/book"/)
  })

  it('every blog post that ends on an enquiry button also offers booking online', () => {
    for (const f of PAGES.filter((p) => p.startsWith('blog/') && p !== 'blog/index.html')) {
      const box = read(f).split('class="cta-box"')[1]
      if (!box || !box.includes('href="/#contact"')) continue
      expect(box.split('</div>')[0], f).toMatch(/href="\/book\?service=(golden|gathered|glimpse|bloom)"/)
    }
  })

  it('no button says Book but opens the enquiry form', () => {
    for (const f of PAGES) expect(read(f), f).not.toMatch(/href="\/#contact"[^>]*>\s*Book/)
  })
})
