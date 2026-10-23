// A bought gift voucher, delivered: the printable PDF (A5 landscape, brand
// colours), the email to the buyer that carries it, and Deep's [S&G] notice.

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { brandedEmail, esc } = require('./email-layout');
const { money } = require('./vouchers');

const OWNER_EMAIL = 'hello@stillandgolden.com.au';
const FROM = 'Still & Golden <notifications@stillandgolden.com.au>';

const COL = {
  gold: rgb(0.659, 0.518, 0.353),
  black: rgb(0.102, 0.090, 0.078),
  mid: rgb(0.541, 0.494, 0.471),
  cream: rgb(0.973, 0.961, 0.945),
  rule: rgb(0.831, 0.769, 0.690),
};

// The PDF's standard fonts only know Windows-1252. Accents are folded to
// their letters, curly quotes and dashes kept, and anything else (an emoji in
// a message) dropped rather than crashing the PDF.
const KEEP = new Set(['‘', '’', '“', '”', '–', '—', '…', '•']);
const printable = (ch) => ch.charCodeAt(0) < 256 || KEEP.has(ch);
// Letters that have no accent to strip, so NFKD leaves them as they are.
const FOLD = { 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'Ħ': 'H', 'ħ': 'h', 'ı': 'i', 'Œ': 'OE', 'œ': 'oe' };
function pdfSafe(s) {
  return [...String(s || '')]
    .map((ch) => (printable(ch) ? ch : FOLD[ch] || ch.normalize('NFKD').replace(/[̀-ͯ]/g, '')))
    .join('')
    .split('').filter(printable).join('')
    .replace(/[^\S\n]+/g, ' ').trim();
}

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// What the voucher is, in words: "A Golden session" / "$250".
function headline(v, meta, TIERS) {
  return meta.voucher_kind === 'package' ? `A ${TIERS[meta.tier].name} session` : money(Number(meta.cents));
}
function subline(v, meta, TIERS) {
  if (meta.voucher_kind === 'package') {
    const t = TIERS[meta.tier];
    if (t.sessions > 1) return `Two ${t.durationMinutes}-minute sessions, full gallery at both`;
    return t.includes || '';
  }
  return 'towards any photography session';
}

function wrap(text, font, size, width) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

async function voucherPdf(v, meta, TIERS) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Still & Golden gift voucher ${v.code}`);
  const W = 595.28; const H = 419.53;
  const page = doc.addPage([W, H]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifIt = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: COL.cream });
  page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: COL.gold, borderWidth: 0.8 });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: COL.gold });

  const left = 54;
  const spaced = (s) => s.split('').join(' ');
  page.drawText(spaced('STILL & GOLDEN'), { x: left, y: H - 62, size: 9, font: sans, color: COL.gold });
  page.drawText(spaced('GIFT VOUCHER'), { x: W - 54 - sans.widthOfTextAtSize(spaced('GIFT VOUCHER'), 9), y: H - 62, size: 9, font: sans, color: COL.mid });

  page.drawText(pdfSafe(`For ${meta.recipientName}`), { x: left, y: H - 118, size: 30, font: serifIt, color: COL.black });
  page.drawText(pdfSafe(headline(v, meta, TIERS)), { x: left, y: H - 154, size: 20, font: serif, color: COL.black });
  page.drawText(pdfSafe(subline(v, meta, TIERS)), { x: left, y: H - 174, size: 10, font: sans, color: COL.mid });

  let y = H - 210;
  const message = pdfSafe(meta.message);
  if (message) {
    for (const line of wrap(`“${message}”`, serifIt, 12, W - 2 * left).slice(0, 4)) {
      page.drawText(line, { x: left, y, size: 12, font: serifIt, color: COL.black });
      y -= 17;
    }
  }
  const from = pdfSafe(meta.buyerName);
  if (from) page.drawText(`From ${from}`, { x: left, y: y - 2, size: 11, font: sans, color: COL.mid });

  page.drawLine({ start: { x: left, y: 118 }, end: { x: W - left, y: 118 }, thickness: 0.6, color: COL.rule });
  page.drawText('VOUCHER CODE', { x: left, y: 96, size: 7.5, font: sans, color: COL.gold });
  page.drawText(v.code, { x: left, y: 74, size: 18, font: sansBold, color: COL.black });
  page.drawText(`Valid until ${longDate(v.expires)}`, { x: left, y: 56, size: 9, font: sans, color: COL.mid });

  const rx = 300;
  const how = [
    'To book, go to stillandgolden.com.au/book,',
    'choose a session and a date, and enter the',
    'code before you pay. Anything left on the',
    'voucher stays on it for next time.',
  ];
  how.forEach((line, i) => page.drawText(line, { x: rx, y: 96 - i * 13, size: 9, font: sans, color: COL.black }));
  page.drawText('In-home newborn & family photography · Cranbourne East', { x: rx, y: 40, size: 7, font: sans, color: COL.mid });

  return Buffer.from(await doc.save());
}

function buyerEmail(v, meta, TIERS) {
  const first = String(meta.buyerName || '').split(' ')[0] || 'there';
  const what = meta.voucher_kind === 'package' ? `${TIERS[meta.tier].name} session` : `${money(Number(meta.cents))} voucher`;
  const { html, text } = brandedEmail({
    eyebrow: 'Gift voucher',
    heading: `Your voucher for ${meta.recipientName}`,
    paragraphs: [
      `Thank you, ${esc(first)}. Your voucher for ${esc(meta.recipientName)} is attached, ready to print or forward.`,
    ],
    details: [
      ['For', meta.recipientName],
      ['Voucher', what],
      ['Code', v.code],
      ['Valid until', longDate(v.expires)],
    ],
    buttons: [{ label: 'Book with the voucher', url: `https://stillandgolden.com.au/book?voucher=${v.code}` }],
    after: [
      `To use it, ${esc(meta.recipientName)} books online at <a href="https://stillandgolden.com.au/book" style="color:#A8845A;">stillandgolden.com.au/book</a> and enters the code before paying.`,
      meta.voucher_kind === 'package'
        ? `It always covers a ${esc(TIERS[meta.tier].name)} session, even if my prices change. If they choose a smaller session, the difference stays on the code for another session or their full gallery.`
        : 'Whatever a booking doesn’t use stays on the code, for another session or their full gallery.',
    ],
    signoff: 'Thank you,',
  });
  return { subject: `Your Still & Golden gift voucher for ${meta.recipientName}`, html, text };
}

