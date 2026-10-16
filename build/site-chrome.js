// The shared menu and footer (A+ build, 16 Oct 2026). Single source for every
// page: build.js writes them into the HTML at deploy time, so they are part of
// the page itself (readable by search engines, no flash while a script draws
// them). Moved here from site.js, which now only wires up the mobile menu.
//
// Form and legal pages (agreements, questionnaires, terms, privacy) never get
// the menu (Deep, 16 Oct 2026): they get the slim BAR and BAR_FOOTER instead.

const NAV_LINKS = [
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/about', label: 'About' },
  { href: '/packages', label: 'Packages' },
  { href: '/#faq', label: 'Common Questions' },
  { href: '/blog/', label: 'Blog' },
  { href: '/offers', label: 'Offers' },
  { href: '/#contact', label: 'Enquire now', className: 'book' },
];

// The tier landing pages live under /packages/ (30 Sep 2026), so the prefix
// covers them all; the booking widget belongs to Packages too. Seasonal pages
// (/offers and the Christmas minis campaign it lists) mark Offers instead.
const OFFER_PAGES = ['/offers', '/christmas-minis', '/christmas-minis-terms'];

function isActive(href, path) {
  if (href === '/portfolio') return path === '/portfolio';
  if (href === '/about') return path === '/about';
  if (href === '/packages') return path === '/packages' || path.startsWith('/packages/') || path === '/book';
  if (href === '/offers') return path.startsWith('/offers/') || OFFER_PAGES.includes(path);
  if (href === '/blog/') return path.startsWith('/blog');
  return false;
}

// Markup identical to what site.js used to draw, so every page's existing CSS
// (site.css, and the self-styled index and portfolio) applies unchanged.
function navHtml(path) {
  const links = NAV_LINKS.map((l) => {
    const active = isActive(l.href, path);
    const cls = [l.className, active ? 'active' : ''].filter(Boolean).join(' ');
    return `<a href="${l.href}"${cls ? ` class="${cls}"` : ''}${active ? ' aria-current="page"' : ''}>${l.label}</a>`;
  }).join('');
  return '<nav id="nav" data-sg-nav>' +
    '<a href="/" class="nav-logo">Still &amp; Golden</a>' +
    `<div class="nav-right">${links}</div>` +
    '<button class="hamburger" id="ham" aria-label="Menu"><span></span><span></span><span></span></button>' +
    '</nav><button class="menu-close" id="menu-close" aria-label="Close menu"></button>';
}

// The footer markup carries the class names the self-styled pages (portfolio)
// use, plus the link styles site.css would otherwise provide.
const FOOTER_LINK_STYLE = 'color:var(--mid);text-decoration:none;border-bottom:1px solid rgba(138,126,120,0.3);';
const footLink = (href, label) => `<a href="${href}" style="${FOOTER_LINK_STYLE}">${label}</a>`;
const FOOTER_HTML = '<footer data-sg-footer>' +
  '<span class="footer-logo">Still &amp; Golden</span>' +
  '<span class="footer-copy">&copy; 2026 Still &amp; Golden Photography &middot; ABN 37 280 912 036</span>' +
  '<span class="footer-area">Cranbourne &middot; Clyde North &middot; Berwick &middot; Narre Warren &middot; Frankston &middot; Langwarrin &middot; Mt Eliza</span>' +
  '<span class="footer-copy">' + [
    footLink('/offers', 'Offers'),
    footLink('/packages/glimpse-mini-sessions', 'Glimpse Minis'),
    footLink('/packages/golden-family-photography', 'Golden Family'),
    footLink('/packages/gathered-newborn-photography', 'Gathered Newborn'),
    footLink('/packages/bloom-maternity-newborn-photography', 'Bloom Bundle'),
    footLink('/packages', 'Packages'),
    footLink('/blog/', 'Blog'),
  ].join(' &middot; ') + '</span>' +
  `<a href="/privacy" class="footer-copy" style="${FOOTER_LINK_STYLE}">Privacy Policy</a>` +
  '</footer>';

// The slim bar for form and legal pages. `back` defaults to the home page.
function barHtml({ href = '/', label = 'Back to site' } = {}) {
  return `<nav>
    <a href="/" class="nav-logo">Still <span>&amp;</span> Golden</a>
    <div class="nav-right">
      <a href="${href}">&larr; ${label}</a>
    </div>
  </nav>`;
}

const BAR_FOOTER = `<footer>
    <span class="footer-copy">&copy; 2026 Still &amp; Golden Photography &middot; ABN 37 280 912 036</span>
    <span class="footer-brand">Still &amp; Golden</span>
  </footer>`;

module.exports = { NAV_LINKS, isActive, navHtml, FOOTER_HTML, barHtml, BAR_FOOTER };
