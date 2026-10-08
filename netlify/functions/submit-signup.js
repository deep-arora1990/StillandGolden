const { Resend } = require('resend');
const { upsertResendContact } = require('./lib/resend-contacts');

/**
 * Email-list sign-up — the "Hear about the next one first" form on /offers
 * (6 Oct 2026).
 *
 * Signing up IS the consent, so the contact is stored subscribed — the one
 * case where that is right without a tick box, because there is nothing else
 * the form could be for. Then two emails: a short welcome to the subscriber
 * (which also surfaces a mistyped address) and a notification to Deep, who
 * asked to hear about every sign-up.
 *
 * Unlike the enquiry form, a failure to save the contact IS reported: the
 * list is the whole point here, and "Thanks, you're on the list" must not be
 * shown to someone who isn't.
 */

const OWNER = 'hello@stillandgolden.com.au';
const FROM = 'Still & Golden <notifications@stillandgolden.com.au>';
const SITE = 'https://stillandgolden.com.au';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Loose on purpose (as in unsubscribe.js): only obvious junk is turned away.
const looksLikeEmail = (value) => typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function welcomeHtml(firstName, email) {
  const unsubscribe = `${SITE}/unsubscribe?e=${encodeURIComponent(email)}`;
  const hi = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi there,';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#E8E3DC;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E8E3DC;">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td height="4" style="background-color:#A8845A;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td align="center" style="padding:36px 48px 24px;background-color:#F8F5F1;">
          <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:18px;letter-spacing:0.2em;color:#1A1714;text-transform:uppercase;">STILL &amp; GOLDEN</p>
          <p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.18em;color:#A8845A;text-transform:uppercase;">Photography</p>
        </td>
      </tr>
      <tr>
        <td style="background-color:#F8F5F1;padding:16px 48px 16px;">
          <p style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;color:#1A1714;">${hi}</p>
          <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#1A1714;">You&rsquo;re on the list. I&rsquo;ll be in touch when there&rsquo;s something worth knowing &mdash; a new mini session date, a seasonal offer, or when bookings open for something new.</p>
          <p style="margin:0 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#1A1714;">The current offers are on the website if you&rsquo;d like a look in the meantime.</p>
          <p style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#1A1714;">Deep</p>
          <p style="margin:0 0 32px;font-family:Georgia,'Times New Roman',serif;font-size:14px;font-style:italic;color:#A8845A;">Still &amp; Golden Photography</p>
        </td>
      </tr>
      <tr>
        <td style="background-color:#F8F5F1;padding:0 48px 44px;">
          <table cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#1A1714;">
            <a href="${SITE}/offers" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;color:#F8F5F1;text-decoration:none;text-transform:uppercase;">See the current offers</a>
          </td></tr></table>
        </td>
      </tr>
      <tr>
        <td style="background-color:#1A1714;padding:24px 48px;">
          <p style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-size:12px;letter-spacing:0.14em;color:#A8845A;text-transform:uppercase;">Still &amp; Golden Photography</p>
          <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8A7E78;">Newborn &amp; Family &middot; South-east Melbourne &middot; ABN 37 280 912 036</p>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8A7E78;">You signed up at stillandgolden.com.au. <a href="${unsubscribe}" style="color:#A8845A;">Unsubscribe</a> any time.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const key = process.env.RESEND_API_KEY;
  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request' });
  }

  // Honeypot first: a bot gets a quiet success and nothing is stored or sent.
  if (data['bot-field']) return json(200, { success: true });

  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const firstName = typeof data.first_name === 'string' ? data.first_name.trim().slice(0, 80) : '';
  const source = typeof data.source === 'string' ? data.source.slice(0, 40) : 'website';
  if (!looksLikeEmail(email)) return json(400, { error: 'Please enter a valid email address.' });

  if (!key) {
    // Local preview (netlify dev, no keys): validated as above, then logged
    // instead of sent. Never true on the live site.
    if (process.env.NETLIFY_DEV === 'true') {
      console.log('submit-signup [dev, nothing sent]:', JSON.stringify({ firstName, email, source }));
      return json(200, { success: true, dev: true });
    }
    console.error('submit-signup: RESEND_API_KEY is not set');
    return json(500, { error: 'Email service is not configured.' });
  }

  try {
    await upsertResendContact({ email, firstName, marketingConsent: true });
  } catch (err) {
    console.error('submit-signup: contact not saved:', err.message);
    return json(500, { error: 'Something went wrong — please try again.' });
  }

  // Resend allows 2 requests a second; the upsert may have used both.
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const resend = new Resend(key);
  const results = await Promise.allSettled([
    resend.emails.send({
      from: FROM,
      to: email,
      subject: 'You’re on the list — Still & Golden',
      html: welcomeHtml(firstName, email),
      headers: {
        'List-Unsubscribe': `<${SITE}/.netlify/functions/unsubscribe?e=${encodeURIComponent(email)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
    resend.emails.send({
      from: FROM,
      to: OWNER,
      subject: `[S&G] New email sign-up — ${firstName || email}`,
      text: [
        `New sign-up to the email list`,
        firstName ? `Name: ${firstName}` : null,
        `Email: ${email}`,
        `Signed up on: ${source === 'offers' ? 'the offers page (/offers)' : source}`,
      ].filter(Boolean).join('\n'),
    }),
  ]);
  // The contact is saved, so the sign-up has worked; a mail hiccup is logged
  // rather than turned into an error the visitor would retry.
  results.forEach((r, i) => {
    const failed = r.status === 'rejected' ? r.reason : r.value && r.value.error;
    if (failed) console.error(`submit-signup: ${i === 0 ? 'welcome' : 'notification'} email failed:`, failed.message || failed);
  });

  return json(200, { success: true });
};
