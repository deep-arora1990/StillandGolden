// Copy rules Deep can publish past. A converted test collects offenders
// ({ page, found }) and calls copyRule(id, offenders). An offender with a
// recorded exception (same rule, page and found) is dropped; anything left
// fails with one line the Studio Website tab can find:
//   copy-rule <id> <JSON of the remaining offenders>
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', f), 'utf8'))
let override = null

export function setExceptionsForTest(list) {
  override = list
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
