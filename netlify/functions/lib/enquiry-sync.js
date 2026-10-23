// Website enquiries → Studio's enquiry tracker (23 Oct 2026).
//
// Server-to-server, same shape as studio-sync.js: Studio's enquiry-intake
// behind its own shared secret (ENQUIRY_INGEST_SECRET, set on both sites), URL
// in STUDIO_ENQUIRY_INGEST_URL. Without either, nothing is sent.
//
// Never throws, and gives up on Studio once the time budget is spent: by the
// time this runs, the [S&G] email has reached Deep and the auto-reply has
// gone, so a missed post leaves a gap in the tracker and the email remains
// the record. Given `startedAt` (when the form's handler began), Studio gets
// what is left of 8 s, never less than 1 s; without it, 5 s.
//
// Logs carry status only, never the enquirer's name, email or phone.

const TIMEOUT_MS = 5000;
const BUDGET_MS = 8000;
const MIN_TIMEOUT_MS = 1000;

function timeoutFor(startedAt) {
  if (typeof startedAt !== 'number') return TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, BUDGET_MS - (Date.now() - startedAt));
}

async function postEnquiry(fields, { startedAt } = {}) {
  const url = process.env.STUDIO_ENQUIRY_INGEST_URL;
  const secret = process.env.ENQUIRY_INGEST_SECRET;
  if (!url || !secret) {
    console.log('enquiry-sync: not sent — STUDIO_ENQUIRY_INGEST_URL or ENQUIRY_INGEST_SECRET not set');
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor(startedAt));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
      body: JSON.stringify(fields),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      console.error(`enquiry-sync: refused (${res.status})`);
      return false;
    }
    console.log(`enquiry-sync: ${body.created === false ? 'updated' : 'recorded'}`);
    return true;
  } catch (err) {
    console.error(`enquiry-sync: failed (${err && err.name === 'AbortError' ? 'timed out' : 'unreachable'})`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { postEnquiry };
