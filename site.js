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
  var NAV_LINKS = [
    { href: '/portfolio', label: 'Portfolio' },
    { href: '/about', label: 'About' },
    { href: '/#sessions', label: 'Sessions &amp; Pricing' },
    { href: '/#faq', label: 'Common Questions' },
    { href: '/blog/', label: 'Blog' },
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
    '<span class="footer-copy"><a href="/glimpse-mini-sessions" style="' + FOOTER_LINK_STYLE + '">Glimpse Minis</a> &middot; <a href="/golden-family-photography" style="' + FOOTER_LINK_STYLE + '">Golden Family</a> &middot; <a href="/gathered-newborn-photography" style="' + FOOTER_LINK_STYLE + '">Gathered Newborn</a> &middot; <a href="/blog/" style="' + FOOTER_LINK_STYLE + '">Blog</a></span>' +
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
    '/book',
  ];

  function isActive(href) {
    if (href === '/portfolio') return path === '/portfolio' || path === '/portfolio.html';
    if (href === '/about') return path === '/about' || path === '/about.html';
    if (href === '/blog/') return path.indexOf('/blog') === 0;
    if (href === '/#sessions') {
      return SESSION_PAGES.some(function (p) { return path === p || path === p + '.html'; });
    }
    return false;
  }

  function renderNav() {
    var nav = document.querySelector('[data-sg-nav]');
    if (!nav) return;

    var links = NAV_LINKS.map(function (l) {
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
