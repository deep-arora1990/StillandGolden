// The "Adding a page" checklist (DEVELOPMENT.md), pinned for every blog post,
// and the template Studio starts each new post from (blog/_template.html).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const { LIBRARY, parseBlocks } = require('../../../../build/blocks.js')

const ROOT = path.resolve(__dirname, '../../../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const SITE = 'https://stillandgolden.com.au'
const POSTS = LIBRARY.pages.filter((p) => p.kind === 'post').map((p) => p.file)

const attr = (html, re) => (html.match(re) || [])[1]
const articles = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((m) => JSON.parse(m[1])).filter((j) => j['@type'] === 'Article')

describe('blog posts', () => {
  it('there are posts to check', () => {
    expect(POSTS.length).toBeGreaterThanOrEqual(11)
  })

  it('every post is in the library', () => {
    const tracked = execSync('git ls-files "blog/*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
      .filter((f) => f !== 'blog/index.html' && f !== 'blog/_template.html')
    expect(tracked.filter((f) => !POSTS.includes(f))).toEqual([])
  })

  describe.each(POSTS)('%s', (file) => {
    const slug = path.basename(file, '.html')
    const URL = `${SITE}/blog/${slug}`
    it('has the checklist pieces', () => {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true)
      const html = read(file)
      expect(attr(html, /<link rel="canonical" href="([^"]*)"/)).toBe(URL)
      expect(attr(html, /<meta property="og:url" content="([^"]*)"/)).toBe(URL)
      expect(html).toContain('<script src="/site-tags.js"></script>')
      const found = articles(html)
      expect(found).toHaveLength(1)
      const a = found[0]
      expect(a.mainEntityOfPage).toBe(URL)
      for (const k of ['headline', 'description', 'image']) expect(typeof a[k], k).toBe('string')
      expect(a.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(a.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(a.author.name).toBe('Deep Arora')
      expect(a.publisher['@id']).toBe(`${SITE}/#business`)
    })
    it('is redirected, in the sitemap and listed on the blog', () => {
      const toml = read('netlify.toml').replace(/\r/g, '')
      expect(toml).toContain(`[[redirects]]\n  from = "/blog/${slug}.html"\n  to = "/blog/${slug}"\n  status = 301\n  force = true\n`)
      expect(read('sitemap.xml')).toContain(`<loc>${URL}</loc>`)
      expect(read('blog/index.html')).toContain(`<a class="post" href="/blog/${slug}">`)
    })
  })
})

describe('the post template', () => {
  const html = () => read('blog/_template.html')
  it('is a post skeleton', () => {
    const h = html()
    expect(h).toContain('<title>New post | Still &amp; Golden</title>')
    expect(h).toContain('<meta name="description" content="Write a short summary of this post for Google.">')
    expect(h).toContain('<meta property="og:title" content="New post">')
    expect(h).toContain('<meta property="og:description" content="Write a short summary of this post for sharing.">')
    const URL = `${SITE}/blog/new-post`
    expect(attr(h, /<link rel="canonical" href="([^"]*)"/)).toBe(URL)
    expect(attr(h, /<meta property="og:url" content="([^"]*)"/)).toBe(URL)
    expect(h).toContain('<meta property="og:type" content="article">')
    expect(h).toContain(`<meta property="og:image" content="${SITE}/og-image.jpg">`)
    const [a] = articles(h)
    expect(a).toMatchObject({ headline: 'New post', description: 'Write a short summary of this post for Google.',
      image: `${SITE}/og-image.jpg`, datePublished: '2026-01-01', dateModified: '2026-01-01',
      author: { '@type': 'Person', name: 'Deep Arora' }, publisher: { '@id': `${SITE}/#business` }, mainEntityOfPage: URL })
    expect(h).toContain('<script src="/site-tags.js"></script>')
    expect(h.indexOf('/site.css')).toBeLessThan(h.indexOf('/blocks.css'))
    expect(h).toContain('<script src="/site.js" defer></script>')
    expect(h).toContain('<nav id="nav" data-sg-nav></nav>')
    expect(h).toContain('<footer data-sg-footer></footer>')
    expect(h).toContain('<main class="article">')
    expect(parseBlocks(h).map((b) => `${b.type}:${b.id}`)).toEqual([
      'post-intro:post-intro-1', 'prose:prose-1', 'photo:photo-1', 'prose:prose-2', 'cta-box:cta-box-1'])
    expect(h).not.toMatch(/\$\d/)
  })
})
