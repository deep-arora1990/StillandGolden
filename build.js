#!/usr/bin/env node
// Still & Golden site build (A+ build, 16 Oct 2026). Netlify runs this on every
// deploy and serves dist/. The pages stay hand-written HTML; this only:
//
//   1. fills price tokens from data/prices.json, e.g. {{price.golden}} -> $475
//   2. writes the shared menu and footer into each page (build/site-chrome.js),
//      and the slim bar on form and legal pages
//   3. copies ONLY the files that belong on the site into dist/ (an allowlist,
//      so function source, tests, package files, brand/ and print/ are never
//      served again)
//
// It stops with an error, and nothing is published, if a page has an unknown
// token, a token is left unfilled, or any page links to the SEO-only cake smash
// page. Run locally with `node build.js`; `--no-chrome` skips step 2 (used to
// prove the price tokens alone change nothing).

const fs = require('fs');
const path = require('path');

// ── Site settings ──────────────────────────────────────────────────────────
// Everything specific to Still & Golden is here, so another site can reuse
// this script by changing only this block (Deep Arora Studios does).
const CONFIG = {
  prices: 'data/prices.json',
  chrome: require('./build/site-chrome'),          // menu, footer, slim bar
  // Placeholders in the pages that the menu and footer replace.
  mounts: { nav: '<nav id="nav" data-sg-nav></nav>', footer: '<footer data-sg-footer></footer>' },
  // What gets published, besides the .html pages at the top level. Anything
  // not listed here is never served.
  rootFiles: ['site.css', 'site.js', 'site-tags.js', 'favicon.ico', 'favicon-32.png', 'favicon-192.png',
    'og-image.jpg', 'sitemap.xml', 'robots.txt'],
  dirs: ['blog', 'packages', 'offers', 'Images', 'New photos'],
  // Pages that must stay unlinked (live and in the sitemap, linked from nowhere).
  unlinked: ['/packages/golden-cake-smash-photography'],
};

const { navHtml, FOOTER_HTML, barHtml, BAR_FOOTER } = CONFIG.chrome;
const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');
const PRICES = JSON.parse(fs.readFileSync(path.join(ROOT, CONFIG.prices), 'utf8'));
const NO_CHROME = process.argv.includes('--no-chrome');
const { rootFiles: ROOT_FILES, dirs: DIRS } = CONFIG;

// ── Prices ─────────────────────────────────────────────────────────────────
// {{price.TIER}}               $475   the session price
// {{price.TIER.gallery}}       $125   its full-gallery add-on
// {{price.TIER.valued}}        $400   an offer's "valued at"
// {{price.TIER.half}}          $237.50  each half of a split payment
// {{price.TIER.withgallery}}   $570   the session with its full gallery added
// Add .number for a bare figure (475), as Google's structured data needs.
const dollars = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
function priceToken(expr) {
  const parts = expr.split('.');
  const number = parts[parts.length - 1] === 'number' ? parts.pop() && true : false;
  const [, tier, field = 'price'] = parts;
  const p = PRICES[tier];
  if (!p || tier.startsWith('_')) throw new Error(`unknown tier "${tier}"`);
  const value = field === 'half' ? p.price / 2
    : field === 'withgallery' ? (typeof p.gallery === 'number' ? p.price + p.gallery : undefined)
    : p[field];
  if (typeof value !== 'number' || !['price', 'gallery', 'valued', 'half', 'withgallery'].includes(field)) {
    throw new Error(`"${field}" is not set for ${tier}`);
  }
  return number ? String(value) : dollars(value);
}

// ── Pages ──────────────────────────────────────────────────────────────────
const pagePath = (rel) => {
  const p = '/' + rel.replace(/\\/g, '/').replace(/\.html$/, '');
  return p === '/index' ? '/' : p.endsWith('/index') ? p.slice(0, -5) : p;
};

function renderPage(rel, html) {
  html = html.replace(/\{\{\s*(price\.[\w.-]+)\s*\}\}/g, (_, expr) => {
    try { return priceToken(expr); } catch (e) { throw new Error(`${rel}: {{${expr}}}: ${e.message}`); }
  });
  if (!NO_CHROME) {
    html = html
      .replace(CONFIG.mounts.nav, navHtml(pagePath(rel)))
      .replace(CONFIG.mounts.footer, FOOTER_HTML)
      .replace(/<!--\s*include:bar(?:\s+back="([^"]*)"\s+label="([^"]*)")?\s*-->/g,
        (_, href, label) => barHtml(href ? { href, label } : undefined))
      .replace(/<!--\s*include:bar-footer\s*-->/g, BAR_FOOTER);
  }
  const left = html.match(/\{\{[^}]*\}\}|<!--\s*include:[\w-]+/);
  if (left) throw new Error(`${rel}: unfilled "${left[0]}"`);
  for (const page of CONFIG.unlinked) {
    if (pagePath(rel) !== page && html.includes(`href="${page}`)) {
      throw new Error(`${rel}: links to ${page}, which must stay unlinked (SEO-only page)`);
    }
  }
  return html;
}

// ── Copy ───────────────────────────────────────────────────────────────────
function copy(rel) {
  const src = path.join(ROOT, rel);
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (rel.endsWith('.html')) fs.writeFileSync(dest, renderPage(rel, fs.readFileSync(src, 'utf8')));
  else fs.copyFileSync(src, dest);
}
function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.name.startsWith('.')) return [];
    return e.isDirectory() ? walk(rel) : [rel];
  });
}

// Committed files only, so a local build publishes exactly what Netlify will:
// a print tool or photo sitting uncommitted in the folder is never copied. If
// git isn't available, fall back to what is on disk.
function committed() {
  try {
    const out = require('child_process').execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
    return new Set(out.split('\0').filter(Boolean));
  } catch { return null; }
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const tracked = committed();
  const rootPages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const files = [...rootPages, ...ROOT_FILES, ...DIRS.flatMap(walk)]
    .filter((f) => !tracked || tracked.has(f.split(path.sep).join('/')));
  for (const f of files) copy(f);
  const pages = files.filter((f) => f.endsWith('.html')).length;
  console.log(`build: ${pages} pages and ${files.length - pages} other files written to dist/${NO_CHROME ? ' (prices only)' : ''}`);
}

if (require.main === module) {
  try { build(); } catch (err) { console.error(`build failed: ${err.message}`); process.exit(1); }
}
module.exports = { CONFIG, priceToken, renderPage, pagePath };
