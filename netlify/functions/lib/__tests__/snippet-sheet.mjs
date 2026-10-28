// Manual check, not a test: every blocks/site snippet appended to a real page,
// screenshotted at 1280 and 390. Exits 1 on sideways scroll at 390 or if a
// package row's second card does not stack below its first.
// Run `node build.js` first, then:
//   PUPPETEER_CORE=/path/to/node_modules/puppeteer-core node netlify/functions/lib/__tests__/snippet-sheet.mjs [outDir]
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core')
const { renderPage } = require(path.join(ROOT, 'build.js'))
const { LIBRARY } = require(path.join(ROOT, 'build/blocks.js'))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const out = process.argv[2] || path.join(ROOT, 'snippet-sheets')
fs.mkdirSync(out, { recursive: true })

const base = fs.readFileSync(path.join(ROOT, 'dist/packages/glimpse-mini-sessions.html'), 'utf8')
const snippets = Object.values(LIBRARY.types).filter((t) => t.snippet)
  .map((t) => renderPage('sheet.html', fs.readFileSync(path.join(ROOT, t.snippet), 'utf8'))).join('\n')
const page = base.replace('</main>', `${snippets}\n</main>`)
const file = path.join(ROOT, 'dist/packages/_snippet-sheet.html')
fs.writeFileSync(file, page)

// Pages use root-relative CSS and images, so serve dist over http.
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.JPG': 'image/jpeg', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, 'dist', decodeURIComponent(req.url.split('?')[0]))
  if (!f.startsWith(path.join(ROOT, 'dist')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
let failed = false
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
try {
  for (const w of [1280, 390]) {
    const tab = await browser.newPage()
    await tab.setViewport({ width: w, height: 900 })
    await tab.goto(`${origin}/packages/_snippet-sheet.html`, { waitUntil: 'networkidle0' })
    await tab.evaluate(async () => {
      document.querySelectorAll('details').forEach((d) => (d.open = true))
      const imgs = [...document.querySelectorAll('img')]
      imgs.forEach((i) => { i.loading = 'eager' })
      await Promise.all(imgs.map((i) => i.decode().catch(() => {})))
    })
    await tab.screenshot({ path: path.join(out, `snippets-${w}.png`), fullPage: true })
    if (w === 390) {
      const r = await tab.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        rows: [...document.querySelectorAll('.pkg-row')].map((row) => {
          const [a, b] = row.querySelectorAll('.pkg-mini')
          return b.getBoundingClientRect().top > a.getBoundingClientRect().top
        }),
      }))
      console.log('390px:', r)
      if (r.sw > 390) { console.error('sideways scroll', r.sw); failed = true }
      if (!r.rows.length || r.rows.some((s) => !s)) { console.error('package row cards do not stack'); failed = true }
    }
    await tab.close()
  }
} finally {
  await browser.close()
  server.close()
  fs.rmSync(file, { force: true })
}
process.exit(failed ? 1 : 0)
