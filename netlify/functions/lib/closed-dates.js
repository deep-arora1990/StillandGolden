// Dates the website takes no bookings, for any session or offer — enforced here
// whatever Setmore says (12 Oct 2026). Deep's Setmore time off for his summer
// break blocked December, but Setmore's API kept offering the January weekends
// inside it. Ordinary day blocks in Setmore do reach the API; time off doesn't.
//
// Deep manages the list in Studio (Calendar → Time off). Studio sends the whole
// list to closed-dates.js on every change; it is kept in the shared store and
// read here, so a new break needs no code change.
//
// SEED applies only until Studio has sent a list for the first time. After
// that the saved list is the whole truth — an empty list means "no breaks",
// not "fall back to the seed".

const { closedDatesStore } = require('./shared-store');

const SEED = [
  ['2026-12-11', '2027-01-20'], // summer break, as first added in code
];

const KEY = 'ranges';
// Each instance re-reads at most once a minute. With Blobs' eventual
// consistency (up to 60s), a change in Studio is live within about two.
const MEMO_MS = 60 * 1000;
// Kept on a global, not in module state: under vitest a CJS `require` and an
// ESM `import` of this file are two instances (see shared-store.js), and tests
// must be able to start each case with nothing remembered.
const memoKey = '__sgClosedDatesMemo';
const getMemo = () => globalThis[memoKey] || null; // { ranges, at }
const setMemo = (m) => { globalThis[memoKey] = m; };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function realDate(s) {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// → [{ from, to }] or null if anything is wrong. All or nothing: half a list
// would quietly reopen the dates in the bad half.
function validRanges(input) {
  if (!Array.isArray(input) || input.length > 200) return null;
  const out = [];
  for (const r of input) {
    if (!r || !realDate(r.from) || !realDate(r.to) || r.from > r.to) return null;
    out.push({ from: r.from, to: r.to });
  }
  return out;
}

// → { ranges: [[from, to], …], known }. `known` is false only when the list
// could not be read and this instance has never read it; ranges are then the
// seed, so the calendar still shows, and booking-checkout refuses.
async function loadClosedDates() {
  const now = Date.now();
  const memo = getMemo();
  if (memo && now - memo.at < MEMO_MS) return { ranges: memo.ranges, known: true };
  try {
    const saved = await closedDatesStore().get(KEY, { type: 'json' });
    let ranges;
    if (saved === null) ranges = SEED;
    else {
      const valid = validRanges(saved && saved.ranges);
      if (!valid) throw new Error('saved list is malformed');
      ranges = valid.map((r) => [r.from, r.to]);
    }
    setMemo({ ranges, at: now });
    return { ranges, known: true };
  } catch (err) {
    console.error('closed-dates: could not read the list:', err.message);
    if (memo) return { ranges: memo.ranges, known: true };
    return { ranges: SEED, known: false };
  }
}

function isClosedIn(ranges, date) {
  return ranges.some(([from, to]) => date >= from && date <= to);
}

async function saveClosedDates(ranges) {
  await closedDatesStore().setJSON(KEY, { ranges, updatedAt: new Date().toISOString() });
  setMemo({ ranges: ranges.map((r) => [r.from, r.to]), at: Date.now() });
}

module.exports = { SEED, loadClosedDates, isClosedIn, validRanges, saveClosedDates };
