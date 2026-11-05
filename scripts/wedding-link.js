#!/usr/bin/env node
// Mint a private wedding booking link locally (for netlify dev).
// node scripts/wedding-link.js --first Sam --last Lee --email sam@example.com [--base http://localhost:8888] [--days 30]
const { mintWeddingLink, WEDDING_LINK_DAYS } = require('../netlify/functions/lib/weddings');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

if (!process.env.BOOKING_LINK_SECRET) {
  console.error('BOOKING_LINK_SECRET is not set. Export it first (it signs the link).');
  process.exit(1);
}
const firstName = opt('first');
const email = opt('email');
if (!firstName || !email) {
  console.error('Usage: node scripts/wedding-link.js --first Sam --last Lee --email sam@example.com [--base http://localhost:8888] [--days 30]');
  process.exit(1);
}
const link = mintWeddingLink(
  { firstName, lastName: opt('last') || '', email },
  { days: Number(opt('days')) || WEDDING_LINK_DAYS, ...(opt('base') ? { base: opt('base') } : {}) },
);
console.log(link.url);
console.log(`Expires ${link.expiresAt}`);
