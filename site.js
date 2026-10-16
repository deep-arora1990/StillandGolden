// Still & Golden — shared site behaviour.
//
// The menu and footer are written into every page at build time (build.js,
// from build/site-chrome.js — the single source since 16 Oct 2026), so search
// engines see them and nothing flashes in. This script only wires them up:
// the hamburger toggles a full-screen menu (body.menu-open), which closes via
// the X button or when any menu link is tapped. It also runs the campaign
// strip (switched off) and the Christmas minis sold-out check.

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

  var path = location.pathname;

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
