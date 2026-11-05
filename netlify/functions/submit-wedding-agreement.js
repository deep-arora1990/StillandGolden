// POST /.netlify/functions/submit-wedding-agreement
//
// The wedding agreement (wedding-agreement.html), signed from the link in the
// wedding booking email.
//
// One form for both partners: a wedding is booked by two people and either of
// them can be held to the terms, so both type their name and both tick (Partner 1's
// email is required, Partner 2's is optional). Each gets the signed PDF; Deep gets it too. Many couples share an
// inbox, so the couple's email goes to the unique list of addresses given.
//
// The package and the wedding date come ONLY from the verified booking link
// (link.s, link.d). The form can't change them, so a link can't be edited into
// a different package or day. (brandedEmail escapes the heading, so names
// reach the HTML only through its esc.) A family booking link is refused here.
//
// There is deliberately no questionnaire link in the thank-you email. By
// design the wedding questionnaire goes out with the planning call, 4 to 6
// weeks before the day, and only from Studio (booking-link-send), never
// automatically on signing.

const { Resend } = require('resend');
const { verify: verifyBookingLink } = require('./lib/booking-links');
const { TIERS } = require('./lib/setmore');
const { weddingAgreementSections } = require('./lib/wedding-agreement');
const { renderAgreementPDF } = require('./lib/agreement-pdf');
const { postBookingEvent } = require('./lib/studio-sync');
const { brandedEmail } = require('./lib/email-layout');
const { formatDate } = require('./lib/booking-confirmation');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const first = (name) => name.split(/\s+/)[0];
const surnameSlug = (name) => (name.split(/\s+/).pop() || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function generatePDF({ tierKey, weddingDate, agreementDate, partners }) {
  return renderAgreementPDF({
    signers: partners.map((p) => ({ name: p.name, email: p.email })),
    sessionDate: formatDate(weddingDate),
    dateLabel: 'WEDDING DATE',
    agreementDate,
  }, weddingAgreementSections(tierKey));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const link = verifyBookingLink(data.token);
  if (!link) return json(400, { error: "This link has expired or isn't quite right. Reply to your booking email and I'll send you a fresh one." });
  const tier = TIERS[link.s];
  if (!tier || !tier.wedding) return json(400, { error: "This link is for a family session, not a wedding. Reply to your booking email and I'll sort it out." });

  const raw = Array.isArray(data.partners) ? data.partners : [];
  const partners = [0, 1].map((i) => ({
    name: String((raw[i] && raw[i].name) || '').trim().slice(0, 100),
    email: String((raw[i] && raw[i].email) || '').trim().slice(0, 200),
    agreed: !!raw[i] && raw[i].agreed === true,
  }));
  const [p1, p2] = partners;
  if (!p1.name || !p2.name || !EMAIL.test(p1.email)) return json(400, { error: "Please add both your names, and at least Partner 1's email." });
  if (p2.email && !EMAIL.test(p2.email)) return json(400, { error: "Partner 2's email doesn't look quite right. Leave it blank if you share an inbox." });
  if (p1.name.toLowerCase() === p2.name.toLowerCase()) return json(400, { error: 'Partner 1 and Partner 2 need to be two different people.' });
  if (!(p1.agreed && p2.agreed)) return json(400, { error: 'You both need to tick the box to agree.' });
  const agreementDate = String(data.agreementDate || '');
  if (!ISO.test(agreementDate)) return json(400, { error: "Please fill in today's date." });

  if (!process.env.RESEND_API_KEY) {
    if (process.env.NETLIFY_DEV === 'true') {
      console.log('submit-wedding-agreement [dev, nothing sent]:', JSON.stringify({ tier: link.s, weddingDate: link.d, partners: partners.map((p) => ({ name: p.name, email: p.email })), agreementDate }));
      return json(200, { success: true, dev: true });
    }
    console.error('RESEND_API_KEY is not set in the environment.');
    return json(500, { error: 'Email service is not configured.' });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const pdf = await generatePDF({ tierKey: link.s, weddingDate: link.d, agreementDate, partners });
    const attachment = {
      filename: `wedding-agreement-${surnameSlug(p1.name)}-${surnameSlug(p2.name)}.pdf`,
      content: Buffer.from(pdf).toString('base64'),
    };

    await resend.emails.send({
      from: 'Still & Golden <notifications@stillandgolden.com.au>',
      to: 'hello@stillandgolden.com.au',
      replyTo: p1.email,
      subject: `[S&G] Wedding agreement signed: ${p1.name} & ${p2.name} · ${tier.name}`,
      text: [
        `Wedding agreement signed by both partners: ${tier.name} (${tier.lengthLabel})`,
        `Wedding date: ${link.d}`,
        `Partner 1: ${p1.name} <${p1.email}>, agreed`,
        `Partner 2: ${p2.name}${p2.email ? ` <${p2.email}>` : ''}, agreed`,
        `Agreement date: ${agreementDate}`,
        `Signed from the booking link (Setmore appointment ${link.a || '?'})`,
      ].join('\n'),
      attachments: [attachment],
    });

    await resend.emails.send({
      from: 'Still & Golden <hello@stillandgolden.com.au>',
      to: [...new Set([p1.email, p2.email].filter(Boolean))],
      subject: 'Your signed wedding agreement',
      ...brandedEmail({
        eyebrow: 'Agreement signed',
        heading: `Thanks, ${first(p1.name)} and ${first(p2.name)}.`,
        paragraphs: [
          "Your signed copy of the wedding agreement is attached, so you've both got it.",
          "Nothing else to do for now. 4 to 6 weeks before the wedding we'll jump on a planning call, and I'll send you a short questionnaire then.",
        ],
        after: ['Got a question in the meantime? Just reply to this email, it comes straight to me.'],
      }),
      attachments: [attachment],
    });

    // Studio's Bookings screen: terms signed, with both signers. Never throws.
    await postBookingEvent({
      type: 'terms_signed',
      appointmentId: link.a || undefined,
      email: link.e || p1.email,
      sessionDate: link.d,
      agreement: 'wedding',
      signers: [{ name: p1.name, email: p1.email }, { name: p2.name, email: p2.email }],
    });

    return json(200, { success: true });
  } catch (err) {
    console.error('submit-wedding-agreement error:', err);
    return json(500, { error: 'Failed to process submission' });
  }
};

exports._test = { generatePDF };
