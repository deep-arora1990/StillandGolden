// Checks a private wedding link and returns the couple and the two packages.
const { TIERS, WEDDING_TIER_KEYS } = require('./lib/setmore');
const { verifyWeddingLink, WEDDING_MONTHS_AHEAD } = require('./lib/weddings');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  const link = verifyWeddingLink((event.queryStringParameters || {}).t);
  if (!link) {
    return json(403, { error: { code: 'LINK_INVALID', message: "This link has expired or isn't quite right. Send me a message and I'll get you a fresh one." } });
  }
  return json(200, {
    ...link,
    monthsAhead: WEDDING_MONTHS_AHEAD,
    packages: WEDDING_TIER_KEYS.map((tier) => ({
      tier, name: TIERS[tier].name, lengthLabel: TIERS[tier].lengthLabel,
      serviceKey: TIERS[tier].serviceKey, priceCents: TIERS[tier].priceCents,
    })),
  });
};
