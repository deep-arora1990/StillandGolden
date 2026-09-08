// Booking confirmation email — the one place its markup lives.
//
// Two consumers, one renderer, so they can never drift:
//   1. stripe-webhook.js calls render() with real values after a booking.
//   2. `node netlify/functions/lib/booking-confirmation.js --emit-template`
//      calls it with {{{placeholder}}} strings to regenerate
//      brand/email-templates/christmas-mini-confirmation.html for Studio.
//
// Studio's variable scanner reads {{{...}}} anywhere in a template, comments
// included, so the emitted file must not describe its own placeholder syntax
// literally — same trick as christmas-minis-eoi.html.

const CHRISTMAS_TIER_KEY = 'christmas-minis';
const MINI_FORM_URL = 'https://stillandgolden.com.au/questionnaire-mini';

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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// 'YYYY-MM-DD' -> 'Sunday, 8 November 2026'. Parsed field by field rather than
// through Date(string) so the label never shifts a day on a UTC server.
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const [, y, mo, d] = m.map(Number);
  const weekday = DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${weekday}, ${d} ${MONTHS[mo - 1]} ${y}`;
}

// '13:25' -> '1:25pm'
function formatTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  const h = Number(m[1]);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]}${suffix}`;
}

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

const p = (extra, body) => `<p style="margin:0 0 20px;font-family:${SANS};font-size:14px;line-height:1.8;color:${C.black};${extra}">${body}</p>`;

/**
 * Render the confirmation email.
 *
 * @param {object} v
 * @param {string} v.firstName      already-escaped-safe raw string
 * @param {string} v.sessionName    e.g. 'Christmas Mini'
 * @param {string} v.sessionLength  e.g. '15-minute session'
 * @param {string} v.includes       e.g. '5 edited photos'
 * @param {string} v.dateLabel      e.g. 'Sunday, 8 November 2026'
 * @param {string} v.timeLabel      e.g. '10:30am'
 * @param {boolean} v.christmas     add venue block + pre-session form CTA
 * @param {string} [v.formUrl]      pre-session form link (christmas only)
 * @returns {{subject: string, html: string, text: string}}
 */
function render(v) {
  const christmas = Boolean(v.christmas);
  const name = esc(v.firstName);
  const formUrl = v.formUrl || MINI_FORM_URL;

  const venueBlock = christmas ? `
        <tr>
          <td style="background-color:${C.cream};padding:20px 48px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-left:2px solid ${C.gold};padding:4px 0 4px 18px;">
                  <p style="margin:0 0 8px;font-family:${SANS};font-size:11px;letter-spacing:0.18em;color:${C.gold};text-transform:uppercase;">Where to come</p>
                  <p style="margin:0 0 2px;font-family:${SERIF};font-size:18px;line-height:1.4;color:${C.black};">Baxter Community Hall</p>
                  <p style="margin:0;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.muted};">211 Baxter-Tooradin Rd, Baxter VIC 3911</p>
                  <p style="margin:12px 0 0;font-family:${SANS};font-size:13px;line-height:1.8;color:${C.muted};">Come a few minutes early if you can &mdash; the day runs back to back, so your time is your time.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : '';

  const formBlock = christmas ? `
        <tr>
          <td style="background-color:${C.cream};padding:28px 48px 8px;">
            ${p('', "One small thing before the day: tell me who's coming and I'll have everything ready for you.")}
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background-color:${C.black};">
                  <a href="${esc(formUrl)}" style="display:inline-block;padding:14px 32px;font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:0.12em;color:${C.cream};text-decoration:none;text-transform:uppercase;">Tell me who's coming</a>
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0;font-family:${SANS};font-size:13px;line-height:1.8;color:${C.muted};">Takes about a minute. There's a note in there about Christmas outfits too &mdash; they're very welcome.</p>
          </td>
        </tr>` : '';

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
            <p style="margin:0 0 10px;font-family:${SANS};font-size:11px;letter-spacing:0.18em;color:${C.gold};text-transform:uppercase;">You're booked in</p>
            <p style="margin:0 0 28px;font-family:${SERIF};font-size:26px;font-weight:normal;line-height:1.3;color:${C.black};">That's your spot held, ${name}.</p>
            ${p('', 'Payment came through and your session is locked into my calendar. Everything you need is below — keep this email somewhere findable.')}
          </td>
        </tr>

        <tr>
          <td style="background-color:${C.cream};padding:8px 48px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.rule};">
              <tr>
                <td style="padding:24px 28px;">
                  <p style="margin:0 0 8px;font-family:${SERIF};font-size:22px;color:${C.black};">${esc(v.sessionName)}</p>
                  <p style="margin:0 0 14px;font-family:${SANS};font-size:13px;line-height:1.9;color:${C.black};">
                    ${esc(v.sessionLength)}<br>
                    ${esc(v.includes)}, delivered within 2 weeks
                  </p>
                  <p style="margin:0;font-family:${SERIF};font-size:18px;line-height:1.5;color:${C.black};">
                    ${esc(v.dateLabel)}<br>${esc(v.timeLabel)}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
${venueBlock}${formBlock}
        <tr>
          <td style="background-color:${C.cream};padding:28px 48px 8px;">
            ${p('', 'Need to change something, or just thought of a question? Reply straight to this email — it comes to me.')}
          </td>
        </tr>

        <tr>
          <td style="background-color:${C.cream};padding:0 48px 48px;">
            <p style="margin:0 0 4px;font-family:${SERIF};font-size:16px;color:${C.black};">See you soon,</p>
            <p style="margin:0 0 4px;font-family:${SERIF};font-size:16px;color:${C.black};">Deep</p>
            <p style="margin:0;font-family:${SERIF};font-size:14px;font-style:italic;color:${C.gold};">Still &amp; Golden Photography</p>
          </td>
        </tr>

        <tr>
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
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;

  const textLines = [
    `That's your spot held, ${v.firstName}.`,
    '',
    'Payment came through and your session is locked into my calendar.',
    '',
    `${v.sessionName} — ${v.sessionLength}`,
    `${v.includes}, delivered within 2 weeks`,
    `${v.dateLabel}, ${v.timeLabel}`,
  ];
  if (christmas) {
    textLines.push(
      '',
      'Where to come: Baxter Community Hall, 211 Baxter-Tooradin Rd, Baxter VIC 3911.',
      'Come a few minutes early if you can — the day runs back to back.',
      '',
      `Tell me who's coming (takes about a minute, and there's a note about Christmas outfits): ${formUrl}`,
    );
  }
  textLines.push(
    '',
    'Need to change something, or just thought of a question? Reply straight to this email.',
    '',
    'See you soon,',
    'Deep',
    'Still & Golden Photography',
  );

  return {
    subject: `You're booked in — ${v.sessionName}, ${v.dateLabel}`,
    html,
    text: textLines.join('\n'),
  };
}

