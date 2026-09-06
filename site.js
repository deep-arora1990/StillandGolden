// Still & Golden — shared site behaviour.
//
// Single source of truth for the nav and footer. Pages carry only mount
// points — <nav id="nav" data-sg-nav></nav> and <footer data-sg-footer></footer>
// — and this script fills them. The mount keeps id="nav" because some pages
// (index, portfolio) attach their own scroll-shrink listener to it.
//
// Active link: matched against location.pathname (class="active" +
// aria-current="page"). Mobile nav: the hamburger toggles a full-screen menu
// (body.menu-open); it closes via the X button or when any nav link is tapped.

(function () {
  // Christmas minis campaign. Everything below keys off CAMPAIGN so the whole
  // thing can be switched off by flipping `live` (or just letting `endsAt`
  // pass — the strip removes itself the day after the event either way, so a
  // forgotten campaign can't linger into December).
  var CAMPAIGN = {
    live: true,
    endsAt: '2026-11-09',              // first day the strip should NOT show
    href: '/christmas-minis',
    stripText: 'Christmas minis \u00b7 Sunday 8 November \u00b7 limited spots',
    stripCta: 'Book your time',
    dismissKey: 'sg-strip-xmas-2026',  // versioned: a future campaign gets a new key
  };

  function campaignRunning() {
    return CAMPAIGN.live && new Date().toISOString().slice(0, 10) < CAMPAIGN.endsAt;
  }

  var NAV_LINKS = [
    { href: '/portfolio', label: 'Portfolio' },
    { href: '/about', label: 'About' },
    { href: '/#sessions', label: 'Services' },
    { href: '/packages', label: 'Packages' },
    { href: '/#faq', label: 'Common Questions' },
    { href: '/blog/', label: 'Blog' },
    { href: '/christmas-minis', label: 'Christmas Minis', campaignOnly: true },
    { href: '/#contact', label: 'Enquire now', className: 'book' },
  ];

  // The footer markup carries the class names the self-styled pages
  // (portfolio) use, plus the link styles site.css would otherwise provide —
  // identical rendering in both worlds.
  var FOOTER_LINK_STYLE = 'color:var(--mid);text-decoration:none;border-bottom:1px solid rgba(138,126,120,0.3);';
  var FOOTER_HTML =
    '<span class="footer-logo">Still &amp; Golden</span>' +
    '<span class="footer-copy">&copy; 2026 Still &amp; Golden Photography &middot; ABN 37 280 912 036</span>' +
    '<span class="footer-area">Frankston &middot; Chelsea &middot; Seaford &middot; Langwarrin &middot; Mt Eliza</span>' +
    '<span class="footer-copy">' + (campaignRunning() ? '<a href="/christmas-minis" style="' + FOOTER_LINK_STYLE + '">Christmas Minis</a> &middot; ' : '') + '<a href="/glimpse-mini-sessions" style="' + FOOTER_LINK_STYLE + '">Glimpse Minis</a> &middot; <a href="/golden-family-photography" style="' + FOOTER_LINK_STYLE + '">Golden Family</a> &middot; <a href="/gathered-newborn-photography" style="' + FOOTER_LINK_STYLE + '">Gathered Newborn</a> &middot; <a href="/bloom-maternity-newborn-photography" style="' + FOOTER_LINK_STYLE + '">Bloom Bundle</a> &middot; <a href="/packages" style="' + FOOTER_LINK_STYLE + '">Packages</a> &middot; <a href="/blog/" style="' + FOOTER_LINK_STYLE + '">Blog</a></span>' +
    '<a href="/privacy" class="footer-copy" style="' + FOOTER_LINK_STYLE + '">Privacy Policy</a>';

  var path = location.pathname;

  // Pages that belong to the "Sessions & Pricing" nav item (the tier landing
  // pages and the booking widget) — the link itself points at the homepage's
  // sessions section.
  var SESSION_PAGES = [
    '/glimpse-mini-sessions',
    '/golden-family-photography',
    '/golden-cake-smash-photography',
    '/gathered-newborn-photography',
    '/bloom-maternity-newborn-photography',
    '/book',
  ];

  function isActive(href) {
    if (href === '/portfolio') return path === '/portfolio' || path === '/portfolio.html';
    if (href === '/about') return path === '/about' || path === '/about.html';
    if (href === '/packages') return path === '/packages' || path === '/packages.html';
    if (href === '/blog/') return path.indexOf('/blog') === 0;
    if (href === '/#sessions') {
      return SESSION_PAGES.some(function (p) { return path === p || path === p + '.html'; });
    }
    return false;
  }

  function renderNav() {
    var nav = document.querySelector('[data-sg-nav]');
    if (!nav) return;

    var links = NAV_LINKS.filter(function (l) {
      return !l.campaignOnly || campaignRunning();
    }).map(function (l) {
      var cls = l.className || '';
      var active = isActive(l.href);
      var clsAttr = cls || active ? ' class="' + (active ? (cls ? cls + ' ' : '') + 'active' : cls) + '"' : '';
      var ariaAttr = active ? ' aria-current="page"' : '';
      return '<a href="' + l.href + '"' + clsAttr + ariaAttr + '>' + l.label + '</a>';
    }).join('');

    nav.innerHTML =
      '<a href="/" class="nav-logo">Still &amp; Golden</a>' +
      '<div class="nav-right">' + links + '</div>' +
      '<button class="hamburger" id="ham" aria-label="Menu"><span></span><span></span><span></span></button>';

    // The X button for the mobile menu lives outside the nav element.
    if (!document.getElementById('menu-close')) {
      nav.insertAdjacentHTML('afterend', '<button class="menu-close" id="menu-close" aria-label="Close menu"></button>');
    }
  }

  function renderFooter() {
    var footer = document.querySelector('[data-sg-footer]');
    if (!footer) return;
    footer.innerHTML = FOOTER_HTML;
  }

  // Sitewide announcement strip. Deliberately not shown on the campaign page
  // itself (they're already there) or its terms page, and never after the
  // reader dismisses it.
  // The strip's CSS ships with the strip rather than living in site.css:
  // index.html and portfolio.html render the shared nav but are self-styled
  // and never load site.css, so a stylesheet-only rule left the strip
  // unstyled on the two pages that matter most.
  // With the campaign nav item there are 8 links, which wraps the row on
  // mid-width screens. Tighten the gap while the campaign is running; the
  // default 32px returns when it ends.
  var CAMPAIGN_CSS =
    '@media (min-width: 701px) and (max-width: 1180px) { ' +
    '  .nav-right { gap: 20px; } ' +
    '  .nav-right a { font-size: 0.74rem; letter-spacing: 0.05em; } ' +
    '} ';

  var STRIP_CSS =
    '/* ── Campaign announcement strip (site.js renders it) ───────────────────── ' +
    '   Fixed above the nav. The nav is also fixed, so it gets pushed down by the ' +
    '   strip\'s height; body padding shifts the flow content by the same amount, ' +
    '   which works without touching each page\'s own top padding. */ ' +
    '.sg-strip { ' +
    '  position: fixed; top: 0; left: 0; right: 0; z-index: 101; ' +
    '  display: flex; align-items: center; justify-content: center; ' +
    '  min-height: 40px; padding: 8px 44px 8px 20px; ' +
    '  background: var(--warm-black); color: var(--off-white); ' +
    '} ' +
    '.sg-strip-link { ' +
    '  display: flex; align-items: center; justify-content: center; ' +
    '  flex-wrap: wrap; gap: 4px 16px; ' +
    '  text-decoration: none; color: inherit; text-align: center; ' +
    '} ' +
    '.sg-strip-text { font-size: 0.76rem; letter-spacing: 0.08em; } ' +
    '.sg-strip-cta { ' +
    '  font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; ' +
    '  color: var(--gold); white-space: nowrap; ' +
    '} ' +
    '.sg-strip-link:hover .sg-strip-cta { color: var(--off-white); } ' +
    '.sg-strip-x { ' +
    '  position: absolute; top: 50%; right: 14px; transform: translateY(-50%); ' +
    '  width: 26px; height: 26px; padding: 0; cursor: pointer; ' +
    '  background: none; border: none; ' +
    '} ' +
    '.sg-strip-x::before, .sg-strip-x::after { ' +
    '  content: \'\'; position: absolute; left: 6px; top: 12px; ' +
    '  width: 14px; height: 1px; background: var(--off-white); opacity: 0.75; ' +
    '} ' +
    '.sg-strip-x::before { transform: rotate(45deg); } ' +
    '.sg-strip-x::after  { transform: rotate(-45deg); } ' +
    '.sg-strip-x:hover::before, .sg-strip-x:hover::after { opacity: 1; } ' +
    ' ' +
    'html.sg-has-strip nav { top: 40px; } ' +
    'html.sg-has-strip body { padding-top: 40px; } ' +
    '/* The mobile menu is a full-screen overlay; the strip would sit on top of it ' +
    '   and collide with the close button, so it steps aside while the menu is open. */ ' +
    'body.menu-open .sg-strip { display: none; } ' +
    'body.menu-open nav { top: 0; } ' +
    '@media (max-width: 700px) { ' +
    '  .sg-strip { padding: 7px 40px 7px 16px; } ' +
    '  .sg-strip-text { font-size: 0.72rem; } ' +
    '  .sg-strip-cta { font-size: 0.66rem; } ' +
    '} ';

  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    var el = document.createElement('style');
    el.id = id;
    el.textContent = css;
    document.head.appendChild(el);
  }

  function renderStrip() {
    if (!campaignRunning()) return;
    if (path.indexOf('/christmas-minis') === 0) return;
    try {
      if (window.localStorage.getItem(CAMPAIGN.dismissKey) === '1') return;
    } catch (e) { /* private browsing — show it, don't crash */ }

    injectCss('sg-strip-css', STRIP_CSS);
    var strip = document.createElement('div');
    strip.className = 'sg-strip';
    strip.innerHTML =
      '<a class="sg-strip-link" href="' + CAMPAIGN.href + '">' +
        '<span class="sg-strip-text">' + CAMPAIGN.stripText + '</span>' +
        '<span class="sg-strip-cta">' + CAMPAIGN.stripCta + ' &rarr;</span>' +
      '</a>' +
      '<button class="sg-strip-x" aria-label="Dismiss announcement"></button>';
    document.body.insertBefore(strip, document.body.firstChild);
    document.documentElement.classList.add('sg-has-strip');

    strip.querySelector('.sg-strip-x').addEventListener('click', function () {
      strip.remove();
      document.documentElement.classList.remove('sg-has-strip');
      try { window.localStorage.setItem(CAMPAIGN.dismissKey, '1'); } catch (e) {}
    });
  }

  if (campaignRunning()) injectCss('sg-campaign-css', CAMPAIGN_CSS);
  renderStrip();
  renderNav();
  renderFooter();

  // Mobile menu (unchanged behaviour; elements now rendered above).
  var closeMenu = function () { document.body.classList.remove('menu-open'); };
  var ham = document.getElementById('ham');
  var close = document.getElementById('menu-close');
  if (ham) ham.addEventListener('click', function () {
    document.body.classList.toggle('menu-open');
  });
  if (close) close.addEventListener('click', closeMenu);
  document.querySelectorAll('.nav-right a').forEach(function (a) {
    a.addEventListener('click', closeMenu);
  });
})();
