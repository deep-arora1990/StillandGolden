const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { Resend } = require('resend');

const BRAND = {
  gold: [0.659, 0.518, 0.353],   // #A8845A
  black: [0.102, 0.090, 0.078],  // #1A1714
  mid: [0.541, 0.494, 0.471],    // #8A7E78
  cream: [0.973, 0.961, 0.945],  // #F8F5F1
};

// Colour palette swatches (same as questionnaire.html)
const SWATCHES = [
  [0.627, 0.471, 0.188], // #A07830
  [0.769, 0.604, 0.424], // #C49A6C
  [0.831, 0.710, 0.604], // #D4B59A
  [0.910, 0.835, 0.722], // #E8D5B8
  [0.941, 0.910, 0.847], // #F0E8D8
  [0.831, 0.659, 0.659], // #D4A8A8
  [0.753, 0.565, 0.565], // #C09090
  [0.690, 0.533, 0.596], // #B08898
  [0.478, 0.620, 0.659], // #7A9EA8
  [0.373, 0.533, 0.533], // #5F8888
  [0.416, 0.596, 0.596], // #6A9898
  [0.659, 0.753, 0.753], // #A8C0C0
  [0.659, 0.753, 0.627], // #A8C0A0
  [0.541, 0.686, 0.533], // #8AAF88
  [0.471, 0.596, 0.408], // #789868
  [0.290, 0.416, 0.251], // #4A6A40
  [0.784, 0.471, 0.314], // #C87850
  [0.722, 0.408, 0.282], // #B86848
  [0.847, 0.596, 0.471], // #D89878
  [0.722, 0.722, 0.722], // #B8B8B8
  [0.627, 0.627, 0.659], // #A0A0A8
];

