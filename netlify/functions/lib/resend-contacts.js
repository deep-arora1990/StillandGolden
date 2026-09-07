// Shared Resend contact upsert for the booking/sync functions.
//
// Raw fetch, not the SDK: resend v4 doesn't type custom contact `properties`
// (e.g. `phone`), and those are the whole point here. Create-first, then PATCH
// on duplicate — create on an existing email doesn't error cleanly in all
// cases, and PATCH /contacts/{email} 404s for unknown emails, so the order
// matters. Throws on any non-OK that isn't a duplicate.

const GENERAL_AUDIENCE_ID = '09483754-cd3f-4537-9990-001237752466';
const API = 'https://api.resend.com';

// Returns { created } — false when the contact already existed and was
// updated instead (the backfill path).
//
// Verified behaviour (22 Aug 2026): the create endpoint silently IGNORES
// `properties` — and on an existing email it returns 200 with the contact
// rather than a duplicate error. So when a phone (or any property) is
// present, the create is always followed by a PATCH, which does store
// properties. PATCH /contacts/{email} 404s for unknown emails, hence
// create-first ordering.
/**
 * `marketingConsent` decides the contact's subscription state, and it is
 * deliberately asymmetric:
 *
 *   - On CREATE, a contact with no consent is stored `unsubscribed: true`.
 *     They still exist as a record (so transactional mail and CRM lookups
 *     work — those don't consult the audience), but broadcasts skip them.
 *   - On UPDATE, `unsubscribed` is sent ONLY when consent was explicitly
 *     given. Previously the field was hardcoded `false` and included in the
 *     PATCH body, so a customer who had unsubscribed was silently
 *     re-subscribed the next time they booked — undoing the very choice
 *     /unsubscribe exists to record. Omitting the field leaves their
 *     preference untouched.
 */
async function upsertResendContact({ email, firstName, lastName, phone, marketingConsent = false }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');

  const body = {
    email,
    first_name: firstName || '',
    last_name: lastName || '',
  };
  const createBody = { ...body, unsubscribed: !marketingConsent };
  // Only send the property when there's a value — never blank out an
  // existing phone with an empty one.
  if (phone) body.properties = { phone };

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  if (phone) createBody.properties = body.properties;

  const create = await fetch(`${API}/audiences/${GENERAL_AUDIENCE_ID}/contacts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody),
  });

  let created = false;
  if (create.ok) {
    created = true; // …or a duplicate that returned 200 — see comment above
  } else {
    const createErr = await create.json().catch(() => ({}));
    const msg = createErr.message || '';
    const duplicate = create.status === 409 || /already exists|duplicate/i.test(msg);
    if (!duplicate) {
      throw new Error(`Resend create failed (HTTP ${create.status}): ${msg}`);
    }
  }

  // PATCH when there's a property to store, or when the create told us this
  // was a duplicate (so name/unsubscribe changes still land).
  if (body.properties || !created) {
    // Fresh, explicit consent is the only thing that may flip an existing
    // contact back to subscribed. Silence never changes their state.
    const patchBody = marketingConsent ? { ...body, unsubscribed: false } : body;
    const update = await fetch(`${API}/contacts/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patchBody),
    });
    if (!update.ok) {
      const updateErr = await update.json().catch(() => ({}));
      throw new Error(`Resend update failed (HTTP ${update.status}): ${updateErr.message || ''}`);
    }
    created = false;
  }

  return { created };
}

module.exports = { upsertResendContact, GENERAL_AUDIENCE_ID };
