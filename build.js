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
const { LIBRARY } = require('./build/blocks');
const { createRenderer } = require('./build/render');

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
  rootFiles: ['site.css', 'blocks.css', 'site.js', 'site-tags.js', 'favicon.ico', 'favicon-32.png', 'favicon-192.png',
    'apple-touch-icon.png', 'og-image.jpg', 'sitemap.xml', 'robots.txt'],
  dirs: ['blog', 'packages', 'offers', 'Images', 'New photos'],
  // Folders that hold photos. In these only the web-ready copies (in a web/ or
  // webp/ folder) are published, plus any file a page or stylesheet points to.
  // The camera originals stay in the repo but off the site.
  imageDirs: ['Images', 'New photos'],
  // Photos linked from outside the site (sent emails, templates in Studio) that
  // no page points to. Studio's database could not be read on 27 Oct 2026
  // (access was denied), so the check of sent emails was waived by Deep that day.
  keepImages: [
    'Images/christmas-minis-hero.jpg', // christmas-minis EOI email (brand/email-templates/christmas-minis-eoi.html) links it directly
  ],
  // Pages that must stay unlinked (live and in the sitemap, linked from nowhere).
  unlinked: ['/packages/golden-cake-smash-photography'],
};

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');
const PRICES = JSON.parse(fs.readFileSync(path.join(ROOT, CONFIG.prices), 'utf8'));
const NO_CHROME = process.argv.includes('--no-chrome');
const { rootFiles: ROOT_FILES, dirs: DIRS, imageDirs: IMAGE_DIRS } = CONFIG;

// ── Prices and pages ───────────────────────────────────────────────────────
// The renderer (price tokens, block markers, menu and footer) lives in
// build/render.js so Studio's preview can run the very same code in the browser.
const { priceToken, pagePath, renderPage } = createRenderer({
  prices: PRICES,
  chrome: CONFIG.chrome,
  mounts: CONFIG.mounts,
  unlinked: CONFIG.unlinked,
  library: LIBRARY,
  withChrome: !NO_CHROME,
});

