const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { Resend } = require('resend');
const { verify: verifyBookingLink, linkFor } = require('./lib/booking-links');
const { postBookingEvent } = require('./lib/studio-sync');

const BRAND = {
  gold: [0.659, 0.518, 0.353],   // #A8845A
  black: [0.102, 0.090, 0.078],  // #1A1714
  mid: [0.541, 0.494, 0.471],    // #8A7E78
  cream: [0.973, 0.961, 0.945],  // #F8F5F1
};

// Session tiers. `upgrade` is the cost of unlocking the full gallery, or null
// where the full gallery already comes with the session.
const TIERS = {
  glimpse: {
    name: 'Glimpse',
    label: 'Glimpse Session Agreement',
    duration: 'up to 45 minutes',
    images: '10',
    upgrade: 150,
  },
  golden: {
    name: 'Golden',
    label: 'Golden Session Agreement',
    duration: 'up to 90 minutes',
    images: '20',
    upgrade: 125,
  },
  gathered: {
    name: 'Gathered',
    label: 'Gathered Session Agreement',
    duration: '90 minutes',
    images: '30 or more',
    upgrade: null,
  },
  bloom: {
    name: 'Bloom',
    label: 'Bloom Session Agreement',
    duration: '90 minutes per session',
    images: '30 or more per session',
    upgrade: null,
    note: 'Bloom covers two separate 90-minute sessions — a maternity or family session, and a newborn session — each delivered as its own gallery. The newborn session takes place once the baby has arrived, usually within the first few weeks.',
  },
  // Seasonal offers (30 Sep 2026), booked on /book like the packages and so
  // signed against the same agreement. Keys match the booking tiers, so the
  // signed link's tier key resolves directly.
  'in-home-christmas': {
    name: 'In-home Christmas',
    label: 'In-home Christmas Session Agreement',
    duration: '45 minutes',
    images: 'the full gallery of',
    upgrade: null,
  },
  'sunset-beach-minis': {
    name: 'Sunset beach mini',
    label: 'Sunset Beach Mini Agreement',
    duration: '45 minutes',
    images: 'the full gallery of',
    upgrade: null,
    note: 'The session takes place at the beach chosen at booking (Frankston, Seaford or Carrum), timed around sunset. The exact start time is confirmed by the photographer before the session.',
  },
};

// Session names used before the tier restructure, so agreements signed from an
// older form or link still produce the right deliverables.
const LEGACY_SESSION_TIERS = [
  [/\bmini\b/, 'glimpse'],
  [/\bcombo\b/, 'bloom'],
  [/\bnewborn\b/, 'gathered'],
  [/\bcake\s*smash\b/, 'golden'],
  [/\bmaternity\b/, 'golden'],
  [/\bfamily\b/, 'golden'],
];

// Session types are submitted as free text from the contract form, so match on
// the tier name, then on the pre-restructure session names, and fall back to
// Golden as the most commonly booked session.
function resolveTier(sessionType) {
  const value = String(sessionType || '').toLowerCase();
  const tierMatch = Object.keys(TIERS).find((key) => value.includes(key));
  if (tierMatch) return TIERS[tierMatch];

  const legacy = LEGACY_SESSION_TIERS.find(([pattern]) => pattern.test(value));
  return legacy ? TIERS[legacy[1]] : TIERS.golden;
}

