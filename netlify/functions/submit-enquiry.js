const { Resend } = require('resend');
const https = require('https');

const RESEND_API_KEY = 're_h529UAzs_GYpeRshcGLi3TwXuN7zXLsPS';
const GENERAL_AUDIENCE_ID = '09483754-cd3f-4537-9990-001237752466';

const SESSION_LABELS = {
  newborn: 'Newborn (0–14 days)',
  family: 'Family session',
  combo: 'Newborn + family combo',
};

function autoResponseHtml(firstName) {
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
          <svg width="24" height="48" viewBox="0 0 100 200" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto;">
            <path d="M 50 195 C 49 162 45 118 48 78 C 51 42 54 20 52 5" stroke="#A8845A" stroke-width="4" stroke-linecap="round" fill="none"/>
            <g transform="translate(49,168) rotate(-28) scale(0.66)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="#A8845A"/></g>
            <g transform="translate(47,145) rotate(207) scale(0.70)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="#A8845A"/></g>
            <g transform="translate(46,122) rotate(-24) scale(0.72)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="#A8845A"/></g>
            <g transform="translate(48,96) rotate(204) scale(0.69)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="#A8845A"/></g>
            <g transform="translate(50,70) rotate(-30) scale(0.64)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="#A8845A"/></g>
            <g transform="translate(52,47) rotate(210) scale(0.59)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="#A8845A"/></g>
            <g transform="translate(53,26) rotate(-38) scale(0.48)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="#A8845A"/></g>
          </svg>
          <p style="margin:14px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:normal;letter-spacing:0.2em;color:#1A1714;text-transform:uppercase;">STILL &amp; GOLDEN</p>
          <p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.18em;color:#A8845A;text-transform:uppercase;">Photography</p>
        </td>
      </tr>
      <tr><td style="background-color:#F8F5F1;padding:0 48px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #D4C4B0;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
      <tr>
        <td style="background-color:#F8F5F1;padding:40px 48px 16px;">
          <p style="margin:0 0 28px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:normal;line-height:1.3;color:#1A1714;">Hi ${firstName},</p>
          <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#1A1714;">Thanks for reaching out &mdash; I&rsquo;ve got your message and I&rsquo;ll come back to you within 24 hours.</p>
          <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#1A1714;">In the meantime, if you&rsquo;d like to see how a session actually looks and feels, the portfolio and recent work are both on the website.</p>
          <p style="margin:0 0 36px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#1A1714;">Looking forward to chatting.</p>
          <p style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#1A1714;">Deep</p>
          <p style="margin:0 0 36px;font-family:Georgia,'Times New Roman',serif;font-size:14px;font-style:italic;color:#A8845A;">Still &amp; Golden Photography</p>
        </td>
      </tr>
      <tr>
        <td style="background-color:#F8F5F1;padding:0 48px 48px;">
          <table cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#1A1714;">
            <a href="https://stillandgolden.com.au" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;color:#F8F5F1;text-decoration:none;text-transform:uppercase;">View the portfolio</a>
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

  const resend = new Resend(RESEND_API_KEY);

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  const { first_name, last_name, email, phone, session_type, preferred_date, message } = data;

  if (!first_name || !email || !session_type) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  if (data['bot-field']) {
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  const sessionLabel = SESSION_LABELS[session_type] || session_type;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');

  try {
    // 1. Notify Deep + 2. Auto-response — run together, both must succeed
    await Promise.all([
      resend.emails.send({
        from: 'Still & Golden <notifications@stillandgolden.com.au>',
        to: 'hello@stillandgolden.com.au',
        subject: `New enquiry — ${fullName} (${sessionLabel})`,
        text: [
          `New booking enquiry from ${fullName}`,
          `Email: ${email}`,
          phone ? `Phone: ${phone}` : null,
          `Session: ${sessionLabel}`,
          preferred_date ? `Preferred date: ${preferred_date}` : null,
          message ? `\nMessage:\n${message}` : null,
        ].filter(Boolean).join('\n'),
      }),
      resend.emails.send({
        from: 'Still & Golden <notifications@stillandgolden.com.au>',
        to: email,
        subject: 'Thanks for reaching out — Still & Golden',
        html: autoResponseHtml(first_name),
      }),
    ]);

    // 3. Add to audience — use https module (no global fetch in Node 16)
    try {
      await new Promise((resolve) => {
        const body = JSON.stringify({
          email,
          first_name,
          last_name: last_name || '',
          unsubscribed: false,
        });
        const req = https.request({
          hostname: 'api.resend.com',
          path: `/audiences/${GENERAL_AUDIENCE_ID}/contacts`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => { console.log('Contact result:', res.statusCode, data); resolve(); });
        });
        req.on('error', (err) => { console.error('Contact creation threw:', err); resolve(); });
        req.write(body);
        req.end();
      });
    } catch (err) {
      console.error('Contact creation threw:', err);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('submit-enquiry error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process submission' }),
    };
  }
};