async function deliverVoucher(resend, v, meta, TIERS) {
  const pdf = await voucherPdf(v, meta, TIERS);
  const { subject, html, text } = buyerEmail(v, meta, TIERS);
  const { error } = await resend.emails.send({
    from: `Still & Golden <${OWNER_EMAIL}>`,
    to: meta.buyerEmail,
    subject,
    html,
    text,
    attachments: [{ filename: `Still & Golden gift voucher ${v.code}.pdf`, content: pdf.toString('base64') }],
  });
  if (error) throw new Error(`Resend rejected the voucher email: ${error.message || JSON.stringify(error)}`);
}

async function notifyOwnerOfVoucher(resend, v, meta, TIERS, { sessionId, buyerEmailFailed = false } = {}) {
  const what = meta.voucher_kind === 'package' ? `${TIERS[meta.tier].name} session` : money(Number(meta.cents));
  const { error } = await resend.emails.send({
    from: FROM,
    to: OWNER_EMAIL,
    ...(meta.buyerEmail ? { replyTo: meta.buyerEmail } : {}),
    subject: `[S&G] Gift voucher sold: ${what} for ${meta.recipientName} (${money(Number(meta.cents))})`,
    text: [
      `Gift voucher sold: ${what}`,
      `For: ${meta.recipientName}`,
      `From: ${meta.buyerName} <${meta.buyerEmail}>`,
      `Paid: ${money(Number(meta.cents))}`,
      `Code: ${v.code}`,
      `Valid until: ${v.expires}`,
      meta.message ? `\nTheir message:\n${meta.message}` : null,
      buyerEmailFailed ? '\nThe voucher email to the buyer FAILED. Send them the code by hand.' : '\nThe buyer has been emailed the voucher as a PDF.',
      `\nStripe checkout: ${sessionId || ''}`,
      'Every voucher and its balance: Stripe › Product catalogue › Coupons › "Gift voucher register".',
    ].filter((l) => l !== null).join('\n'),
  });
  if (error) throw new Error(`Resend rejected the voucher notice: ${error.message || JSON.stringify(error)}`);
}

// "[S&G] Voucher NOT issued": paid for, but the voucher couldn't be created in
// Stripe. Sent once (stripe-webhook flags the session), with the steps to put
// it right by hand. Re-sending the Stripe event reruns the whole voucher step
// safely: the code is derived from the payment, so it can't be issued twice.
async function alertVoucherNotIssued(resend, meta, TIERS, { sessionId, eventId, code, error }) {
  const what = meta.voucher_kind === 'package' ? `${TIERS[meta.tier] ? TIERS[meta.tier].name : meta.tier} session` : money(Number(meta.cents));
  const paid = money(Number(meta.cents));
  const buyer = meta.buyerName || 'The buyer';
  const first = String(meta.buyerName || '').split(' ')[0] || 'there';
  const { error: sendError } = await resend.emails.send({
    from: FROM,
    to: OWNER_EMAIL,
    subject: `[S&G] Voucher NOT issued: ${what} for ${meta.recipientName} (${paid}), paid, needs you`,
    text: [
      `${buyer} paid ${paid} for a gift voucher (${what} for ${meta.recipientName}), but the site couldn't create the voucher in Stripe. They haven't been sent anything yet.`,
      '',
      `What went wrong: ${error && error.message ? error.message : String(error)}`,
      '',
      'Stripe tries again by itself over the next three days. If one of those tries works, you get the usual "Gift voucher sold" email and the buyer gets their voucher, so check for that first.',
      '',
      'To fix it now:',
      '1. In Stripe, with Test mode OFF, go to Developers > Webhooks (newer dashboards: Workbench > Webhooks) and open the endpoint for stillandgolden.com.au.',
      `2. Find event ${eventId || '(see the endpoint\'s failed events)'} and press Resend.`,
      `3. Within a minute you should get "Gift voucher sold", and ${first} gets the email with the PDF. Resending can't make a second voucher: this payment's code is always ${code}.`,
      '',
      'If Resend fails again:',
      `4. Let ${first} know, for example: "Hi ${first}, thanks for buying a voucher for ${meta.recipientName}. There was a hiccup sending it, so it's coming from me personally shortly."`,
      `5. Forward this email to Claude to look at the error, or refund it: Stripe > Payments > the ${paid} payment from ${meta.buyerEmail} > Refund.`,
      '',
      `Buyer: ${meta.buyerName} <${meta.buyerEmail}>`,
      `For: ${meta.recipientName}`,
      `Voucher: ${what}, ${paid}`,
      meta.message ? `Their message: ${meta.message}` : null,
      `Stripe checkout: ${sessionId}`,
      `Stripe event: ${eventId || '(unknown)'}`,
    ].filter((l) => l !== null).join('\n'),
  });
  if (sendError) throw new Error(`Resend rejected the not-issued alert: ${sendError.message || JSON.stringify(sendError)}`);
}

module.exports = { voucherPdf, buyerEmail, deliverVoucher, notifyOwnerOfVoucher, alertVoucherNotIssued, pdfSafe };
