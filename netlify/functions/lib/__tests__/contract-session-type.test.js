import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const { _test } = require('../../submit-contract.js')

// The contract form submits the option's value, never its label, so the label
// punctuation can't change which agreement is signed. Pin it anyway: each
// option must resolve to the tier it names, and so must an old cached label.
const INTENDED = {
  Glimpse: 'Glimpse', Golden: 'Golden', Gathered: 'Gathered', Bloom: 'Bloom',
  'in-home-christmas': 'in-home-christmas', 'sunset-beach-minis': 'sunset-beach-minis',
}

describe('contract dropdowns resolve to the intended tier', () => {
  for (const f of ['contract.html', 'contract-mini.html']) {
    it(`${f}: every option value and label resolves to its tier`, () => {
      const html = fs.readFileSync(path.join(ROOT, f), 'utf8')
      const opts = [...html.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => ({ value: m[1], label: m[2] }))
      expect(opts.length).toBeGreaterThan(0)
      for (const { value, label } of opts) {
        const want = _test.resolveTier(INTENDED[value])
        expect(want.name, value).toBeTruthy()
        expect(_test.resolveTier(value), value).toBe(want)
        // Labels only matter for the four packages; the seasonal labels never
        // matched by name (they were free text before too) and are not sent.
        if (/^[A-Z]/.test(value) && !/^In-home/.test(label)) {
          expect(_test.resolveTier(label), label).toBe(want)
          expect(_test.resolveTier(label.replace(': ', ' — ')), 'cached label').toBe(want)
        }
        expect(label.split(': ')[0].length, label).toBeGreaterThan(0)
      }
    })
  }
})
