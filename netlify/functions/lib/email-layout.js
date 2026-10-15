// The brand email frame (15 Oct 2026). Every email a client receives uses it:
// gold bar, the sprig, cream body, Deep's signature, dark footer — first built
// for the booking confirmation (booking-confirmation.js), which now takes its
// pieces from here too. Emails to Deep ([S&G] notices) stay plain on purpose.
//
// brandedEmail() returns { html, text }. `paragraphs` and `after` are HTML the
// caller has already escaped; `heading`, `eyebrow`, button labels and the
// `details` rows are plain text and escaped here.

const C = {
  outer: '#E8E3DC',
  cream: '#F8F5F1',
  black: '#1A1714',
  gold: '#A8845A',
  muted: '#8A7E78',
  rule: '#D4C4B0',
  footRule: '#2E2A27',
  fine: '#4A4440',
};
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = 'Arial,Helvetica,sans-serif';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LOGO_SVG = `<svg width="24" height="48" viewBox="0 0 100 200" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto;">
              <path d="M 50 195 C 49 162 45 118 48 78 C 51 42 54 20 52 5" stroke="${C.gold}" stroke-width="4" stroke-linecap="round" fill="none"/>
              <g transform="translate(49,168) rotate(-28) scale(0.66)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="${C.gold}"/></g>
              <g transform="translate(47,145) rotate(207) scale(0.70)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="${C.gold}"/></g>
              <g transform="translate(46,122) rotate(-24) scale(0.72)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="${C.gold}"/></g>
              <g transform="translate(48,96) rotate(204) scale(0.69)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="${C.gold}"/></g>
              <g transform="translate(50,70) rotate(-30) scale(0.64)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="${C.gold}"/></g>
              <g transform="translate(52,47) rotate(210) scale(0.59)"><path d="M 0 0 C 2 -1.5 10 -4.5 18 -4.5 C 30 -4.5 46 -2 55 0 C 46 2 30 4.5 18 4.5 C 10 4.5 2 1.5 0 0 Z" fill="${C.gold}"/></g>
            </svg>`;

const FOOTER_ROW = `        <tr>
          <td style="background-color:${C.black};padding:28px 48px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="font-family:${SERIF};font-size:12px;letter-spacing:0.14em;color:${C.gold};text-transform:uppercase;padding-bottom:6px;">Still &amp; Golden Photography</td></tr>
              <tr><td style="font-family:${SANS};font-size:11px;color:${C.muted};padding-bottom:3px;">Newborn &amp; Family &middot; South-east Melbourne</td></tr>
              <tr><td style="font-family:${SANS};font-size:11px;padding-bottom:3px;"><a href="https://stillandgolden.com.au" style="color:${C.gold};text-decoration:none;">stillandgolden.com.au</a></td></tr>
              <tr><td style="font-family:${SANS};font-size:11px;color:${C.muted};padding-bottom:20px;"><a href="https://instagram.com/stillandgoldenphotography" style="color:${C.muted};text-decoration:none;">@stillandgoldenphotography</a></td></tr>
              <tr>
                <td style="border-top:1px solid ${C.footRule};padding-top:16px;font-family:${SANS};font-size:10px;color:${C.fine};">
                  ABN 37 280 912 036
                </td>
              </tr>`;

const para = (html) => `<p style="margin:0 0 20px;font-family:${SANS};font-size:14px;line-height:1.8;color:${C.black};">${html}</p>`;

function button({ label, url }) {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;">
              <tr>
                <td style="background-color:${C.black};">
                  <a href="${esc(url)}" style="display:inline-block;padding:14px 32px;font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:0.12em;color:${C.cream};text-decoration:none;text-transform:uppercase;">${esc(label)}</a>
                </td>
              </tr>
            </table>`;
}

function detailsTable(rows) {
  const cells = rows.map(([label, value]) => `
                <tr>
                  <td style="padding:6px 0;font-family:${SANS};font-size:11px;letter-spacing:0.1em;color:${C.muted};text-transform:uppercase;vertical-align:top;width:38%;">${esc(label)}</td>
                  <td style="padding:6px 0 6px 12px;font-family:${SANS};font-size:14px;line-height:1.6;color:${C.black};vertical-align:top;">${esc(value).replace(/\n/g, '<br>')}</td>
                </tr>`).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.rule};margin:0 0 20px;">
              <tr><td style="padding:18px 22px;"><table width="100%" cellpadding="0" cellspacing="0" border="0">${cells}
              </table></td></tr>
            </table>`;
}

// HTML → readable plain text, for the text/plain part.
function toPlain(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&rsquo;/g, '\u2019').replace(/&lsquo;/g, '\u2018')
    .replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
}

function brandedEmail({ eyebrow = '', heading, paragraphs = [], buttons = [], details = [], after = [], signoff = 'See you soon,' }) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Still &amp; Golden Photography</title>
</head>
<body style="margin:0;padding:0;background-color:${C.outer};">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.outer};">
  <tr>
    <td align="center" style="padding:40px 20px;">

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

        <tr>
          <td height="4" style="background-color:${C.gold};font-size:0;line-height:0;">&nbsp;</td>
        </tr>

        <tr>
          <td align="center" style="padding:36px 48px 24px;background-color:${C.cream};">
            ${LOGO_SVG}
          </td>
        </tr>

        <tr>
          <td style="background-color:${C.cream};padding:8px 48px 8px;">
            ${eyebrow ? `<p style="margin:0 0 10px;font-family:${SANS};font-size:11px;letter-spacing:0.18em;color:${C.gold};text-transform:uppercase;">${esc(eyebrow)}</p>` : ''}
            <p style="margin:0 0 24px;font-family:${SERIF};font-size:26px;font-weight:normal;line-height:1.3;color:${C.black};">${esc(heading)}</p>
            ${paragraphs.map(para).join('\n            ')}
            ${details.length ? detailsTable(details) : ''}
            ${buttons.map(button).join('\n            ')}
            ${after.map(para).join('\n            ')}
          </td>
        </tr>

        <tr>
          <td style="background-color:${C.cream};padding:8px 48px 48px;">
            <p style="margin:0 0 4px;font-family:${SERIF};font-size:16px;color:${C.black};">${esc(signoff)}</p>
            <p style="margin:0 0 4px;font-family:${SERIF};font-size:16px;color:${C.black};">Deep</p>
            <p style="margin:0;font-family:${SERIF};font-size:14px;font-style:italic;color:${C.gold};">Still &amp; Golden Photography</p>
          </td>
        </tr>

${FOOTER_ROW}

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;

  const text = [
    heading,
    '',
    ...paragraphs.flatMap((h) => [toPlain(h), '']),
    ...details.map(([label, value]) => `${label}: ${toPlain(esc(value))}`),
    ...(details.length ? [''] : []),
    ...buttons.flatMap((b) => [`${b.label}: ${b.url}`, '']),
    ...after.flatMap((h) => [toPlain(h), '']),
    signoff,
    'Deep',
    'Still & Golden Photography',
  ].join('\n');

  return { html, text };
}

module.exports = { C, SERIF, SANS, LOGO_SVG, FOOTER_ROW, esc, brandedEmail };
