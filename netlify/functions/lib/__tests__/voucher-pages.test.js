// The gift voucher pages: buying one at /gift-vouchers, and using one on the
// booking page. Prices come from prices.json through tokens, like every page.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

describe('/gift-vouchers', () => {
  const page = () => read('gift-vouchers.html')

  it('sells the four sessions at their token prices, or an amount from $100', () => {
    const p = page()
    for (const t of ['glimpse', 'golden', 'gathered', 'bloom']) {
      expect(p).toContain(`value="${t}"`)
      expect(p).toContain(`{{price.${t}}}`)
    }
    expect(p).toMatch(/<input[^>]*id="v-amount"[^>]*min="100"/)
    expect(p).not.toMatch(/\$(295|395|450|795)\b/)
    // Only the radio buttons are hidden; the amount box must stay visible.
    expect(p).not.toMatch(/\.choice input \{[^}]*opacity: 0/)
    const css = read('blocks.css')
    expect(css).toMatch(/#voucher-form \.choice input\[type="radio"\] \{[^}]*opacity: 0/)
    expect(css).not.toMatch(/\.amount-row input \{[^}]*opacity: 0/)
  })

  it('asks who it is for and where to send it, and posts to voucher-checkout', () => {
    const p = page()
    for (const id of ['v-recipient', 'v-message', 'v-buyer-name', 'v-buyer-email']) expect(p).toContain(`id="${id}"`)
    expect(p).toMatch(/maxlength="240"/)
    expect(p).toContain("'/.netlify/functions/voucher-checkout'")
  })

  it('states the terms that matter: three years, covers the session, leftovers stay on the code', () => {
    const p = page()
    expect(p).toMatch(/three years/)
    expect(p).toMatch(/even if (my )?prices (change|go up)/)
    expect(p).toMatch(/stays on the code/)
  })

  it('starts with nothing chosen', () => {
    expect(page()).not.toMatch(/<input[^>]*name="what"[^>]*checked/)
    expect(page()).toMatch(/<input type="radio" name="what" value="golden">/)
  })

  it('thanks the buyer like a booking does: the form makes way for a confirmation box', () => {
    const p = page()
    expect(p).toMatch(/get\('bought'\)/)
    expect(p).toMatch(/<div class="confirm-box" id="bought"[^>]*hidden>/)
    expect(p).toMatch(/<div class="tick">Payment received\.<\/div>/)
    expect(p).toMatch(/form\.hidden = true/)
  })

  it('is reachable: clean URL, sitemap, footer, packages and Glimpse pages', () => {
    expect(read('netlify.toml')).toMatch(/from = "\/gift-vouchers\.html"\s+to = "\/gift-vouchers"/)
    expect(read('sitemap.xml')).toContain('<loc>https://stillandgolden.com.au/gift-vouchers</loc>')
    expect(read('build/site-chrome.js')).toContain("footLink('/gift-vouchers', 'Gift vouchers')")
    expect(read('packages.html')).toContain('href="/gift-vouchers"')
    expect(read('packages/glimpse-mini-sessions.html')).toContain('href="/gift-vouchers"')
  })
})

describe('the menu', () => {
  it('lists Gift vouchers after Offers, and marks it on its own page', async () => {
    const chrome = await import('../../../../build/site-chrome.js')
    const nav = (chrome.default || chrome).navHtml('/gift-vouchers')
    expect(nav).toMatch(/href="\/offers"[^>]*>Offers<\/a><a href="\/gift-vouchers" class="active" aria-current="page">Gift vouchers<\/a>/)
  })
})

describe('the booking page takes a voucher', () => {
  it('has a voucher field, checks it, and sends it with a pay-in-full booking', () => {
    const b = read('book.html')
    expect(b).toContain('id="f-voucher"')
    expect(b).toContain("api('voucher-balance'")
    expect(b).toMatch(/voucherCode:/)
  })

  it('opens the voucher field straight away when the link carries a code', () => {
    expect(read('book.html')).toMatch(/get\('voucher'\)/)
  })
})
