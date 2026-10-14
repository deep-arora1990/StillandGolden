// The signed-agreement PDF (A4, brand header, client box, sections, signature,
// footer on every page). Shared by the session agreements (submit-contract.js)
// and the model call agreement, so both look and break across pages the same.
// Moved out of submit-contract.js on 15 Oct 2026 without changing its output.

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const BRAND = {
  gold: [0.659, 0.518, 0.353],   // #A8845A
  black: [0.102, 0.090, 0.078],  // #1A1714
  mid: [0.541, 0.494, 0.471],    // #8A7E78
  cream: [0.973, 0.961, 0.945],  // #F8F5F1
};

async function renderAgreementPDF(data, { title, sections }) {
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
  const titleText = title;
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

  for (const sec of sections) y = drawSection(page1, sec.title, sec.paras, y);

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

module.exports = { renderAgreementPDF };
