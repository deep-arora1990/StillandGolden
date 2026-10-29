// Copy rules Deep can publish past. A converted test collects offenders
// ({ page, found }) and calls copyRule(id, offenders). An offender with a
// recorded exception (same rule, page and found) is dropped; anything left
// fails with one line the Studio Website tab can find:
//   copy-rule <id> <JSON of the remaining offenders>
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '../../../..')
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', f), 'utf8'))
let override = null

export function setExceptionsForTest(list) {
  override = list
}

// Data files the rules scan besides the pages: the portfolio's photo
// descriptions. An offender there names the file as its page, so Studio's
// "Publish anyway" records the exception against it.
export const SCANNED_DATA = ['data/portfolio.json']

const RULE_IDS = () => Object.keys(readJson('copy-rules.json').rules)
let trackedPages = null

// Why an exception in checks/copy-exceptions.json is malformed, or null: a
// known rule, a page that is a tracked .html file or one of SCANNED_DATA, a
// found phrase, and a YYYY-MM-DD date.
export function exceptionProblem(e) {
  trackedPages ??= new Set(execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean))
  if (!e || !RULE_IDS().includes(e.rule)) return 'unknown rule'
  if (!(trackedPages.has(e.page) || SCANNED_DATA.includes(e.page))) return 'page is not a tracked page or scanned data file'
  if (typeof e.found !== 'string' || !e.found.length) return 'no found phrase'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) return 'date is not YYYY-MM-DD'
  return null
}

// Every distinct phrase `re` finds in `text`, as offenders for `page`, so one
// run reports everything on a page (Studio records one exception per offender).
export function pageOffenders(page, text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  const found = [...new Set([...text.matchAll(g)].map((m) => m[0]))]
  return found.map((f) => ({ page, found: f }))
}

export function copyRule(id, offenders) {
  const rules = readJson('copy-rules.json').rules
  if (!Object.prototype.hasOwnProperty.call(rules, id)) {
    throw new Error(`Unknown rule "${id}": add it to checks/copy-rules.json`)
  }
  const exceptions = override ?? readJson('copy-exceptions.json').exceptions
  const left = offenders.filter(
    (o) => !exceptions.some((e) => e.rule === id && e.page === o.page && e.found === o.found),
  )
  if (left.length) throw new Error(`copy-rule ${id} ${JSON.stringify(left)}`)
}
