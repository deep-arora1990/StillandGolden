const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { Resend } = require('resend');

const BRAND = {
  gold: [0.659, 0.518, 0.353],   // #A8845A
  black: [0.102, 0.090, 0.078],  // #1A1714
  mid: [0.541, 0.494, 0.471],    // #8A7E78
  cream: [0.973, 0.961, 0.945],  // #F8F5F1
};

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
  const isMini = data.sessionType === 'Mini session';
  const titleText = isMini ? 'Mini Session Agreement' : 'Photography Session Agreement';
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

  // ── Sections ──
  function drawSection(page, title, paragraphs, startY) {
    let sy = startY;

    // Section heading
    page.drawText(title.toUpperCase(), {
      x: margin, y: sy, size: 6.5, font: helveticaBold,
      color: rgb(...BRAND.gold),
    });
    sy -= 8;
    page.drawLine({
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
          page.drawText(line, { x: margin, y: sy, size, font, color: rgb(...BRAND.black) });
          sy -= leading;
          line = word;
        } else {
          line = test;
        }
      }
      if (line) {
        page.drawText(line, { x: margin, y: sy, size, font, color: rgb(...BRAND.black) });
        sy -= leading + 6;
      }
    }

    return sy;
  }

  // What's Included
  const includedParas = isMini
    ? [
        'The session includes 10 professionally edited photographs delivered via a private online gallery within 2 weeks of the session date. The gallery allows the client to download all images as high-resolution JPEG files for personal use.',
        'Access to the extended gallery is an additional $70. Please advise the photographer within 7 days of receiving your gallery if you would like to purchase the full set.'
      ]
    : [
        'The session includes 30 professionally edited photographs delivered via a private online gallery within 2 weeks of the session date. The gallery allows the client to download all images as high-resolution JPEG files for personal use.'
      ];

  y = drawSection(page1, "What's Included", includedParas, y);

  // Payment Terms
  y = drawSection(page1, 'Payment Terms', [
    'A non-refundable deposit of 50% of the session fee is required at the time of booking to secure the session date. The remaining balance is due in full no later than 2 days prior to the session.',
    'Failure to pay the remaining balance by the due date may result in the session being cancelled and the deposit forfeited.',
  ], y);

  // Cancellation
  y = drawSection(page1, 'Cancellation & Rescheduling', [
    'The deposit is non-refundable in the event of a change of mind, or if the client cancels within 7 days of the scheduled session date.',
    'Rescheduling is available at no additional charge and is subject to mutual agreement between the client and photographer. The photographer reserves the right to reschedule in the event of illness, extreme weather, or other unforeseen circumstances, with an alternative date offered at no extra cost.',
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

  // ── Signature section ──
  y -= 10;
  page1.drawLine({
    start: { x: margin, y }, end: { x: W - margin, y },
    thickness: 0.5, color: rgb(0.91, 0.89, 0.86),
  });
  y -= 20;

  page1.drawText('ACCEPTED BY', {
    x: margin, y, size: 6.5, font: helveticaBold,
    color: rgb(...BRAND.gold),
  });
  y -= 18;
  page1.drawText(data.firstName + ' ' + data.lastName, {
    x: margin, y, size: 11, font: timesRoman, color: rgb(...BRAND.black),
  });
  y -= 14;
  page1.drawText('Date: ' + data.agreementDate, {
    x: margin, y, size: 9, font: helvetica, color: rgb(...BRAND.mid),
  });

  // Footer
  page1.drawLine({
    start: { x: margin, y: margin + 16 }, end: { x: W - margin, y: margin + 16 },
    thickness: 0.5, color: rgb(0.91, 0.89, 0.86),
  });
  page1.drawText('Still & Golden Photography · ABN 37 280 912 036 · stillandgolden.com.au', {
    x: margin, y: margin, size: 6.5, font: helvetica, color: rgb(...BRAND.mid),
  });

  return await doc.save();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const resend = new Resend('re_h529UAzs_GYpeRshcGLi3TwXuN7zXLsPS');

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    firstName, lastName, email,
    agreementDate, sessionType,
    sessionDate
  } = data;

  if (!firstName || !lastName || !email || !agreementDate) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  try {
    const pdfBytes = await generatePDF(data);
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    const contractLabel = sessionType === 'Mini session' ? 'Mini Session' : 'Standard Session';

    let detailsText = `New ${contractLabel} Agreement Signed\n\n`;
    detailsText += `Name: ${firstName} ${lastName}\n`;
    detailsText += `Email: ${email}\n`;
    if (sessionDate) detailsText += `Session Date: ${sessionDate}\n`;
    detailsText += `Agreement Date: ${agreementDate}\n`;
    detailsText += `Session Type: ${sessionType}\n`;

    const fileName = `${contractLabel.replace(/\s+/g, '-').toLowerCase()}-agreement-${lastName.toLowerCase()}-${firstName.toLowerCase()}.pdf`;

    await resend.emails.send({
      from: 'Still & Golden <notifications@stillandgolden.com.au>',
      to: 'hello@stillandgolden.com.au',
      subject: `${contractLabel} Agreement — ${firstName} ${lastName}`,
      text: detailsText,
      attachments: [
        {
          filename: fileName,
          content: pdfBase64,
        },
      ],
    });

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
