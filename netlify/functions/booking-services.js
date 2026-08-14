// GET /.netlify/functions/booking-services
// Returns the four session tiers for the booking widget's session picker.
// Data comes from the shared config (service keys are public identifiers that
// already appear in the site's Setmore booking links), so no Setmore call is
// needed and this endpoint always answers instantly.

const { TIERS } = require('./lib/setmore');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Hidden tiers (fixed-date offers like Father's Day minis) have their own
  // campaign pages — never show them in the main /book picker.
  const services = Object.entries(TIERS)
    .filter(([, cfg]) => !cfg.hidden)
    .map(([tier, cfg]) => ({
      tier,
      name: cfg.name,
      tagline: cfg.tagline,
      durationMinutes: cfg.durationMinutes,
      priceFrom: cfg.priceFrom,
      includes: cfg.includes,
      serviceKey: cfg.serviceKey,
    }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    body: JSON.stringify({ services }),
  };
};
