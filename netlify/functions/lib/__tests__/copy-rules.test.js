import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { copyRule, setExceptionsForTest } from './copy-rules.js'

const ROOT = path.resolve(__dirname, '../../../..')
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks/copy-rules.json'), 'utf8')).rules
const STUDIO = /copy-rule ([a-z0-9-]+) (\[.*\])$/m
const GATHERED = 'packages/gathered-newborn-photography.html'
const BLOOM = 'packages/bloom-maternity-newborn-photography.html'

afterEach(() => setExceptionsForTest(null))

describe('copy rules', () => {
  it('an offender with no exception fails with a copy-rule line', () => {
    let msg = ''
    try { copyRule('no-mt-eliza', [{ page: GATHERED, found: 'Mt Eliza' }]) } catch (e) { msg = e.message }
    const m = msg.match(STUDIO)
    expect(m).not.toBeNull()
    expect(m[1]).toBe('no-mt-eliza')
    expect(JSON.parse(m[2])).toEqual([{ page: GATHERED, found: 'Mt Eliza' }])
  })

  it('an exception silences exactly its page and phrase', () => {
    setExceptionsForTest([{ rule: 'newborn-timing-window', page: GATHERED, found: 'first few weeks', date: '2026-10-27', note: 'test' }])
    expect(() => copyRule('newborn-timing-window', [{ page: GATHERED, found: 'first few weeks' }])).not.toThrow()
    expect(() => copyRule('newborn-timing-window', [{ page: BLOOM, found: 'first few weeks' }])).toThrow(/copy-rule newborn-timing-window/)
    expect(() => copyRule('newborn-timing-window', [{ page: GATHERED, found: 'sleepiest' }])).toThrow(/copy-rule newborn-timing-window/)
  })

  it('an unknown rule blocks', () => {
    expect(() => copyRule('nope', [])).toThrow(/nope/)
    try { copyRule('nope', []) } catch (e) { expect(e.message).not.toContain('copy-rule ') }
  })

  it('every rule is used', () => {
    const dir = __dirname
    const src = fs.readdirSync(dir).filter((f) => /\.test\.js$/.test(f) && f !== 'copy-rules.test.js')
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    for (const id of Object.keys(RULES)) expect(src, id).toContain(`copyRule('${id}'`)
  })

  it('the lists are never published', () => {
    execSync('node build.js', { cwd: ROOT, stdio: 'ignore' })
    expect(fs.existsSync(path.join(ROOT, 'dist/checks'))).toBe(false)
  })

  it('every exception is well formed', () => {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks/copy-exceptions.json'), 'utf8')).exceptions
    const tracked = execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n')
    for (const e of list) {
      expect(Object.keys(RULES), JSON.stringify(e)).toContain(e.rule)
      expect(tracked, JSON.stringify(e)).toContain(e.page)
      expect(typeof e.found === 'string' && e.found.length > 0, JSON.stringify(e)).toBe(true)
      expect(e.date, JSON.stringify(e)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
