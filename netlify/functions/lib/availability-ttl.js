// How long a month's availability stays fresh in the shared cache.
//
// Distance-based, because how fast availability changes depends on how far out
// it is. This month and next move daily as people book; next June barely moves
// from one day to the next. Agreed with Deep 24 Sep 2026:
//
//   0–1 months ahead   15 minutes
//   2–3 months ahead   2 hours
//   4+  months ahead   24 hours
//
// A change Deep makes in Setmore (opening a weekday, say) is picked up at the
// next expiry, or immediately via the Studio refresh button, which clears the
// cache. A booking through the site clears its own month straight away.

const MINUTE = 60 * 1000;

function monthsAhead(year, month, today) {
  return (year * 12 + month) - (today.year * 12 + today.month);
}

function ttlForMonth(year, month, today) {
  const ahead = monthsAhead(year, month, today);
  if (ahead <= 1) return 15 * MINUTE;
  if (ahead <= 3) return 120 * MINUTE;
  return 24 * 60 * MINUTE;
}

function isFresh(entry, ttlMs, now = Date.now()) {
  return Boolean(entry) && typeof entry.fetchedAt === 'number' && now - entry.fetchedAt < ttlMs;
}

module.exports = { monthsAhead, ttlForMonth, isFresh, MINUTE };