async function generatePDF(data) {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);
  const timesItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const W = 595.28; // A4 width in points
  const H = 841.89; // A4 height in points
  const margin = 56;

  // ── Page 1 ──
  const page1 = doc.addPage([W, H]);
  let y = H - margin;

  // Header
  page1.drawText('Still & Golden', {
    x: margin, y, size: 18, font: timesRoman,
    color: rgb(...BRAND.black),
  });
  page1.drawText('Photography · Melbourne', {
    x: margin, y: y - 18, size: 7, font: helvetica,
    color: rgb(...BRAND.mid),
  });

  // Right side header
  const rightX = W - margin;
  page1.drawText('Deep Arora', {
    x: rightX - helveticaBold.widthOfTextAtSize('Deep Arora', 8),
    y, size: 8, font: helveticaBold, color: rgb(...BRAND.black),
  });
  page1.drawText('ABN 37 280 912 036', {
    x: rightX - helvetica.widthOfTextAtSize('ABN 37 280 912 036', 7),
    y: y - 12, size: 7, font: helvetica, color: rgb(...BRAND.mid),
  });
  page1.drawText('stillandgolden.com.au', {
    x: rightX - helvetica.widthOfTextAtSize('stillandgolden.com.au', 7),
    y: y - 24, size: 7, font: helvetica, color: rgb(...BRAND.mid),
  });

  y -= 42;
  // Gold line
  page1.drawLine({
    start: { x: margin, y }, end: { x: W - margin, y },
    thickness: 1.2, color: rgb(...BRAND.gold),
  });

  y -= 28;
  // Title
  const tier = resolveTier(data.sessionType);
  // `label` already ends in "Agreement" — appending it again titled every PDF
  // "… Session Agreement Agreement".
  const titleText = tier.label;
  page1.drawText(titleText, {
    x: margin, y, size: 16, font: timesRoman, color: rgb(...BRAND.black),
  });

  y -= 16;
  page1.drawText('Signed agreement', {
    x: margin, y, size: 7, font: helvetica, color: rgb(...BRAND.mid),
  });

  // ── Client details box ──
  y -= 28;
  const boxH = 68;
  page1.drawRectangle({
    x: margin, y: y - boxH, width: W - margin * 2, height: boxH,
    borderColor: rgb(0.85, 0.83, 0.8), borderWidth: 0.8,
    color: rgb(1, 1, 1),
  });

  page1.drawText('CLIENT', {
    x: margin + 14, y: y - 16, size: 6.5, font: helveticaBold,
    color: rgb(...BRAND.gold),
  });
  page1.drawText(data.firstName + ' ' + data.lastName, {
    x: margin + 14, y: y - 32, size: 12, font: timesRoman,
    color: rgb(...BRAND.black),
  });
  page1.drawText(data.email, {
    x: margin + 14, y: y - 48, size: 8, font: helvetica,
    color: rgb(...BRAND.mid),
  });

  if (data.sessionDate) {
    page1.drawText('SESSION DATE', {
      x: W / 2 + 20, y: y - 16, size: 6.5, font: helveticaBold,
      color: rgb(...BRAND.gold),
    });
    page1.drawText(data.sessionDate, {
      x: W / 2 + 20, y: y - 32, size: 12, font: timesRoman,
      color: rgb(...BRAND.black),
    });
  }

  y -= boxH + 24;

  // Continue onto a new page rather than drawing past the footer. The terms
  // grew on 8 Oct 2026 (payment in two parts, client image choice) and no
  // longer fit on one A4 page.
  let cur = page1;
  const BOTTOM = margin + 40;
  function room(sy, need) {
    if (sy - need >= BOTTOM) return sy;
    cur = doc.addPage([W, H]);
    return H - margin;
  }

  // ── Sections ──
  function drawSection(_page, title, paragraphs, startY) {
    let sy = room(startY, 44);

    // Section heading
    cur.drawText(title.toUpperCase(), {
      x: margin, y: sy, size: 6.5, font: helveticaBold,
      color: rgb(...BRAND.gold),
    });
    sy -= 8;
    cur.drawLine({
      start: { x: margin, y: sy }, end: { x: W - margin, y: sy },
      thickness: 0.5, color: rgb(0.91, 0.89, 0.86),
    });
    sy -= 14;

    // Paragraphs
    for (const para of paragraphs) {
      const words = para.split(' ');
      let line = '';
      const maxW = W - margin * 2;
      const size = 9.5;
      const font = timesRoman;
      const leading = 14;

      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(test, size) > maxW) {
          sy = room(sy, leading);
          cur.drawText(line, { x: margin, y: sy, size, font, color: rgb(...BRAND.black) });
          sy -= leading;
          line = word;
        } else {
          line = test;
        }
      }
      if (line) {
        sy = room(sy, leading);
        cur.drawText(line, { x: margin, y: sy, size, font, color: rgb(...BRAND.black) });
        sy -= leading + 6;
      }
    }

    return sy;
  }

  // What's Included
  const includedParas = [
    `The ${tier.name} session runs for ${tier.duration} and includes ${tier.images} professionally edited photographs delivered via a private online gallery within 2 weeks of the session date. The gallery stays online for 2 months, and images download as high-resolution JPEG files for personal use.`,
  ];

  if (tier.upgrade) {
    includedParas.push(
      `Choosing your images: the online gallery shows every edited image from the session. The client chooses the ${tier.images} images included in the session and downloads those at no extra cost. The full gallery can be added through the online gallery for $${tier.upgrade} at any time within the 2 months it is online.`
    );
  } else {
    includedParas.push(
      'The full gallery is included in this session at no additional cost, so every image can be downloaded.'
    );
  }

  if (tier.note) includedParas.push(tier.note);

  y = drawSection(page1, "What's Included", includedParas, y);

  // Payment Terms
  // Matches /session-contract and /contract word for word (8 Oct 2026).
  y = drawSection(page1, 'Payment Terms', [
    'Payment is required at the time of booking to secure the session date. All payments are non-refundable in the event of a change of mind or cancellation within 7 days of the scheduled session date.',
    'Paying in two parts. Where it is offered at the time of booking, the client may pay half the session fee to secure the date and the remaining half seven days later, charged automatically to the same card. A reminder is sent three days beforehand, and nothing is charged after the second payment. Part payment is only available when the session is more than nine days away.',
    'If the second payment does not go through, the session is still booked. A link to pay with another card is emailed, and the balance remains due before the session.',
    'The full fee must be paid before the session takes place. If the second payment has not cleared by then, the session cannot go ahead until it has.',
    'If the client cancels having paid only the first half, the same terms apply as to any other payment: more than 7 days before the session it is refunded, and within 7 days it is not. Either way the second payment is simply not taken.',
    'If the photographer cancels or cannot deliver the session, everything paid is refunded in full, and any payment still to come is cancelled.',
  ], y);

  // Cancellation
  y = drawSection(page1, 'Cancellation & Rescheduling', [
    'All payments are non-refundable in the event of a change of mind or cancellation within 7 days of the scheduled session date.',
    'Rescheduling is available at no additional charge and is subject to mutual agreement between the client and photographer. The photographer reserves the right to reschedule in the event of illness, extreme weather, or other unforeseen circumstances, with an alternative date offered at no extra cost. Rescheduling does not change when a second payment is taken.',
    'Newborn sessions: rescheduling is available at no charge if baby has not yet arrived by the scheduled date, or if baby, the client, or a member of the immediate household is unwell. Please notify the photographer as soon as possible so an alternative date can be arranged that suits the family and the baby.',
  ], y);

  // Image Usage
  y = drawSection(page1, 'Image Usage & Rights', [
    'Client use: Images are licensed for personal, non-commercial use only. The client may print, share, and display images for personal purposes. Commercial use of any image is strictly prohibited without prior written consent from Still & Golden Photography.',
    'Photographer use: Still & Golden Photography retains full copyright of all images. The photographer reserves the right to use images for portfolio, website, social media, and other promotional purposes. If you would prefer your images not be used publicly, please notify the photographer in writing prior to your session.',
  ], y);

  // General
  y = drawSection(page1, 'General', [
    'This agreement constitutes the entire agreement between the parties with respect to the session and is governed by the laws of Victoria, Australia.',
  ], y);

  // ── Signature section ── kept together on one page
  y = room(y - 10, 70);
  cur.drawLine({
    start: { x: margin, y }, end: { x: W - margin, y },
    thickness: 0.5, color: rgb(0.91, 0.89, 0.86),
  });
  y -= 20;

  cur.drawText('ACCEPTED BY', {
    x: margin, y, size: 6.5, font: helveticaBold,
    color: rgb(...BRAND.gold),
  });
  y -= 18;
  cur.drawText(data.firstName + ' ' + data.lastName, {
    x: margin, y, size: 11, font: timesRoman, color: rgb(...BRAND.black),
  });
  y -= 14;
  cur.drawText('Date: ' + data.agreementDate, {
    x: margin, y, size: 9, font: helvetica, color: rgb(...BRAND.mid),
  });

  // Footer on every page
  for (const pg of doc.getPages()) {
    pg.drawLine({
      start: { x: margin, y: margin + 16 }, end: { x: W - margin, y: margin + 16 },
      thickness: 0.5, color: rgb(0.91, 0.89, 0.86),
    });
    pg.drawText('Still & Golden Photography · ABN 37 280 912 036 · stillandgolden.com.au', {
      x: margin, y: margin, size: 6.5, font: helvetica, color: rgb(...BRAND.mid),
    });
  }

  return await doc.save();
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }


  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // A signed link from the booking confirmation (8 Oct 2026) is the authority
  // on WHICH session this is: its package and date override whatever the form
  // sent, so a link can't be edited into a different booking. Name and email
  // stay the client's to correct. A link that fails verification is refused
  // outright rather than quietly treated as a hand-signed agreement.
  let link = null;
  if (data.token) {
    link = verifyBookingLink(data.token);
    if (!link) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This link has expired or is not valid. Please reply to your booking email and I will send a fresh one.' }) };
    }
    data.sessionType = link.s || data.sessionType;
    data.sessionDate = link.d || data.sessionDate;
  }

  const {
    firstName, lastName, email,
    agreementDate, sessionType,
    sessionDate
  } = data;

  if (!firstName || !lastName || !email || !agreementDate) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  if (!process.env.RESEND_API_KEY) {
    // Local preview (netlify dev, no keys): the link was verified and the form
    // validated above; log instead of sending. Never true on the live site.
    if (process.env.NETLIFY_DEV === 'true') {
      console.log('submit-contract [dev, nothing sent]:', JSON.stringify({ firstName, lastName, email, sessionType, sessionDate, viaLink: Boolean(link),
        questionnaire: linkFor('/questionnaire', link ? data.token : null) }));
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, dev: true }) };
    }
    console.error('RESEND_API_KEY is not set in the environment.');
    return { statusCode: 500, body: 'Email service is not configured.' };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const pdfBytes = await generatePDF(data);
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    const tier = resolveTier(sessionType);
    const contractLabel = `${tier.name} Session`;

    let detailsText = `New ${contractLabel} Agreement Signed\n\n`;
    detailsText += `Name: ${firstName} ${lastName}\n`;
    detailsText += `Email: ${email}\n`;
    if (sessionDate) detailsText += `Session date: ${sessionDate}\n`;
    if (link && link.h) detailsText += `Session time: ${link.h}\n`;
    if (link && link.loc) detailsText += `Beach: ${link.loc}\n`;
    detailsText += `Agreement date: ${agreementDate}\n`;
    detailsText += `Session type: ${sessionType}\n`;
    detailsText += link
      ? `Signed from the booking email link${link.a ? ` (Setmore appointment ${link.a})` : ''}\n`
      : 'Signed by hand on /contract (no booking link)\n';

    // The questionnaire follows the terms automatically (Deep, 8 Oct 2026),
    // carrying the same signed link so it opens prefilled.
    const questionnaireUrl = linkFor('/questionnaire', link ? data.token : null);

    const fileName = `${contractLabel.replace(/\s+/g, '-').toLowerCase()}-agreement-${lastName.toLowerCase()}-${firstName.toLowerCase()}.pdf`;

    const attachment = { filename: fileName, content: pdfBase64 };

    await resend.emails.send({
      from: 'Still & Golden <notifications@stillandgolden.com.au>',
      to: 'hello@stillandgolden.com.au',
      subject: `[S&G] Terms signed — ${firstName} ${lastName} · ${tier.name}`,
      text: detailsText,
      attachments: [attachment],
    });

    await resend.emails.send({
      from: 'Still & Golden <hello@stillandgolden.com.au>',
      to: email,
      subject: 'Thanks for signing — one quick questionnaire',
      html: `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1A1714;">
        <p style="font-size:1.1rem;margin-bottom:8px;">Hi ${escapeHtml(firstName)},</p>
        <p>Thanks for signing &mdash; your copy of the session terms is attached.</p>
        <p>Last thing: a short questionnaire about your family, your place and anything you&rsquo;d love (or would rather avoid) in your photos. It helps me turn up already knowing what matters.</p>
        <p style="margin:28px 0;"><a href="${questionnaireUrl}" style="display:inline-block;padding:14px 32px;background:#1A1714;color:#F8F5F1;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-decoration:none;text-transform:uppercase;">Fill in your session questionnaire</a></p>
        <p>If you have any questions in the meantime, just reply to this email.</p>
        <p style="margin-top:32px;">Deep<br><span style="color:#A8845A;font-style:italic;">Still &amp; Golden Photography</span></p>
      </div>`,
      attachments: [attachment],
    });

    // Studio's Bookings screen: terms signed. Matched on the link's
    // appointment, else the email + session date. Never throws.
    await postBookingEvent({ type: 'terms_signed', appointmentId: (link && link.a) || undefined, email, sessionDate: sessionDate || undefined });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process submission' }),
    };
  }
};

exports._test = { TIERS, resolveTier };
