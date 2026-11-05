// The signed-agreement PDF (A4, brand header, client box, sections, signature,
// footer on every page). Shared by the session, model call and wedding
// agreements, so all look and break across pages the same.
// Moved out of submit-contract.js on 15 Oct 2026 without changing its output.

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const BRAND = {
  gold: [0.659, 0.518, 0.353],   // #A8845A
  black: [0.102, 0.090, 0.078],  // #1A1714
  mid: [0.541, 0.494, 0.471],    // #8A7E78
  cream: [0.973, 0.961, 0.945],  // #F8F5F1
};

// What CP1252 (WinAnsi) can draw, copied from submit-questionnaire.js: pdf-lib
// throws on the first character the standard fonts cannot encode, and a
// signer's name is typed by a person, so an emoji must not lose the agreement.
const WINANSI_SAFE = /[\n\t\x20-\x7E\xA0-\xFF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/;

function pdfSafe(value) {
  if (typeof value !== 'string') return value;
  // A letter WinAnsi lacks (ā, ễ) keeps its base letter: decompose, drop the
  // combining marks, and keep the result only if it is drawable. Emoji and
  // the like have no such base and are dropped.
  const cleaned = [...value].map((ch) => {
    if (WINANSI_SAFE.test(ch)) return ch;
    return [...ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')].filter((c) => WINANSI_SAFE.test(c)).join('');
  }).join('');
  return cleaned.replace(/[^\S\n]{2,}/g, ' ').trim();
}

// The largest size, up to `size`, at which `text` fits in `maxW`.
function fitSize(font, text, size, maxW) {
  let s = size;
  while (s > 4 && font.widthOfTextAtSize(text, s) > maxW) s -= 0.25;
  return s;
}

async function renderAgreementPDF(data, { title, sections }) {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);
  const timesItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const W = 595.28; // A4 width in points
  const H = 841.89; // A4 height in points
  const margin = 56;

  // Weddings pass two signers; without them everything below is the family layout.
  const signers = Array.isArray(data.signers) && data.signers.length
    ? data.signers.map((x) => ({ name: pdfSafe(x.name || ''), email: pdfSafe(x.email || '') }))
    : null;

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

  if (signers) {
    const nameMaxW = W / 2 - margin - 14;
    page1.drawText('COUPLE', {
      x: margin + 14, y: y - 16, size: 6.5, font: helveticaBold,
      color: rgb(...BRAND.gold),
    });
    [[signers[0], 32], [signers[1], 50]].forEach(([sg, dy]) => {
      if (!sg) return;
      page1.drawText(sg.name, {
        x: margin + 14, y: y - dy, size: fitSize(timesRoman, sg.name, 12, nameMaxW),
        font: timesRoman, color: rgb(...BRAND.black),
      });
    });
  } else {
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
  }

  if (data.sessionDate) {
    page1.drawText(data.dateLabel || 'SESSION DATE', {
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
  if (signers) {
    const colX = [margin, W / 2 + 20];
    const colW = [W / 2 + 20 - margin - 14, W - margin - (W / 2 + 20)];
    signers.slice(0, 2).forEach((sg, i) => {
      const agreed = 'Agreed: ' + data.agreementDate;
      cur.drawText(sg.name, {
        x: colX[i], y, size: fitSize(timesRoman, sg.name, 11, colW[i]),
        font: timesRoman, color: rgb(...BRAND.black),
      });
      cur.drawText(sg.email, {
        x: colX[i], y: y - 14, size: fitSize(helvetica, sg.email, 8, colW[i]),
        font: helvetica, color: rgb(...BRAND.mid),
      });
      cur.drawText(agreed, {
        x: colX[i], y: y - 28, size: fitSize(helvetica, agreed, 9, colW[i]),
        font: helvetica, color: rgb(...BRAND.mid),
      });
    });
  } else {
    cur.drawText(data.firstName + ' ' + data.lastName, {
      x: margin, y, size: 11, font: timesRoman, color: rgb(...BRAND.black),
    });
    y -= 14;
    cur.drawText('Date: ' + data.agreementDate, {
      x: margin, y, size: 9, font: helvetica, color: rgb(...BRAND.mid),
    });
  }

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