// Build the value bag from Stripe session metadata + the matched tier.
function valuesFromBooking(meta, tier) {
  const minutes = tier.sessionMinutes || tier.durationMinutes;
  const dateLabel = formatDate(meta.date);
  const timeLabel = formatTime(meta.time);

  // Carry the booking into the form so nobody retypes what was just paid for.
  // The form treats these as conveniences and leaves every field editable —
  // they are a prefill, not a record of truth.
  const params = new URLSearchParams({
    name: `${meta.firstName || ''} ${meta.lastName || ''}`.trim(),
    email: meta.email || '',
    time: `${dateLabel}, ${timeLabel}`,
  });

  return {
    firstName: meta.firstName,
    sessionName: tier.name,
    sessionLength: `${minutes}-minute session`,
    includes: tier.includes,
    dateLabel,
    timeLabel,
    christmas: tier.serviceKey === CHRISTMAS_TIER_KEY_SERVICE,
    formUrl: `${MINI_FORM_URL}?${params.toString()}`,
  };
}

// Resolved from the tier map at require time so the key lives in one place.
const CHRISTMAS_TIER_KEY_SERVICE = (() => {
  try {
    const { TIERS } = require('./setmore');
    return TIERS[CHRISTMAS_TIER_KEY] && TIERS[CHRISTMAS_TIER_KEY].serviceKey;
  } catch (err) {
    return null;
  }
})();

module.exports = {
  render,
  valuesFromBooking,
  formatDate,
  formatTime,
  MINI_FORM_URL,
  CHRISTMAS_TIER_KEY,
};

// --emit-template: same renderer, placeholder values, for Studio.
if (require.main === module && process.argv.includes('--emit-template')) {
  const b = ['{', '{', '{'].join('');
  const e = ['}', '}', '}'].join('');
  const out = render({
    firstName: `${b}first_name${e}`,
    sessionName: 'Christmas Mini',
    sessionLength: '15-minute session',
    includes: '5 edited photos',
    dateLabel: 'Sunday, 8 November 2026',
    timeLabel: `${b}session_time${e}`,
    christmas: true,
  });
  // Studio's variable scanner reads the placeholder syntax anywhere in the
  // file, comments included, so this note names the fields without writing
  // them literally — same trick as christmas-minis-eoi.html.
  const note = [
    '<!--',
    '  GENERATED FILE — do not hand-edit.',
    '  Regenerate with:',
    '    node netlify/functions/lib/booking-confirmation.js --emit-template \\',
    '      > brand/email-templates/christmas-mini-confirmation.html',
    '',
    '  This is the same email stripe-webhook.js sends automatically on a new',
    '  booking. This copy exists for sending to bookings made BEFORE that was',
    '  wired up (8 Sep 2026), by hand from Studio.',
    '',
    '  VARIABLES (fill in from Studio when sending):',
    '    first_name    - their first name',
    '    session_time  - their slot, e.g. 1:25pm',
    '',
    '  The date is baked in: this campaign is one fixed day.',
    '-->',
    '',
  ].join('\n');
  const at = out.html.indexOf('<body');
  process.stdout.write(out.html.slice(0, at) + note + out.html.slice(at));
}
