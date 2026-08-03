# Still & Golden — stillandgolden.com.au

Static site for Still & Golden, an in-home newborn & family photography business
serving Frankston and Melbourne's south-east. Plain HTML/CSS/JS, deployed on
Netlify from the repo root (`main` branch auto-deploys).

## Structure

- `index.html` — homepage (fully inline styles)
- `glimpse-mini-sessions.html`, `golden-family-photography.html`,
  `gathered-newborn-photography.html`, `golden-cake-smash-photography.html` —
  service pages (use shared `site.css` + `site.js`)
- `portfolio.html` — gallery (own CSS, shared `site.js`)
- `blog/` — blog index + posts (shared `site.css` + `site.js`)
- `netlify.toml` — headers, caching, redirects (see URL rules below)
- `brand/`, `reel/`, `print/` — personal content tooling, **not website
  source**. Never stage or commit new files from these; add files to git by
  name only.

## Conventions

**Images.** Never reference original camera exports in HTML. Each content
image has a WebP (display-size, in a `webp/` subdir next to the original) and
a resized JPEG fallback (max 1600px long edge, ≤500KB, in a `web/` subdir),
wired up with `<picture>`. WebP dimensions must match the JPEG they front —
browsers never fall back to the JPEG, so a smaller WebP is the only version
most visitors get.

**URLs are extensionless.** Canonical form is `/portfolio`, not
`/portfolio.html`. `netlify.toml` force-301s every `.html` URL to the
extensionless form; canonicals, `og:url`, JSON-LD self-URLs, the sitemap and
all internal links use extensionless URLs. New pages: link extensionless and
add a matching 301 pair in `netlify.toml`.

**`golden-cake-smash-photography` is SEO-only.** Live and in the sitemap, but
deliberately not linked from anywhere on the site.

**Voice.** EN-AU spelling. Banned phrases: "capture the moment", "precious",
"treasured memories".

## SEO

Deep-crawl diagnostic run 3 Aug 2026. Critical/high items shipped in commit
`6fe6e89`:

- Portfolio JPEG fallbacks were 28–33MB camera exports (~842MB total) →
  resized 1600px `web/` fallbacks (~45MB total, ≤500KB each)
- Homepage image payload 5.12MB → 2.98MB; service/blog page images
  recompressed; all WebP/JPEG pairs dimension-matched
- Portfolio thin content (107 words) → intro copy + sessions block
- Duplicate `.html`/extensionless URLs consolidated (301s + aligned
  canonicals, sitemap, internal links)
- Cake smash page de-linked (SEO-only)

Remaining backlog, roughly in priority order:

1. **Meta descriptions** — 7 pages exceed ~160 chars and truncate in SERPs
   (worst: gathered-newborn 267, golden-family 249, cake smash 219). Rewrite
   to ~150 chars with a call to action.
2. **Titles** — 6 pages exceed ~60 chars (glimpse-mini-sessions worst at 89).
3. **H1 keywords** — homepage, cake smash and glimpse H1s are purely
   emotional; fold in the target phrase without losing tone.
4. **Location signal** — homepage says "based in Cranbourne East" while every
   title targets Frankston; make the story consistent.
5. **Structured data** — add `ImageGallery`/`CollectionPage` to portfolio,
   `Blog` to the blog index, sitewide `LocalBusiness` (phone + service area).
   Consider `noindex` on `privacy.html`.
6. **Social/contact** — no Twitter Card tags; phone and Google Business
   Profile link belong in the shared footer.
7. **Tech** — `http://www` → apex is a 2-hop chain; no
   Content-Security-Policy; HSTS lacks `includeSubDomains`.
8. **Content gaps** — "newborn photography cost" post (high intent), a
   Bloom/maternity page, a Frankston/Mornington Peninsula location guide,
   more family-cluster posts.
9. **Process** — submit the updated sitemap in Google Search Console.
