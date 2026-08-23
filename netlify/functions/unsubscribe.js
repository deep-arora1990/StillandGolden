const { Resend } = require('resend');

/**
 * Opt-out endpoint behind /unsubscribe.
 *
 * Marks the address unsubscribed in every Resend audience rather than adding a
 * global suppression. A suppression would also block genuinely transactional
 * mail — booking confirmations, contracts, gallery links — which is not what
 * someone opting out of marketing is asking for, and in a couple of cases is
 * mail they've paid for.
 *
 * Two shapes of POST arrive here:
 *   application/json                    {"email": "..."}  — the page's fetch
 *   application/x-www-form-urlencoded   List-Unsubscribe=One-Click, address in
 *                                       ?e= — RFC 8058, which mail clients use
 *                                       to render their own Unsubscribe button
 * RFC 8058 wants an empty 200 for the one-click POST and the opt-out honoured
 * within 48 hours; doing it inline satisfies both.
 */

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Deliberately loose. This only guards against obvious junk — Resend is the
// authority on whether an address exists, and rejecting an unusual-but-valid
// address would leave someone unable to opt out.
const looksLikeEmail = (value) => typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  const contentType = (event.headers['content-type'] || '').toLowerCase();
  const oneClick = contentType.includes('application/x-www-form-urlencoded');

  let email;
  if (oneClick) {
    // The address can't be in the body — the mail client controls that — so it
    // travels in the URL the List-Unsubscribe header was built with.
    email = (event.queryStringParameters || {}).e;
  } else {
    try {
      email = JSON.parse(event.body || '{}').email;
    } catch {
      return json(400, { ok: false, error: 'Malformed request' });
    }
  }

  if (!looksLikeEmail(email)) {
    return json(400, { ok: false, error: 'That doesn’t look like an email address.' });
  }
  email = email.trim().toLowerCase();

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set in the environment.');
    return json(500, { ok: false, error: 'Unsubscribe is not configured. Please email hello@stillandgolden.com.au.' });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data: list, error: listError } = await resend.audiences.list();
  if (listError) {
    console.error('Could not list audiences:', listError.message);
    return json(502, { ok: false, error: 'Could not reach our mailing list just now. Please try again shortly.' });
  }

  const audiences = list?.data ?? [];
  let updated = 0;
  const failures = [];

  for (const audience of audiences) {
    // Not being in a given audience is the normal case, not an error — most
    // contacts sit in one. Resend answers that with an error rather than a
    // no-op, so only genuine failures are collected.
    const { error } = await resend.contacts.update({
      audienceId: audience.id,
      email,
      unsubscribed: true,
    });
    if (!error) {
      updated += 1;
    } else if (error.name !== 'not_found') {
      failures.push(`${audience.name}: ${error.message}`);
    }
  }

  if (updated === 0 && failures.length > 0) {
    console.error(`Unsubscribe failed for ${email}:`, failures.join('; '));
    return json(502, { ok: false, error: 'Something went wrong. Please email hello@stillandgolden.com.au and I’ll remove you by hand.' });
  }

  console.log(`Unsubscribed ${email} from ${updated}/${audiences.length} audience(s)`);

  // RFC 8058: an empty 200 for the one-click POST.
  if (oneClick) return { statusCode: 200, body: '' };

  // updated === 0 with no failures means the address was in no audience —
  // already off the list, so from the reader's side the outcome is the same.
  return json(200, { ok: true, audiences: updated });
};
