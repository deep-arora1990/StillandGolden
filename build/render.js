// The page renderer: block markers, price tokens, menu and footer. build.js
// uses it to build the site, and build.js also ships this file inside
// dist/_cms/render.js so Studio's preview renders exactly the same way. So: no
// Node APIs here (no fs, path or process), only the modules the bundle carries.

const { parseBlocks, stripBlockMarkers } = require('./blocks');

function createRenderer({ prices: PRICES, chrome, mounts, unlinked, library: LIBRARY, withChrome = true }) {
  const { navHtml, FOOTER_HTML, barHtml, BAR_FOOTER } = chrome;

  // ── Prices ───────────────────────────────────────────────────────────────
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

  // ── Pages ────────────────────────────────────────────────────────────────
  const pagePath = (rel) => {
    const p = '/' + rel.replace(/\\/g, '/').replace(/\.html$/, '');
    return p === '/index' ? '/' : p.endsWith('/index') ? p.slice(0, -5) : p;
  };

  function renderPage(rel, html) {
    // Block markers: validate, then strip, so they never reach the published page.
    let blocks;
    try { blocks = parseBlocks(html); } catch (e) { throw new Error(`${rel}: ${e.message}`); }
    for (const b of blocks) {
      if (!Object.hasOwn(LIBRARY.types, b.type)) throw new Error(`${rel}: unknown block type "${b.type}"`);
    }
    html = stripBlockMarkers(html);
    html = html.replace(/\{\{\s*(price\.[\w.-]+)\s*\}\}/g, (_, expr) => {
      try { return priceToken(expr); } catch (e) { throw new Error(`${rel}: {{${expr}}}: ${e.message}`); }
    });
    if (withChrome) {
      html = html
        .replace(mounts.nav, navHtml(pagePath(rel)))
        .replace(mounts.footer, FOOTER_HTML)
        .replace(/<!--\s*include:bar(?:\s+back="([^"]*)"\s+label="([^"]*)")?\s*-->/g,
          (_, href, label) => barHtml(href ? { href, label } : undefined))
        .replace(/<!--\s*include:bar-footer\s*-->/g, BAR_FOOTER);
    }
    const left = html.match(/\{\{[^}]*\}\}|<!--\s*include:[\w-]+/);
    if (left) throw new Error(`${rel}: unfilled "${left[0]}"`);
    for (const page of unlinked) {
      if (pagePath(rel) !== page && html.includes(`href="${page}`)) {
        throw new Error(`${rel}: links to ${page}, which must stay unlinked (SEO-only page)`);
      }
    }
    return html;
  }

  return { renderPage, priceToken, pagePath };
}

module.exports = { createRenderer };
