// Booking events → Studio's Bookings screen (booking workflow stage B, 8 Oct 2026).
//
// Server-to-server, same shape as the questionnaire consent sync: Studio's
// booking-intake behind its own shared secret (BOOKING_INGEST_SECRET, set on
// both sites), URL in STUDIO_BOOKING_INGEST_URL.
//
// NEVER throws and never holds the caller up for long: every caller has already
// done what the client paid for or asked for (the booking, the signed terms,
// the questionnaire). A missed event leaves a gap on the Bookings screen; the
// [S&G] emails remain the record.

const TIMEOUT_MS = 5000;

async function postBookingEvent(event) {
  const url = process.env.STUDIO_BOOKING_INGEST_URL;
  const secret = process.env.BOOKING_INGEST_SECRET;
  if (!url || !secret) {
    console.log(`studio-sync: ${event && event.type} not sent — STUDIO_BOOKING_INGEST_URL or BOOKING_INGEST_SECRET not set`);
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      console.error(`studio-sync: ${event.type} refused (${res.status}): ${body.error || 'no detail'}`);
      return false;
    }
    console.log(`studio-sync: ${event.type} recorded${body.matched === false ? ' (no matching booking)' : ''}`);
    return true;
  } catch (err) {
    console.error(`studio-sync: ${event && event.type} failed:`, err.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { postBookingEvent };
