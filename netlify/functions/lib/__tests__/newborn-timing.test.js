// Newborn timing has one answer everywhere (Deep, 19 Oct 2026): there is no
// set time. Two weeks or twelve is just a different phase, and they're still
// a little newborn. The coach's audit found three different answers (p89);
// this keeps it at one. Maternity timing (when the bump shows) is separate
// and stays.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const PAGES = execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/^(brand|reel|print|blocks)\//.test(f))

const OLD_ANSWERS = /first few weeks|sleepiest|no cut-off|first-4-weeks|first 4 weeks|first four weeks|weeks of birth|book (in|during) (their|the) second or third trimester|second or third trimester to secure|most families book Bloom in the second or third trimester|usually in the second or third trimester|Second trimester:|Third trimester:/i

describe('newborn timing', () => {
  it('no page gives a usual window, a sleepy-baby reason or a cut-off', () => {
    for (const f of PAGES) expect(read(f), f).not.toMatch(OLD_ANSWERS)
  })

  it('every page that answers the question says there is no set time, two weeks or twelve', () => {
    for (const f of [
      'index.html',
      'packages.html',
      'packages/gathered-newborn-photography.html',
      'packages/bloom-maternity-newborn-photography.html',
      'blog/when-to-book-newborn-photos.html',
      'blog/how-much-does-newborn-photography-cost.html',
    ]) {
      const p = read(f)
      expect(p, f).toMatch(/no set time/)
      expect(p, f).toMatch(/two weeks or twelve/)
      expect(p, f).toMatch(/still (your|a) little newborn/)
    }
  })

  it('the homepage FAQ and its search answer say the same thing', () => {
    const home = read('index.html')
    const schema = home.match(/"name": "When should I book my newborn session\?"[\s\S]*?"text": "([^"]+)"/)[1]
    const shown = home.match(/<summary>When should I book my newborn session\?<\/summary>\s*<p>([\s\S]*?)<\/p>/)[1]
    expect(shown.replace(/&#39;|&rsquo;/g, "'")).toBe(schema)
  })

  it('the Bloom agreement does not give a window either', () => {
    expect(read('netlify/functions/submit-contract.js')).not.toMatch(OLD_ANSWERS)
  })
})
