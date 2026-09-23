// A month's availability, per service, in the shared store.
//
// Keys are `${serviceKey}/${yyyy-mm}`. Every function here swallows storage
// errors and logs them: the cache is an optimisation, and a Blobs hiccup must
// degrade to "check Setmore again", never to a failed booking page.

const { availabilityStore } = require('./shared-store');

const pad = (n) => String(n).padStart(2, '0');
const monthPart = (year, month) => `${year}-${pad(month)}`;
const keyFor = (serviceKey, year, month) => `${serviceKey}/${monthPart(year, month)}`;

async function readMonth(serviceKey, year, month) {
  try {
    return await availabilityStore().get(keyFor(serviceKey, year, month), { type: 'json' });
  } catch (err) {
    console.warn('availability-cache: read failed:', err.message);
    return null;
  }
}

async function writeMonth(serviceKey, year, month, availableDates) {
  try {
    await availabilityStore().setJSON(keyFor(serviceKey, year, month), { availableDates, fetchedAt: Date.now() });
  } catch (err) {
    console.warn('availability-cache: write failed:', err.message);
  }
}

// A booking on a given day affects every package — they share one calendar —
// so a month is cleared for all services, not just the one booked.
async function clearMonth(year, month) {
  return clearWhere((key) => key.endsWith(`/${monthPart(year, month)}`));
}

async function clearAll() {
  return clearWhere(() => true);
}

async function clearWhere(match) {
  try {
    const s = availabilityStore();
    const { blobs } = await s.list();
    const doomed = blobs.map((b) => b.key).filter(match);
    await Promise.all(doomed.map((k) => s.delete(k)));
    return doomed.length;
  } catch (err) {
    console.warn('availability-cache: clear failed:', err.message);
    return 0;
  }
}

module.exports = { readMonth, writeMonth, clearMonth, clearAll, keyFor };
