import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { copyRule, pageOffenders, scannedPages } from './copy-rules.js'

const ROOT = path.resolve(__dirname, '../../../..')

describe('no em dashes (Deep, 7 Nov 2026)', () => {
  it('no public page has an em dash', () => {
    const found = []
    for (const page of scannedPages()) {
      found.push(...pageOffenders(page, fs.readFileSync(path.join(ROOT, page), 'utf8'), /—|&mdash;/))
    }
    copyRule('no-em-dash', found)
  })
})
