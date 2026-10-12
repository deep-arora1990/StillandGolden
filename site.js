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
    // Off since 12 Oct 2026 (Deep: the strip isn't needed any more). Set back
    // to true, with new text and a new dismissKey, for the next campaign.
    live: false,
    endsAt: '2026-11-09',              // first day the strip should NOT show
    href: '/christmas-minis',
    stripText: 'Christmas minis \u00b7 Sunday 8 November \u00b7 limited spots',
    stripCta: 'Book your time',
    // While every time is booked, the strip sends people to the offers still
    // open instead (12 Oct 2026). Which one shows comes from checkXmas().
    soldHref: '/offers',
    soldText: 'Christmas minis are sold out \u00b7 in-home Christmas sessions still open',
    soldCta: 'See the offers',
    dismissKey: 'sg-strip-xmas-2026',  // versioned: a future campaign gets a new key
  };

  // Christmas minis: sold out or not, from the live calendar (12 Oct 2026),
  // so a cancellation reopens everything without a code change. One call to
  // booking-availability — the shared, cached month (15 min this close; a
  // booking through the site clears it at once) — remembered for 5 minutes
  // per visitor. Pages mark their two versions with .xmas-open / .xmas-sold
  // and hide the wrong one from <html data-xmas> in their own CSS; with no
  // answer (still loading, or the check failed) the sold-out version shows,
  // so the site never invites a booking it can't take.
  var XMAS = {
    serviceKey: 'e1a1b152-9b9c-49c9-950d-caa62f3f1b82',
    date: '2026-11-08',
    cacheKey: 'sg-xmas-open',
  };

  function checkXmas(cb) {
    try {
      var c = JSON.parse(window.sessionStorage.getItem(XMAS.cacheKey) || 'null');
      if (c && Date.now() - c.at < 5 * 60 * 1000) { cb(c.open); return; }
    } catch (e) {}
    fetch('/.netlify/functions/booking-availability?service_key=' + XMAS.serviceKey +
      '&year=' + XMAS.date.slice(0, 4) + '&month=' + Number(XMAS.date.slice(5, 7)))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.availableDates)) return;
        var open = d.availableDates.indexOf(XMAS.date) !== -1;
        try { window.sessionStorage.setItem(XMAS.cacheKey, JSON.stringify({ open: open, at: Date.now() })); } catch (e) {}
        cb(open);
      })
      .catch(function () {});
  }

  function campaignRunning() {
    return CAMPAIGN.live && new Date().toISOString().slice(0, 10) < CAMPAIGN.endsAt;
  }

  var NAV_LINKS = [
    { href: '/portfolio', label: 'Portfolio' },
    { href: '/about', label: 'About' },
    { href: '/packages', label: 'Packages' },
    { href: '/#faq', label: 'Common Questions' },
    { href: '/blog/', label: 'Blog' },
    { href: '/offers', label: 'Offers' },
    { href: '/#contact', label: 'Enquire now', className: 'book' },
  ];

  // The footer markup carries the class names the self-styled pages
  // (portfolio) use, plus the link styles site.css would otherwise provide —
  // identical rendering in both worlds.
  var FOOTER_LINK_STYLE = 'color:var(--mid);text-decoration:none;border-bottom:1px solid rgba(138,126,120,0.3);';
  var FOOTER_HTML =
    '<span class="footer-logo">Still &amp; Golden</span>' +
    '<span class="footer-copy">&copy; 2026 Still &amp; Golden Photography &middot; ABN 37 280 912 036</span>' +
    '<span class="footer-area">Cranbourne &middot; Clyde North &middot; Berwick &middot; Narre Warren &middot; Frankston &middot; Langwarrin &middot; Mt Eliza</span>' +
    '<span class="footer-copy">' + '<a href="/offers" style="' + FOOTER_LINK_STYLE + '">Offers</a> &middot; ' + '<a href="/packages/glimpse-mini-sessions" style="' + FOOTER_LINK_STYLE + '">Glimpse Minis</a> &middot; <a href="/packages/golden-family-photography" style="' + FOOTER_LINK_STYLE + '">Golden Family</a> &middot; <a href="/packages/gathered-newborn-photography" style="' + FOOTER_LINK_STYLE + '">Gathered Newborn</a> &middot; <a href="/packages/bloom-maternity-newborn-photography" style="' + FOOTER_LINK_STYLE + '">Bloom Bundle</a> &middot; <a href="/packages" style="' + FOOTER_LINK_STYLE + '">Packages</a> &middot; <a href="/blog/" style="' + FOOTER_LINK_STYLE + '">Blog</a></span>' +
    '<a href="/privacy" class="footer-copy" style="' + FOOTER_LINK_STYLE + '">Privacy Policy</a>';

  var path = location.pathname;

  // The tier landing pages live under /packages/ (30 Sep 2026), so the
  // prefix covers them all; the booking widget belongs to Packages too.
  // Seasonal pages — /offers and the Christmas minis campaign it lists —
  // mark Offers instead.
  var OFFER_PAGES = ['/offers', '/christmas-minis', '/christmas-minis-terms'];

  function isActive(href) {
    if (href === '/portfolio') return path === '/portfolio' || path === '/portfolio.html';
    if (href === '/about') return path === '/about' || path === '/about.html';
    if (href === '/packages') {
      return path === '/packages' || path === '/packages.html' ||
        path.indexOf('/packages/') === 0 || path === '/book' || path === '/book.html';
    }
    if (href === '/offers') {
      return path.indexOf('/offers/') === 0 ||
        OFFER_PAGES.some(function (p) { return path === p || path === p + '.html'; });
    }
    if (href === '/blog/') return path.indexOf('/blog') === 0;
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
  // Seven links (Offers joined on 30 Sep 2026) wrap the row on mid-width
  // screens at the default 32px gap, so it is tightened there. This used to
  // apply only while a campaign ran; it is needed whenever Offers is in the
  // menu, so it now always applies.
  var NAV_TIGHT_CSS =
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
    if (path === CAMPAIGN.soldHref || path === CAMPAIGN.soldHref + '.html') return;
    try {
      if (window.localStorage.getItem(CAMPAIGN.dismissKey) === '1') return;
    } catch (e) { /* private browsing — show it, don't crash */ }

    injectCss('sg-strip-css', STRIP_CSS);
    var strip = document.createElement('div');
    strip.className = 'sg-strip';
    strip.innerHTML =
      '<a class="sg-strip-link" href="' + CAMPAIGN.soldHref + '">' +
        '<span class="sg-strip-text">' + CAMPAIGN.soldText + '</span>' +
        '<span class="sg-strip-cta">' + CAMPAIGN.soldCta + ' &rarr;</span>' +
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

  injectCss('sg-nav-tight-css', NAV_TIGHT_CSS);
  renderStrip();

  function applyXmas(open) {
    document.documentElement.setAttribute('data-xmas', open ? 'open' : 'sold');
    var link = document.querySelector('.sg-strip-link');
    if (!link) return;
    link.setAttribute('href', open ? CAMPAIGN.href : CAMPAIGN.soldHref);
    link.querySelector('.sg-strip-text').textContent = open ? CAMPAIGN.stripText : CAMPAIGN.soldText;
    link.querySelector('.sg-strip-cta').innerHTML = (open ? CAMPAIGN.stripCta : CAMPAIGN.soldCta) + ' &rarr;';
  }
  if (document.querySelector('.sg-strip, .xmas-open, .xmas-sold')) checkXmas(applyXmas);
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
