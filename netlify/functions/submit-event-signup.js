const { Resend } = require('resend');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EVENT_INGEST_SECRET = process.env.EVENT_INGEST_SECRET;
const STUDIO_INGEST_URL = process.env.STUDIO_INGEST_URL;

const EVENT_SLUG = 'fathers-day-2026';
const AUDIENCE_NAME = "Father's Day";

// Resolved by name at runtime rather than hardcoded: the audience is created on
// first use, so there's no manual dashboard step and no ID to keep in sync.
let cachedAudienceId = null;

async function getAudienceId(resend) {
  if (cachedAudienceId) return cachedAudienceId;

  const { data: list } = await resend.audiences.list();
  const existing = (list?.data ?? []).find((a) => a.name === AUDIENCE_NAME);
  if (existing) {
    cachedAudienceId = existing.id;
    return cachedAudienceId;
  }

  const { data: created, error } = await resend.audiences.create({ name: AUDIENCE_NAME });
  if (error) throw new Error(`Could not create the ${AUDIENCE_NAME} audience: ${error.message}`);
  cachedAudienceId = created.id;
  return cachedAudienceId;
}

function thankYouHtml(firstName, childName) {
  const child = childName ? ` and ${childName}` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#E8E3DC;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E8E3DC;">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td height="4" style="background-color:#A8845A;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td align="center" style="padding:40px 48px 28px;background-color:#F8F5F1;">
          <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:0.18em;color:#1A1714;text-transform:uppercase;">Still &amp; Golden</p>
          <p style="margin:4px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:0.2em;color:#A8845A;text-transform:uppercase;">Photography</p>
        </td>
      </tr>
      <tr><td style="background-color:#F8F5F1;padding:0 48px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #D4C4B0;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
      <tr>
        <td style="background-color:#F8F5F1;padding:40px 48px 16px;">
          <p style="margin:0 0 28px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:normal;line-height:1.3;color:#1A1714;">Hi ${firstName},</p>
          <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#1A1714;">Thanks for coming along to the Father&rsquo;s Day class &mdash; it was lovely to meet you${child}.</p>
          <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#1A1714;">Your photos will be ready within two weeks. I&rsquo;ll email them straight through as soon as they&rsquo;re edited, along with how to grab the ones you&rsquo;d like.</p>
          <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#1A1714;">If today left you wanting more than a few frames, a full session gives you proper time together &mdash; an hour, twenty edited images, in your own home or somewhere outdoors you love. Sessions start from $195.</p>
          <p style="margin:0 0 36px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#1A1714;">No rush at all &mdash; have a look whenever suits.</p>
          <p style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#1A1714;">Deep</p>
          <p style="margin:0 0 36px;font-family:Georgia,'Times New Roman',serif;font-size:14px;font-style:italic;color:#A8845A;">Still &amp; Golden Photography</p>
        </td>
      </tr>
      <tr>
        <td style="background-color:#F8F5F1;padding:0 48px 48px;">
          <table cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#1A1714;">
            <a href="https://stillandgolden.com.au/book" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;color:#F8F5F1;text-decoration:none;text-transform:uppercase;">See session options</a>
          </td></tr></table>
        </td>
      </tr>
      <tr>
        <td style="background-color:#1A1714;padding:28px 48px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:12px;letter-spacing:0.14em;color:#A8845A;text-transform:uppercase;padding-bottom:6px;">Still &amp; Golden Photography</td></tr>
            <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8A7E78;padding-bottom:3px;">Newborn &amp; Family &middot; South-east Melbourne</td></tr>
            <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:11px;padding-bottom:3px;"><a href="https://stillandgolden.com.au" style="color:#A8845A;text-decoration:none;">stillandgolden.com.au</a></td></tr>
            <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8A7E78;padding-bottom:20px;"><a href="https://instagram.com/stillandgoldenphotography" style="color:#8A7E78;text-decoration:none;">@stillandgoldenphotography</a></td></tr>
            <tr><td style="border-top:1px solid #2E2A27;padding-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#4A4440;">ABN 37 280 912 036</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  // Honeypot — same approach as the enquiry form.
  if (body['bot-field']) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, number: null }) };
  }

  const email = String(body.email || '').trim().toLowerCase();
  const childName = String(body.childName || '').trim();
  const phone = String(body.phone || '').trim();
  const p1First = String(body.parent1FirstName || '').trim();
  const p1Last = String(body.parent1LastName || '').trim();
  const p2First = String(body.parent2FirstName || '').trim();
  const p2Last = String(body.parent2LastName || '').trim();

  // Email is the only required field — everything else is optional, because a
  // partly-filled sign-up still lets the photos reach the family.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }

  // 1. Store first. The sign-up existing matters more than the email landing —
  // if this fails there's nothing to photograph against, so it's the only step
  // that returns an error to the parent.
  let number = null;
  try {
    const res = await fetch(STUDIO_INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': EVENT_INGEST_SECRET },
      body: JSON.stringify({
        eventSlug: EVENT_SLUG,
        parent1FirstName: p1First,
        parent1LastName: p1Last,
        parent2FirstName: p2First,
        parent2LastName: p2Last,
        childName,
        email,
        phone,
        marketingConsent: body.marketingConsent === true,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `store failed (${res.status})`);
    number = data.number;
  } catch (err) {
    console.error('Event sign-up storage failed:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Sorry — that didn't save. Please try again, or grab Deep." }),
    };
  }

  // 2. Email and audience are best-effort: the parent is already on the list,
  // and failing them here would show an error for something that worked.
  if (RESEND_API_KEY) {
    const resend = new Resend(RESEND_API_KEY);
    // Falls back to a neutral greeting when no name was given.
    const firstName = p1First || 'there';

    try {
      await resend.emails.send({
        from: 'Still & Golden Photography <hello@stillandgolden.com.au>',
        to: email,
        subject: 'Thanks for coming along today',
        html: thankYouHtml(firstName, childName),
      });
    } catch (err) {
      console.error('Thank-you email failed:', err.message);
    }

    try {
      const audienceId = await getAudienceId(resend);
      await resend.contacts.create({
        audienceId,
        email,
        firstName: p1First,
        lastName: p1Last,
      });
    } catch (err) {
      console.error('Adding to the Father\'s Day audience failed:', err.message);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, number }) };
};
