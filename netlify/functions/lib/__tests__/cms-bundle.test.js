// Studio's preview runs dist/_cms/render.js in a sandbox. It must render every
// page exactly as the build does, and need nothing from Node.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { execFileSync } from 'child_process';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../../../..');
const { CONFIG, renderPage, writeCmsBundle } = require_(path.join(ROOT, 'build.js'));
const { parseBlocks } = require_(path.join(ROOT, 'build/blocks.js'));
const library = JSON.parse(fs.readFileSync(path.join(ROOT, 'blocks/library.json'), 'utf8'));
const prices = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/prices.json'), 'utf8'));
const portfolio = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/portfolio.json'), 'utf8'));

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const isPage = (f) => f.endsWith('.html')
  && (!f.includes('/') || CONFIG.dirs.some((d) => f.startsWith(d + '/')));

let dir, bundleText, SG;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-'));
  writeCmsBundle(dir);
  bundleText = fs.readFileSync(path.join(dir, '_cms/render.js'), 'utf8');
  const ctx = { self: {} };
  vm.runInNewContext(bundleText, ctx);
  SG = ctx.self.SGRender;
});

describe('the /_cms/ bundle', () => {
  it('renders every page exactly as the build does', () => {
    const pages = tracked.filter(isPage);
    expect(pages.length).toBeGreaterThan(10);
    for (const rel of pages) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(SG.renderPage(rel, src), rel).toBe(renderPage(rel, src));
    }
  });
  it('carries today\'s prices, library and portfolio', () => {
    expect(SG.prices).toEqual(prices);
    expect(SG.library).toEqual(library);
    expect(SG.portfolio).toEqual(portfolio);
    expect(SG.version).toBe(2);
  });
  it('renders the portfolio with the data it is given, and checks it like the build', () => {
    const src = fs.readFileSync(path.join(ROOT, 'portfolio.html'), 'utf8');
    const one = { version: 1, tabs: [{ ...portfolio.tabs[0], photos: portfolio.tabs[0].photos.slice(0, 1) }] };
    const out = SG.renderPage('portfolio.html', src, { portfolio: one });
    expect(out).toBe(renderPage('portfolio.html', src, { portfolio: one }));
    expect(out.match(/class="masonry-item/g)).toHaveLength(1);
    expect(() => SG.checkPortfolio(portfolio)).not.toThrow();
    expect(() => SG.checkPortfolio({ version: 1, tabs: [{ ...one.tabs[0], photos: [] }] })).toThrow(/^data\/portfolio\.json: /);
  });
  it('fails like the build', () => {
    expect(() => SG.renderPage('x.html', '<p>{{price.nope}}</p>')).toThrow(/unknown tier "nope"/);
  });
  it('needs nothing from Node', () => {
    expect(bundleText).not.toMatch(/require\(['"](fs|path|child_process)/);
  });
  it('lists pages that exist and have blocks', () => {
    expect(library.pages.map((p) => p.file)).toEqual([
      'about.html', 'packages.html',
      'packages/glimpse-mini-sessions.html', 'packages/golden-family-photography.html',
      'packages/golden-cake-smash-photography.html', 'packages/gathered-newborn-photography.html',
      'packages/bloom-maternity-newborn-photography.html', 'offers.html',
      'offers/sunset-beach-mini-sessions.html', 'offers/in-home-christmas-photos.html',
      'gift-vouchers.html']);
    for (const { file, label } of library.pages) {
      expect(label).toBeTruthy();
      expect(tracked, file).toContain(file);
      expect(parseBlocks(fs.readFileSync(path.join(ROOT, file), 'utf8')).length, file).toBeGreaterThanOrEqual(5);
    }
  });
  it('version.json names a commit', () => {
    const v = JSON.parse(fs.readFileSync(path.join(dir, '_cms/version.json'), 'utf8'));
    expect(v.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(v.builtAt))).toBe(false);
  });
  it('netlify.toml sets the /_cms/ headers', () => {
    const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
    const block = toml.split('[[headers]]').find((b) => b.includes('for = "/_cms/*"'));
    expect(block).toMatch(/Cache-Control = "public, max-age=0, must-revalidate"/);
    expect(block).toMatch(/Access-Control-Allow-Origin = "\*"/);
    expect(block).toMatch(/X-Robots-Tag = "noindex"/);
  });
  it('no page or the sitemap mentions /_cms/', () => {
    for (const rel of [...tracked.filter(isPage), 'sitemap.xml']) {
      expect(fs.readFileSync(path.join(ROOT, rel), 'utf8'), rel).not.toContain('/_cms/');
    }
  });
});
