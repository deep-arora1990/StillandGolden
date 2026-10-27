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