async function generatePDF(data) {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);
  const timesItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const W = 595.28;
  const H = 841.89;
  const margin = 56;
  const maxW = W - margin * 2;

  let page = doc.addPage([W, H]);
  let y = H - margin;

  // ── Header ──
  function drawHeader(p) {
    const top = H - margin;
    p.drawText('Still & Golden', {
      x: margin, y: top, size: 18, font: timesRoman, color: rgb(...BRAND.black),
    });
    p.drawText('Photography · Melbourne', {
      x: margin, y: top - 18, size: 7, font: helvetica, color: rgb(...BRAND.mid),
    });
    const rx = W - margin;
    p.drawText('Deep Arora', {
      x: rx - helveticaBold.widthOfTextAtSize('Deep Arora', 8),
      y: top, size: 8, font: helveticaBold, color: rgb(...BRAND.black),
    });
    p.drawText('ABN 37 280 912 036', {
      x: rx - helvetica.widthOfTextAtSize('ABN 37 280 912 036', 7),
      y: top - 12, size: 7, font: helvetica, color: rgb(...BRAND.mid),
    });
    p.drawText('stillandgolden.com.au', {
      x: rx - helvetica.widthOfTextAtSize('stillandgolden.com.au', 7),
      y: top - 24, size: 7, font: helvetica, color: rgb(...BRAND.mid),
    });
  }

  // ── Footer ──
  function drawFooter(p) {
    p.drawLine({
      start: { x: margin, y: margin + 16 }, end: { x: W - margin, y: margin + 16 },
      thickness: 0.5, color: rgb(0.91, 0.89, 0.86),
    });
    p.drawText('Still & Golden Photography · ABN 37 280 912 036 · stillandgolden.com.au', {
      x: margin, y: margin, size: 6.5, font: helvetica, color: rgb(...BRAND.mid),
    });
  }

  // ── New page helper ──
  function newPage() {
    drawFooter(page);
    page = doc.addPage([W, H]);
    drawHeader(page);
    return H - margin - 52;
  }

  // ── Check remaining space ──
  function ensureSpace(needed) {
    if (y - needed < margin + 30) {
      y = newPage();
    }
  }

  // ── Draw wrapped text, returns new y ──
  function drawWrapped(text, x, startY, size, font, color, lineMaxW) {
    if (!text) return startY;
    const words = text.split(/\s+/);
    let line = '';
    let sy = startY;
    const leading = size + 4;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) > lineMaxW) {
        if (sy < margin + 30) { sy = newPage(); }
        page.drawText(line, { x, y: sy, size, font, color });
        sy -= leading;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      if (sy < margin + 30) { sy = newPage(); }
      page.drawText(line, { x, y: sy, size, font, color });
      sy -= leading;
    }
    return sy;
  }

  // ── Draw a Q&A field ──
  function drawQA(label, value) {
    ensureSpace(50);
    // Label
    page.drawText(label.toUpperCase(), {
      x: margin, y, size: 6.5, font: helveticaBold, color: rgb(...BRAND.gold),
    });
    y -= 14;

    // Value
    const answer = value && value.trim() ? value.trim() : '—';
    y = drawWrapped(answer, margin, y, 9.5, timesRoman, rgb(...BRAND.black), maxW);
    y -= 8;
  }

  // ── Start drawing ──
  drawHeader(page);

  // Gold line
  y -= 42;
  page.drawLine({
    start: { x: margin, y }, end: { x: W - margin, y },
    thickness: 1.2, color: rgb(...BRAND.gold),
  });

  y -= 28;
  page.drawText('Session Questionnaire', {
    x: margin, y, size: 16, font: timesRoman, color: rgb(...BRAND.black),
  });
  y -= 16;
  page.drawText('Pre-session responses', {
    x: margin, y, size: 7, font: helvetica, color: rgb(...BRAND.mid),
  });

  // ── Client details box ──
  y -= 28;
  const boxH = 48;
  page.drawRectangle({
    x: margin, y: y - boxH, width: maxW, height: boxH,
    borderColor: rgb(0.85, 0.83, 0.8), borderWidth: 0.8,
    color: rgb(1, 1, 1),
  });
  page.drawText('CLIENT', {
    x: margin + 14, y: y - 16, size: 6.5, font: helveticaBold, color: rgb(...BRAND.gold),
  });
  page.drawText(data.names || '—', {
    x: margin + 14, y: y - 32, size: 12, font: timesRoman, color: rgb(...BRAND.black),
  });
  if (data.sessionDate) {
    page.drawText('SESSION DATE', {
      x: W / 2 + 20, y: y - 16, size: 6.5, font: helveticaBold, color: rgb(...BRAND.gold),
    });
    page.drawText(data.sessionDate, {
      x: W / 2 + 20, y: y - 32, size: 12, font: timesRoman, color: rgb(...BRAND.black),
    });
  }
  y -= boxH + 28;

  // ── Section: About Your Family ──
  ensureSpace(24);
  page.drawText('ABOUT YOUR FAMILY', {
    x: margin, y, size: 7, font: helveticaBold, color: rgb(...BRAND.gold),
  });
  y -= 8;
  page.drawLine({
    start: { x: margin, y }, end: { x: W - margin, y },
    thickness: 0.5, color: rgb(0.91, 0.89, 0.86),
  });
  y -= 18;

  drawQA("Children's names and ages", data.children);
  drawQA('Pets joining the session', data.pets);

  // ── Section: Your Session ──
  ensureSpace(24);
  page.drawText('YOUR SESSION', {
    x: margin, y, size: 7, font: helveticaBold, color: rgb(...BRAND.gold),
  });
  y -= 8;
  page.drawLine({
    start: { x: margin, y }, end: { x: W - margin, y },
    thickness: 0.5, color: rgb(0.91, 0.89, 0.86),
  });
  y -= 18;

  drawQA('What do you most want to capture?', data.capture);
  drawQA('Must-have shot or moment', data.mustHave);
  drawQA('Anything to avoid', data.avoid);

  // ── Section: This Moment in Time ──
  ensureSpace(24);
  page.drawText('THIS MOMENT IN TIME', {
    x: margin, y, size: 7, font: helveticaBold, color: rgb(...BRAND.gold),
  });
  y -= 8;
  page.drawLine({
    start: { x: margin, y }, end: { x: W - margin, y },
    thickness: 0.5, color: rgb(0.91, 0.89, 0.86),
  });
  y -= 18;

  drawQA("What's special about this stage?", data.whatsSpecial);
  drawQA('Special toy, blanket, or comforter', data.specialToy);
  drawQA('Something you do together', data.together);

  // ── Section: Practical Notes ──
  ensureSpace(24);
  page.drawText('PRACTICAL NOTES', {
    x: margin, y, size: 7, font: helveticaBold, color: rgb(...BRAND.gold),
  });
  y -= 8;
  page.drawLine({
    start: { x: margin, y }, end: { x: W - margin, y },
    thickness: 0.5, color: rgb(0.91, 0.89, 0.86),
  });
  y -= 18;

  drawQA('Best time of day', data.bestTime);
  drawQA('Anything else', data.anythingElse);

  // ── Colour Palette ──
  ensureSpace(140);

  y -= 8;
  page.drawText('OUTFIT & COLOUR GUIDE', {
    x: margin, y, size: 7, font: helveticaBold, color: rgb(...BRAND.gold),
  });
  y -= 8;
  page.drawLine({
    start: { x: margin, y }, end: { x: W - margin, y },
    thickness: 0.5, color: rgb(0.91, 0.89, 0.86),
  });
  y -= 18;

  y = drawWrapped(
    'For the most timeless images, we recommend choosing outfits from a soft, earthy palette — muted tones that complement natural light and keep the focus on your family rather than the clothing.',
    margin, y, 9, timesItalic, rgb(...BRAND.mid), maxW
  );
  y -= 10;

  page.drawText('RECOMMENDED TONES', {
    x: margin, y, size: 6.5, font: helvetica, color: rgb(...BRAND.mid),
  });
  y -= 16;

  // Draw swatches in rows
  const swatchSize = 20;
  const swatchGap = 6;
  const swatchesPerRow = Math.floor((maxW + swatchGap) / (swatchSize + swatchGap));
  for (let i = 0; i < SWATCHES.length; i++) {
    const col = i % swatchesPerRow;
    const row = Math.floor(i / swatchesPerRow);
    if (col === 0 && i > 0) {
      y -= swatchSize + swatchGap;
      ensureSpace(swatchSize + 10);
    }
    page.drawRectangle({
      x: margin + col * (swatchSize + swatchGap),
      y: y - swatchSize,
      width: swatchSize,
      height: swatchSize,
      color: rgb(...SWATCHES[i]),
      borderColor: rgb(0.85, 0.83, 0.8),
      borderWidth: 0.3,
    });
  }
  y -= swatchSize + swatchGap + 10;

  // Palette notes
  const notes = [
    { text: 'Coordinate tones, don\'t match exactly — variety within the palette looks natural', avoid: false },
    { text: 'Textures like linen, knit, and cotton photograph beautifully in natural light', avoid: false },
    { text: 'Layers work well — cardigans, wraps, and soft jackets add warmth and dimension', avoid: false },
    { text: 'Avoid: bright white, black, neon colours, or large bold patterns', avoid: true },
  ];
  for (const note of notes) {
    ensureSpace(30);
    const noteColor = note.avoid ? rgb(0.769, 0.659, 0.596) : rgb(...BRAND.gold);
    page.drawLine({
      start: { x: margin, y: y + 2 }, end: { x: margin, y: y - 14 },
      thickness: 2, color: noteColor,
    });
    const textColor = note.avoid ? rgb(...BRAND.mid) : rgb(...BRAND.black);
    y = drawWrapped(note.text, margin + 10, y, 8, helvetica, textColor, maxW - 10);
    y -= 6;
  }

  drawFooter(page);

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

  const { names, sessionDate } = data;

  if (!names) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  try {
    const pdfBytes = await generatePDF(data);
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    let detailsText = `New Session Questionnaire Submitted\n\n`;
    detailsText += `Name(s): ${names}\n`;
    if (sessionDate) detailsText += `Session Date: ${sessionDate}\n`;
    if (data.children) detailsText += `Children: ${data.children}\n`;
    if (data.pets) detailsText += `Pets: ${data.pets}\n`;
    if (data.capture) detailsText += `What to capture: ${data.capture}\n`;
    if (data.mustHave) detailsText += `Must-have shot: ${data.mustHave}\n`;
    if (data.avoid) detailsText += `Avoid: ${data.avoid}\n`;
    if (data.whatsSpecial) detailsText += `What's special: ${data.whatsSpecial}\n`;
    if (data.specialToy) detailsText += `Special toy/blanket: ${data.specialToy}\n`;
    if (data.together) detailsText += `Together activity: ${data.together}\n`;
    if (data.bestTime) detailsText += `Best time of day: ${data.bestTime}\n`;
    if (data.anythingElse) detailsText += `Anything else: ${data.anythingElse}\n`;

    const safeName = names.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const fileName = `questionnaire-${safeName}.pdf`;

    await resend.emails.send({
      from: 'Still & Golden <notifications@stillandgolden.com.au>',
      to: 'hello@stillandgolden.com.au',
      subject: `Session Questionnaire — ${names}`,
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
