// Still & Golden — analytics configuration and event helper.
//
// The `<script async src=".../gtag/js?id=AW-18178273358">` loader stays in each
// page's <head>; this file holds the config that used to be copy-pasted inline
// into every page, so adding an event no longer means editing 16 files.
//
// Load it with a plain (non-deferred) script tag right after the loader, so
// `gtag` exists before any later inline script runs.
//
// Analytics only run on the production domain. Netlify draft deploys
// (…--stillandgolden.netlify.app) and local dev serve these same files, and
// preview/dev traffic must not pollute the GA4/Ads account.

var SG_PROD_HOSTS = ['stillandgolden.com.au', 'www.stillandgolden.com.au'];

if (SG_PROD_HOSTS.indexOf(location.hostname) === -1) {
  // Non-production: keep the helpers callable (the enquiry redirect must still
  // work) but send nothing anywhere.
  window.sgTrack = function () {};
  window.gtag_report_conversion = function (url) {
    if (typeof (url) != 'undefined') { window.location = url; }
    return false;
  };
} else {

window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }

gtag('js', new Date());
gtag('config', 'AW-18178273358'); // Google Ads
gtag('config', 'G-R92YP24HMJ');   // GA4

/**
 * Send a GA4 event.
 *
 * Analytics must never be able to break a page — least of all the booking
 * flow — so this swallows everything: a blocked tag, an ad blocker removing
 * gtag, a network failure. Callers can fire and forget.
 */
window.sgTrack = function (name, params) {
  try {
    if (typeof gtag !== 'function') return;
    gtag('event', name, params || {});
  } catch (e) {
    /* analytics is never worth an exception */
  }
};

/**
 * Ads conversion for enquiry submissions. Unchanged behaviour — kept here so
 * the pages that call it don't each carry their own copy.
 * Note `send_to` routes this to Google Ads only; GA4 gets `generate_lead`.
 */
function gtag_report_conversion(url) {
  var callback = function () {
    if (typeof (url) != 'undefined') { window.location = url; }
  };
  gtag('event', 'conversion', {
    send_to: 'AW-18178273358/P64aCMayzbAcEM7gidxD',
    value: 1.0,
    currency: 'AUD',
    event_callback: callback
  });
  return false;
}

}
