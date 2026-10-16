// One source for every price (A+ build, 16 Oct 2026): data/prices.json. The
// pages read it at build time and the booking code reads it at run time, so
// what a page shows and what Stripe charges can't disagree.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/prices.json'), 'utf8'))
async function fresh(mod) { vi.resetModules(); process.env.SETMORE_API_KEY = 'test'; return await import(mod) }

describe('the booking code charges what prices.json says', () => {
  it('every priced tier: price, cents, half deposit where split is offered, and valued-at', async () => {
    const { TIERS } = await fresh('../setmore.js')
    for (const [key, p] of Object.entries(P)) {
      if (key.startsWith('_')) continue
      const t = TIERS[key]
      expect(t, key).toBeTruthy()
      expect(t.priceFrom, key).toBe(p.price)
      expect(t.priceCents, key).toBe(p.price * 100)
      if (t.depositCents !== undefined) expect(t.depositCents, key).toBe(p.price * 50)
      if (p.valued !== undefined) expect(t.valuedAt, key).toBe(p.valued)
    }
  })

  it('the signed agreement quotes the same full-gallery prices', async () => {
    const { _test } = await fresh('../../submit-contract.js')
    expect(_test.TIERS.glimpse.upgrade).toBe(P.glimpse.gallery)
    expect(_test.TIERS.golden.upgrade).toBe(P.golden.gallery)
  })

  it('"valued at" stays true: a Glimpse session plus its full gallery', () => {
    for (const k of ['in-home-christmas', 'sunset-beach-minis']) {
      expect(P[k].valued, k).toBe(P.glimpse.price + P.glimpse.gallery)
    }
  })
})

describe('no price is typed into the booking code', () => {
  it('setmore.js and submit-contract.js take every priced tier\'s money from prices.json', () => {
    const setmore = fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/setmore.js'), 'utf8')
    for (const key of Object.keys(P).filter((k) => !k.startsWith('_'))) {
      const start = setmore.search(new RegExp(`\\n  '?${key}'?: \\{`))
      expect(start, key).toBeGreaterThan(-1)
      const block = setmore.slice(start, setmore.indexOf('\n  },', start))
      expect(block, key).not.toMatch(/(priceFrom|priceCents|depositCents|valuedAt):\s*\d/)
    }
    const contract = fs.readFileSync(path.join(ROOT, 'netlify/functions/submit-contract.js'), 'utf8')
    expect(contract).not.toMatch(/upgrade:\s*\d/)
  })
})

