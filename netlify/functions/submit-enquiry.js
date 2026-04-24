const { Resend } = require('resend');

const RESEND_API_KEY = 're_h529UAzs_GYpeRshcGLi3TwXuN7zXLsPS';
const GENERAL_AUDIENCE_ID = '09483754-cd3f-4537-9990-001237752466';
const ENQUIRY_TEMPLATE_ID = '4e3a1a87-9cce-46b5-9472-21f706f8a9d6';

const SESSION_LABELS = {
  newborn: 'Newborn (0–14 days)',
  family: 'Family session',
  combo: 'Newborn + family combo',
};

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

  // Honeypot — bot submissions have this field filled
  if (data['bot-field']) {
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  const sessionLabel = SESSION_LABELS[session_type] || session_type;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');

  try {
    await Promise.all([
      // 1. Notify Deep
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

      // 2. Auto-response to enquirer
      resend.emails.send({
        from: 'Still & Golden <notifications@stillandgolden.com.au>',
        to: email,
        subject: 'Thanks for reaching out — Still & Golden',
        template_id: ENQUIRY_TEMPLATE_ID,
        variables: {
          first_name,
          unsubscribe_url: 'https://stillandgolden.com.au',
        },
      }),

      // 3. Add to General audience
      resend.contacts.create({
        audienceId: GENERAL_AUDIENCE_ID,
        email,
        firstName: first_name,
        lastName: last_name || '',
        unsubscribed: false,
      }),
    ]);

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