// ── Photos ─────────────────────────────────────────────────────────────────
// Every local file a page or stylesheet points to, as a repo-relative path with
// %20 and friends decoded, e.g. "New photos/Family/web/DSC09027 1.jpg". Reads
// src, srcset (each candidate), content and href values, url(...), and quoted
// site URLs (which catches the JSON-LD). Links to pages (no file extension) and
// to other sites are ignored.
// Page-relative links ("New%20photos/a.jpg", "../Images/b.jpg") are resolved
// against the folder of the page they appear in (pageRel, repo-relative).
// Text inside <!-- comments --> and /* comments */ is ignored, since browsers
// never fetch it.
function referencedFiles(html, pageRel = 'index.html') {
  const found = new Set();
  const dir = path.posix.dirname(pageRel.split(path.sep).join('/'));
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const add = (raw) => {
    let u = String(raw).trim();
    u = u.replace(/^https:\/\/(?:www\.)?stillandgolden\.com\.au(?=\/)/, '');
    if (u.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('#')) return;
    u = u.split(/[?#]/)[0];
    try { u = decodeURIComponent(u); } catch { /* leave it as written */ }
    u = u.startsWith('/') ? u.replace(/^\/+/, '') : path.posix.join(dir, u);
    u = path.posix.normalize(u);
    if (u.startsWith('../')) return;
    if (/\.[A-Za-z0-9]+$/.test(path.posix.basename(u))) found.add(u);
  };
  for (const m of html.matchAll(/\b(src|srcset|content|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = m[2] !== undefined ? m[2] : m[3];
    if (m[1].toLowerCase() === 'srcset') {
      value.split(/,\s+|,(?=\/)/).forEach((c) => add(c.trim().split(/\s+/)[0]));
    } else if (m[1].toLowerCase() === 'content' && !/^(\/|https:\/\/(?:www\.)?stillandgolden\.com\.au\/)/.test(value.trim())) {
      continue; // content="width=device-width, initial-scale=1.0" is not a path
    } else add(value);
  }
  for (const m of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) add(m[2]);
  for (const m of html.matchAll(/["'](https:\/\/(?:www\.)?stillandgolden\.com\.au\/[^"'\s<>]*)["']/g)) add(m[1]);
  return found;
}

// Should this file go on the site? Anything outside the photo folders, yes.
// Inside them: web-ready copies (a web/ or webp/ folder), anything a page
// points to, and anything on the keep list.
function publishable(rel, refs) {
  const p = rel.split(path.sep).join('/');
  if (!IMAGE_DIRS.some((d) => p.startsWith(d + '/'))) return true;
  return p.split('/').slice(0, -1).some((seg) => seg === 'web' || seg === 'webp')
    || refs.has(p) || CONFIG.keepImages.includes(p);
}

// Link check: nothing may point to a file that isn't being published. Paths are
// compared exactly, case included, because Netlify's servers are case-sensitive
// (a .jpg link to a .JPG file works on a Mac and 404s on the live site).
function checkLinks(refsBy, published) {
  for (const [page, pointsTo] of refsBy) {
    for (const p of pointsTo) {
      if (!published.has(p)) throw new Error(`${page}: points to ${p}, which isn't published`);
    }
  }
}

// ── Studio's preview bundle ────────────────────────────────────────────────
// dist/_cms/render.js is a classic script (no imports, no Node APIs) that gives
// Studio's sandboxed preview the same renderPage as this build. A tiny module
// map stands in for a bundler: the source of the three build files plus the
// JSON they read. dist/_cms/version.json says which commit it was built from.
function commitSha() {
  if (/^[0-9a-f]{40}$/.test(process.env.COMMIT_REF || '')) return process.env.COMMIT_REF;
  return require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}
function writeCmsBundle(dir) {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const modules = {
    './render': read('build/render.js'),
    './blocks': read('build/blocks.js'),
    './site-chrome': read('build/site-chrome.js'),
  };
  const json = {
    '../blocks/library.json': read('blocks/library.json'),
    '../data/prices.json': read(CONFIG.prices),
  };
  const lit = (o) => '{' + Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(',\n') + '}';
  const wrap = (src) => `function (module, exports, require) {\n${src}\n}`;
  const bundle = `// Generated by build.js. Do not edit.
(function () {
  var defs = ${lit(Object.fromEntries(Object.entries(modules).map(([k, v]) => [k, wrap(v)])))};
  var json = ${lit(json)};
  var cache = {};
  function req(name) {
    if (Object.prototype.hasOwnProperty.call(json, name)) return json[name];
    if (!Object.prototype.hasOwnProperty.call(defs, name)) throw new Error('cms bundle: cannot require ' + name);
    if (!cache[name]) {
      var module = { exports: {} };
      cache[name] = module;
      defs[name](module, module.exports, req);
    }
    return cache[name].exports;
  }
  var prices = req('../data/prices.json');
  var library = req('../blocks/library.json');
  var render = req('./render').createRenderer({
    prices: prices,
    chrome: req('./site-chrome'),
    mounts: ${JSON.stringify(CONFIG.mounts)},
    unlinked: ${JSON.stringify(CONFIG.unlinked)},
    library: library,
    withChrome: true
  });
  self.SGRender = { renderPage: render.renderPage, prices: prices, library: library, version: 1 };
})();
`;
  fs.mkdirSync(path.join(dir, '_cms'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_cms', 'render.js'), bundle);
  fs.writeFileSync(path.join(dir, '_cms', 'version.json'),
    JSON.stringify({ commit: commitSha(), builtAt: new Date().toISOString() }) + '\n');
}

// ── Copy ───────────────────────────────────────────────────────────────────
function copy(rel, rendered) {
  const src = path.join(ROOT, rel);
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (rendered !== undefined) fs.writeFileSync(dest, rendered);
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
  const candidates = [...rootPages, ...ROOT_FILES, ...DIRS.flatMap(walk)]
    .filter((f) => !tracked || tracked.has(f.split(path.sep).join('/')));

  // Render every page first, so we know which photos the site points to.
  const rendered = new Map();
  const refsBy = new Map();
  for (const f of candidates) {
    if (f.endsWith('.html')) {
      rendered.set(f, renderPage(f, fs.readFileSync(path.join(ROOT, f), 'utf8')));
      refsBy.set(f, referencedFiles(rendered.get(f), f));
    } else if (/\.(css|js)$/.test(f) && ROOT_FILES.includes(f)) {
      refsBy.set(f, referencedFiles(fs.readFileSync(path.join(ROOT, f), 'utf8'), f));
    }
  }
  const refs = new Set([...refsBy.values()].flatMap((s) => [...s]));
  const files = candidates.filter((f) => publishable(f, refs));
  const published = new Set(files.map((f) => f.split(path.sep).join('/')));

  checkLinks(refsBy, published);

  for (const f of files) copy(f, rendered.get(f));
  const pages = files.filter((f) => f.endsWith('.html')).length;
  writeCmsBundle(OUT);
  console.log(`build: ${pages} pages and ${files.length - pages} other files (${candidates.length - files.length} camera originals left out) written to dist/${NO_CHROME ? ' (prices only)' : ''}`);
}

if (require.main === module) {
  try { build(); } catch (err) { console.error(`build failed: ${err.message}`); process.exit(1); }
}
module.exports = { CONFIG, writeCmsBundle, priceToken, renderPage, pagePath, referencedFiles, publishable, checkLinks };
