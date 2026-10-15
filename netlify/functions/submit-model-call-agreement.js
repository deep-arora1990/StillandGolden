// POST /.netlify/functions/submit-model-call-agreement
//
// The Model Call Session Agreement (model-call-agreement.html, 15 Oct 2026):
// signed by families given a free session in exchange for image use. Generic
// on purpose (Deep, 15 Oct 2026), so it can be reused for future model calls.
// Deep sends the link by hand — there is no booking link, so nothing here is prefilled or verified against a booking. Wording:
// brand/model-call/model-call-forms.md §3. The page shows the same text; keep
// the two in step.
//
// Sends Deep the signed PDF, and the family their copy with the model call
// questionnaire link (the half-price families are ordinary bookings and never
// see this).

const { Resend } = require('resend');
const { renderAgreementPDF } = require('./lib/agreement-pdf');
const { brandedEmail } = require('./lib/email-layout');
const { postBookingEvent } = require('./lib/studio-sync');

const QUESTIONNAIRE_URL = 'https://stillandgolden.com.au/model-call-questionnaire';

const SECTIONS = [
  { title: "What's Included", paras: [
    'A 45-minute session. Every edited image from the session (the full gallery) is delivered in a private online gallery within 2 weeks of the session, as high-resolution JPEG files for personal use. The gallery stays online for 2 months.',
  ] },
  { title: "What I'm Asking in Return", paras: [
    'These sessions are offered in exchange for permission to use the images. By booking, you agree that Still & Golden Photography may use images from your session for its portfolio, website, social media and advertising, including paid ads. No fee is payable to you for this use.',
    'Children: you confirm you are the parent or legal guardian of the children attending and give this permission on their behalf. If other adults attend (partners, grandparents), you confirm they also agree.',
    "What I won't do: publish your surname, address or children's names without asking you first; publish images where a child is undressed or in swimwear only; sell or license your images to anyone else.",
  ] },
  { title: 'Timing and Weather', paras: [
    "I'll confirm the exact start time after booking. If the weather makes the session unsafe or unworkable, I'll offer a new date at no cost.",
  ] },
  { title: 'Cancellation', paras: [
    "If you can't make it, let me know as soon as you can and we'll find another time. Rescheduling is free and subject to mutual agreement.",
  ] },
  { title: 'Safety', paras: [
    "If the session takes place somewhere public, you're responsible for supervising your children at all times.",
  ] },
  { title: 'Image Rights', paras: [
    'Still & Golden Photography retains copyright of all images. Your images are licensed for personal, non-commercial use: you can print, share and display them. Commercial use needs written consent.',
  ] },
  { title: 'General', paras: [
    "This agreement is governed by the laws of Victoria, Australia. By booking or ticking the agreement checkbox, you confirm you've read, understood and agree to it.",
  ] },
];

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ISO = /^\d{4}-\d{2}-\d{2}$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const firstName = String(data.firstName || '').trim().slice(0, 100);
  const lastName = String(data.lastName || '').trim().slice(0, 100);
  const email = String(data.email || '').trim().slice(0, 200);
  const sessionDate = String(data.sessionDate || '');
  const agreementDate = String(data.agreementDate || '');
  if (!firstName || !lastName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !ISO.test(sessionDate) || !ISO.test(agreementDate)) {
    return json(400, { error: 'Please fill in every field.' });
  }
  // The tick is the parent/guardian consent for the children's images — the
  // whole basis of the session. Never accept a signature without it.
  if (data.accepted !== true) return json(400, { error: 'Please tick the box to confirm you agree.' });

  if (!process.env.RESEND_API_KEY) {
    if (process.env.NETLIFY_DEV === 'true') {
      console.log('submit-model-call-agreement [dev, nothing sent]:', JSON.stringify({ firstName, lastName, email, sessionDate, agreementDate }));
      return json(200, { success: true, dev: true });
    }
    console.error('RESEND_API_KEY is not set in the environment.');
    return json(500, { error: 'Email service is not configured.' });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const pdf = await renderAgreementPDF({ firstName, lastName, email, sessionDate, agreementDate }, { title: 'Model Call Session Agreement', sections: SECTIONS });
    const attachment = {
      filename: `model-call-agreement-${lastName.toLowerCase()}-${firstName.toLowerCase()}.pdf`.replace(/[^a-z0-9.-]+/g, '-'),
      content: Buffer.from(pdf).toString('base64'),
    };

    await resend.emails.send({
      from: 'Still & Golden <notifications@stillandgolden.com.au>',
      to: 'hello@stillandgolden.com.au',
      subject: `[S&G] Model call agreement signed — ${firstName} ${lastName}`,
      text: [
        'Model Call Session Agreement signed (free session).',
        '',
        `Name: ${firstName} ${lastName}`,
        `Email: ${email}`,
        `Session date: ${sessionDate}`,
        `Agreement date: ${agreementDate}`,
        'Parent/guardian consent for the children: confirmed (ticked).',
      ].join('\n'),
      attachments: [attachment],
    });

    await resend.emails.send({
      from: 'Still & Golden <hello@stillandgolden.com.au>',
      to: email,
      subject: 'Thanks for signing — one quick questionnaire',
      ...brandedEmail({
        eyebrow: 'Agreement signed',
        heading: `Thanks, ${firstName}.`,
        paragraphs: [
          'Your copy of the agreement is attached.',
          "Last thing: a short questionnaire about who's coming and what the kids are into, so we can spend the session playing, not working things out.",
        ],
        buttons: [{ label: 'Fill in the questionnaire', url: `${QUESTIONNAIRE_URL}?${new URLSearchParams({ name: `${firstName} ${lastName}`, email, date: sessionDate })}` }],
        after: ['If you have any questions in the meantime, just reply to this email.'],
      }),
      attachments: [attachment],
    });

    // Studio's Bookings screen: terms signed, matched on email + session date
    // (Studio's "Send model call forms" prefills both). Never throws.
    await postBookingEvent({ type: 'terms_signed', email, sessionDate });

    return json(200, { success: true });
  } catch (err) {
    console.error('submit-model-call-agreement error:', err);
    return json(500, { error: 'Failed to process submission' });
  }
};

exports._test = { SECTIONS };
