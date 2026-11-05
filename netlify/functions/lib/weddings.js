// Private wedding booking links (Nov 2026). Deep sends each couple a signed
// link; only it opens /book-wedding and reaches wedding availability, slots
// and checkout. Same HMAC signing as the family links, with a `k` kind so the
// two can never stand in for each other.
const { sign, verify } = require('./booking-links');
const { todayInMelbourne } = require('./deposits');

const WEDDING_LINK_KIND = 'wedding-booking';
const WEDDING_LINK_DAYS = 30;
const WEDDING_MONTHS_AHEAD = 36;
const WEDDING_PAGE_PATH = '/book-wedding';

function mintWeddingLink({ firstName, lastName, email }, { now = Date.now(), days = WEDDING_LINK_DAYS, base = 'https://stillandgolden.com.au' } = {}) {
  const token = sign({ k: WEDDING_LINK_KIND, f: firstName || '', l: lastName || '', e: email || '' }, now, days);
  if (!token) return null;
  return {
    token,
    url: `${base}${WEDDING_PAGE_PATH}?t=${encodeURIComponent(token)}`,
    expiresAt: todayInMelbourne(new Date(now + days * 86400000)),
  };
}

function verifyWeddingLink(token, now = Date.now()) {
  let p;
  try { p = verify(token, now, { kind: WEDDING_LINK_KIND }); } catch { return null; }
  if (!p) return null;
  return { firstName: p.f || '', lastName: p.l || '', email: p.e || '', expiresAt: todayInMelbourne(new Date(p.x)) };
}

// Last day of the month WEDDING_MONTHS_AHEAD months after today's month.
function lastWeddingDate(today) {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + WEDDING_MONTHS_AHEAD + 1, 0));
  return d.toISOString().slice(0, 10);
}

function weddingDateProblem(date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return 'Pick your wedding date.';
  if (date <= today) return 'Your wedding date needs to be after today.';
  if (date > lastWeddingDate(today)) return `That date is further out than I can take bookings for yet (I open up to ${WEDDING_MONTHS_AHEAD} months ahead).`;
  return null;
}

module.exports = { WEDDING_LINK_KIND, WEDDING_LINK_DAYS, WEDDING_MONTHS_AHEAD, WEDDING_PAGE_PATH, mintWeddingLink, verifyWeddingLink, lastWeddingDate, weddingDateProblem };
