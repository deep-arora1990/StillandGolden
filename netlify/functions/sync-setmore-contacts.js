// GET/POST /.netlify/functions/sync-setmore-contacts
// Scheduled (daily 19:00 UTC ≈ 5am AEST) — also runnable by hand with a plain
// GET for testing. Completes the chain "Setmore customer → Resend → studio
// app": scans appointments from 90 days back to 90 days ahead, collects the
// unique customers, and upserts them into the Resend general audience.
// Idempotent: contacts that already exist are counted as "existing", never
// fail the run.

const { schedule } = require('@netlify/functions');
const { getAppointmentsInRange } = require('./lib/setmore');
const { upsertResendContact } = require('./lib/resend-contacts');

const RANGE_DAYS = 90;

const isoDate = (d) => d.toISOString().slice(0, 10);

// Setmore splits phone into country_code + cell_phone (either may be empty).
// Join into a single + international string when both are present.
function joinPhone(countryCode, cellPhone) {
  const phone = (cellPhone || '').trim();
  if (!phone) return '';
  if (phone.startsWith('+')) return phone;
  const cc = (countryCode || '').replace(/[^\d]/g, '');
  if (!cc) return phone;
  return `+${cc}${phone.replace(/^0+/, '')}`;
}

async function runSync() {
  const now = new Date();
  const startDate = isoDate(new Date(now.getTime() - RANGE_DAYS * 86400000));
  const endDate = isoDate(new Date(now.getTime() + RANGE_DAYS * 86400000));

  const appointments = await getAppointmentsInRange(startDate, endDate);

  // Unique customers by lowercase email; skip records with no usable email.
  const byEmail = new Map();
  for (const a of appointments) {
    const c = a.customer || {};
    const email = (c.email_id || '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        email,
        firstName: c.first_name || '',
        lastName: c.last_name || '',
        phone: joinPhone(c.country_code, c.cell_phone),
      });
    }
  }

  const summary = {
    range: { startDate, endDate },
    scanned: byEmail.size,
    created: 0,
    existing: 0,
    errors: [],
  };

  // Sequential on purpose: a handful of contacts per day in practice, and it
  // keeps us clear of Resend's 2 req/s limit. The upsert helper backfills
  // phone (etc.) onto contacts created before those fields existed — that's
  // the "existing" count.
  for (const contact of byEmail.values()) {
    try {
      const { created } = await upsertResendContact(contact);
      if (created) summary.created++;
      else summary.existing++;
    } catch (err) {
      summary.errors.push(`${contact.email}: ${err.message}`);
      console.error('sync contact error:', contact.email, err.message);
    }
  }

  console.log('sync-setmore-contacts:', JSON.stringify({ ...summary, errors: summary.errors.length }));
  return summary;
}

const handler = async () => {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set in the environment.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Resend is not configured' }) };
  }

  try {
    const summary = await runSync();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary),
    };
  } catch (err) {
    console.error('sync-setmore-contacts failed:', err);
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};

module.exports.handler = schedule('0 19 * * *', handler);
