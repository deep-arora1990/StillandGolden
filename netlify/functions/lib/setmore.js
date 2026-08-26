// Shared Setmore API client for the booking widget functions.
//
// Auth: SETMORE_API_KEY is a Setmore OAuth refresh token. It is exchanged for
// a ~7-day access token, cached in module scope (warm function invocations
// reuse it). If the exchange reports the value is not a refresh token at all,
// the env var is treated as an access token directly (the two credential
// shapes look identical from the outside).
//
// Rate limits: one automatic retry after a short wait on 429, and one re-auth
// retry on 401 (expired cached token).

const BASE = 'https://developer.setmore.com/api/v1';
const TIMEZONE = 'Australia/Melbourne';

// Dev-only mock mode (SETMORE_MOCK=1): the domain helpers return canned data
// so the booking widget UI can be exercised locally without live API access.
// Never set this variable in production.
const MOCK = process.env.SETMORE_MOCK === '1';

// Whitespace-tolerant: the value pasted into Netlify may contain spaces.
const REFRESH_TOKEN = (process.env.SETMORE_API_KEY || '').replace(/\s+/g, '');

// ---------------------------------------------------------------------------
// Configuration: the four session tiers → Setmore service keys.
// Keys discovered from the site's own "Book" CTAs (they appear in the public
// stillandgolden.setmore.com booking URLs — identifiers, not secrets).
// STAFF_KEY left null: the solo staff member is resolved from the API once
// per cold start and cached (see getStaffKey).
// ---------------------------------------------------------------------------
const TIERS = {
  glimpse: {
    name: 'Glimpse',
    tagline: 'The quick refresh',
    serviceKey: 'd6e1959f-dde0-4785-a0b1-8249d1305c7d',
    durationMinutes: 30,
    priceFrom: 195,
    priceCents: 19500,
    includes: '10 edited images',
  },
  golden: {
    name: 'Golden',
    tagline: 'The signature sitting',
    serviceKey: 'cbad199e-41dd-4572-803b-7f27ae3e2bb3',
    durationMinutes: 60,
    priceFrom: 250,
    priceCents: 25000,
    includes: '20 edited images',
  },
  gathered: {
    name: 'Gathered',
    tagline: 'Room to move',
    serviceKey: 'fe328a93-6db2-41d2-9a7d-4e7d4b4bf9e3',
    durationMinutes: 90,
    priceFrom: 395,
    priceCents: 39500,
    includes: '30+ edited images',
  },
  bloom: {
    name: 'Bloom',
    tagline: 'The bundle — bump to baby',
    serviceKey: 'd05d6d95-7e5c-4af6-8067-c25bcc55702b',
    durationMinutes: 90,
    priceFrom: 595,
    priceCents: 59500,
    includes: 'Two 90-minute sessions',
  },
  'fathers-day': {
    name: "Father's Day Mini",
    tagline: 'One day only — George Pentland Botanic Gardens',
    serviceKey: 'c3709660-7aa6-4a07-8ec2-d98548526a3e',
    durationMinutes: 30, // Setmore block is 30 min (20-min session + 10-min changeover buffer)
    priceFrom: 150,
    priceCents: 15000,
    includes: '5 edited photos',
    hidden: true,
    allowedDates: ['2026-08-30'],
    // Exactly ten spots, half-hourly from 10am (20-min session + 10-min buffer).
    slotTimes: ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30'],
  },
  'christmas-minis': {
    name: 'Christmas Mini',
    tagline: 'One day only — Baxter Community Hall',
    serviceKey: 'e1a1b152-9b9c-49c9-950d-caa62f3f1b82',
    // What gets written into the calendar: the 15-minute session plus its
    // 10-minute changeover. The service's own after-buffer is set to 0 in
    // Setmore because the API doesn't apply buffers when it creates an
    // appointment — it only writes the service time — so the gap has to be
    // part of the block we book.
    durationMinutes: 25,
    // What the customer is actually buying, for anything customer-facing.
    sessionMinutes: 15,
    priceFrom: 150,
    priceCents: 15000,
    includes: '5 edited photos',
    hidden: true,
    allowedDates: ['2026-11-08'],
    // Fifteen sessions, 25 minutes apart from 10:30 — the session length plus
    // its changeover, so they run back to back with no dead time.
    //
    // These are OUR times, not Setmore's. /bookingapi/slots derives start
    // times from the service duration (15 min), so it only ever offers a
    // 15-minute grid and none of the :55/:20/:45 starts below appear in it —
    // measured 26 Aug 2026, before and after the buffer change. Filtering
    // against it would throw away ten of these fifteen. fixedSchedule tells
    // booking-slots to check the calendar directly instead.
    fixedSchedule: true,
    slotTimes: [
      '10:30', '10:55', '11:20', '11:45', '12:10', '12:35', '13:00', '13:25',
      '13:50', '14:15', '14:40', '15:05', '15:30', '15:55', '16:20',
    ],
  },
  // Permanent $1 test tier for verifying the live booking+payment chain after
  // incidents — hidden from the /book picker, drives /test-booking.html.
  test: {
    name: 'Test',
    tagline: 'Flow verification',
    serviceKey: '50fcdf64-13b9-4587-a339-12a9609f8af7',
    durationMinutes: 10,
    priceFrom: 1,
    priceCents: 100,
    includes: 'Test booking',
    hidden: true,
  },
};

const SERVICE_KEY_TO_TIER = {};
for (const [tier, cfg] of Object.entries(TIERS)) {
  SERVICE_KEY_TO_TIER[cfg.serviceKey] = tier;
}

class SetmoreError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'SetmoreError';
    this.status = status;
    this.code = code;
  }
}

// --- token management ------------------------------------------------------

let cachedToken = null; // { value, expiresAt }
let envVarIsAccessToken = false; // set when the refresh exchange says so

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// Setmore's exchange endpoint flakes occasionally (empty data, 5xx) — retry up
// to twice with backoff before giving up. The deterministic "this isn't a
// refresh token" fallback returns normally and is never retried.
async function exchangeRefreshToken() {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await exchangeRefreshTokenOnce();
    } catch (err) {
      lastErr = err;
      // Back off harder for rate limiting — Setmore throttles per account.
      const wait = err.code === 'RATE_LIMITED' ? 3000 * (attempt + 1) : 800 * (attempt + 1);
      if (attempt < 2) await sleepMs(wait);
    }
  }
  throw lastErr;
}

async function exchangeRefreshTokenOnce() {
  const url = `${BASE}/o/oauth2/token?refreshToken=${encodeURIComponent(REFRESH_TOKEN)}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));

  if (res.ok && body.response && body.data && body.data.token) {
    const { access_token, expires_in } = body.data.token;
    return {
      value: access_token,
      // refresh 5 minutes early
      expiresAt: Date.now() + (Number(expires_in) || 3600) * 1000 - 5 * 60 * 1000,
    };
  }

  // Rate limited — retryable, and must NOT be mistaken for a bad token.
  if (res.status === 429 || body.error === 'too_many_requests') {
    throw new SetmoreError('Setmore rate limit hit during token exchange', {
      status: res.status,
      code: 'RATE_LIMITED',
    });
  }

  // Only an explicit invalid_refresh_token means the env var is not a refresh
  // token; per the Setmore docs fallback, treat it as an access token
  // directly. If it isn't one either, the next authed call 401s and surfaces
  // as SETMORE_DOWN.
  if (body.error === 'invalid_refresh_token' || body.error === 'invalid_request') {
    envVarIsAccessToken = true;
    return { value: REFRESH_TOKEN, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  }

  throw new SetmoreError(body.msg || `Token exchange failed (HTTP ${res.status})`, {
    status: res.status,
    code: body.error || 'TOKEN_EXCHANGE_FAILED',
  });
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  cachedToken = await exchangeRefreshToken();
  return cachedToken.value;
}

function invalidateToken() {
  cachedToken = null;
}

// --- authed request wrapper -------------------------------------------------

async function setmoreFetch(path, { method = 'GET', body, query } = {}, { retry = true } = {}) {
  const token = await getAccessToken();
  let url = BASE + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429 && retry) {
    await sleepMs(1500);
    return setmoreFetch(path, { method, body, query }, { retry: false });
  }

  // Setmore signals rate limits as HTTP 400 + error:"too_many_requests" too.
  if (res.status === 400 && retry) {
    const peek = await res.clone().json().catch(() => ({}));
    if (peek.error === 'too_many_requests') {
      await sleepMs(2500);
      return setmoreFetch(path, { method, body, query }, { retry: false });
    }
  }

  if (res.status === 401 && retry && !envVarIsAccessToken) {
    // cached token rejected — force re-exchange and try once more
    invalidateToken();
    return setmoreFetch(path, { method, body, query }, { retry: false });
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.response === false) {
    throw new SetmoreError(json.msg || `Setmore request failed (HTTP ${res.status})`, {
      status: res.status,
      code: json.error || '',
    });
  }
  return json.data;
}

// --- domain helpers ---------------------------------------------------------

let cachedStaffKey = null;

async function getStaffKey() {
  if (MOCK) return 'mock-staff-key';
  if (cachedStaffKey) return cachedStaffKey;
  const data = await setmoreFetch('/bookingapi/staffs');
  const staff = (data && data.staffs) || [];
  if (!staff.length) throw new SetmoreError('No staff members found in Setmore account');
  cachedStaffKey = staff[0].key;
  return cachedStaffKey;
}

// Setmore slot times arrive as "9:00 AM" / "4:45 PM" (12-hour) in current
// responses; older docs showed "HH.MM". Normalise everything to "HH:MM" 24h.
function normaliseSlots(slots) {
  if (!Array.isArray(slots)) return [];
  return slots
    .map((s) => (typeof s === 'string' ? s : s && s.time) || '')
    .map((s) => {
      const t = s.trim();
      const ampm = t.match(/^(\d{1,2})[:.](\d{2})\s*([AaPp])[.:]?[Mm]\.?$/);
      if (ampm) {
        let h = Number(ampm[1]) % 12;
        if (ampm[3].toLowerCase() === 'p') h += 12;
        return `${String(h).padStart(2, '0')}:${ampm[2]}`;
      }
      const plain = t.replace('.', ':');
      if (/^\d{1,2}:\d{2}$/.test(plain)) {
        return plain.length === 4 ? `0${plain}` : plain;
      }
      return '';
    })
    .filter(Boolean);
}

// date: 'YYYY-MM-DD' → Setmore wants 'DD/MM/YYYY'
function toSetmoreDate(date) {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

async function getSlots(serviceKey, date /* YYYY-MM-DD */) {
  if (MOCK) {
    // Fixed-date offers (e.g. Father's Day) mock to their advertised date even
    // when it falls on a mock-closed day — ten slots, matching the real cap.
    const tier = Object.values(TIERS).find((t) => t.serviceKey === serviceKey);
    if (tier && tier.allowedDates && tier.allowedDates.includes(date)) {
      return ['10:00', '10:20', '10:40', '11:00', '11:20', '11:40', '12:00', '12:20', '12:40', '13:00'];
    }
    return mockSlots(date);
  }
  const staffKey = await getStaffKey();
  const data = await setmoreFetch('/bookingapi/slots', {
    method: 'POST',
    body: {
      staff_key: staffKey,
      service_key: serviceKey,
      selected_date: toSetmoreDate(date),
      timezone: TIMEZONE,
    },
  });
  return normaliseSlots(data && data.slots);
}

// Canned availability for mock mode: open Tue–Sat 09:00–15:30 (30-min steps),
// closed Sun/Mon, with every 8th day "fully booked" so the calendar shows
// realistic variation.
function mockSlots(date) {
  const d = new Date(`${date}T00:00:00`);
  const dow = d.getDay();
  if (dow === 0 || dow === 1) return [];
  if (d.getDate() % 8 === 0) return [];
  const slots = [];
  for (let h = 9; h < 16; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`, `${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

async function findCustomer(firstName, email) {
  if (MOCK) return null;
  const data = await setmoreFetch('/bookingapi/customer', {
    query: { firstname: firstName, email },
  });
  // Setmore returns matches as data.customer — an ARRAY of customer objects
  // (per the API docs). Only accept an exact email match; falling back to the
  // first record would book against the wrong customer.
  let customers = [];
  if (Array.isArray(data && data.customer)) customers = data.customer;
  else if (data && data.customer) customers = [data.customer];
  else if (Array.isArray(data && data.customers)) customers = data.customers;
  const match = customers.find((c) => (c.email_id || '').toLowerCase() === email.toLowerCase());
  return (match && match.key) ? match : null;
}

async function createCustomer({ firstName, lastName, email, phone }) {
  if (MOCK) return { key: 'mock-customer-key', first_name: firstName, last_name: lastName, email_id: email };
  const data = await setmoreFetch('/bookingapi/customer/create', {
    method: 'POST',
    body: {
      first_name: firstName,
      last_name: lastName,
      email_id: email,
      cell_phone: phone || '',
      country_code: phone ? '+61' : '',
    },
  });
  const customer = data && data.customer;
  if (!customer || !customer.key) throw new SetmoreError('Customer created but no key returned');
  return customer;
}

async function createAppointment({ staffKey, serviceKey, customerKey, startTime, endTime, comment }) {
  if (MOCK) {
    return { key: `mock-appt-${Date.now()}`, staff_key: staffKey, service_key: serviceKey, customer_key: customerKey, start_time: startTime, end_time: endTime, comment: comment || '' };
  }
  // Setmore intermittently answers with response:true but empty data (nothing
  // is created in that case — verified). Retry that flake once. If the first
  // attempt did secretly book, the retry fails with slot_already_booked and
  // the webhook's duplicate guard finds our own booking — safe either way.
  if (!customerKey) throw new SetmoreError('Cannot create appointment without a customer key');
  const body = {
    staff_key: staffKey,
    service_key: serviceKey,
    customer_key: customerKey,
    start_time: startTime, // yyyy-MM-ddTHH:mm
    end_time: endTime,
    comment: comment || '',
  };
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleepMs(1000);
    const data = await setmoreFetch('/bookingapi/appointment/create', { method: 'POST', body });
    const appointment = data && data.appointment;
    if (appointment) return appointment;
    lastErr = new SetmoreError('Appointment created but no data returned');
  }
  throw lastErr;
}

// Appointments on a single day, with embedded customer records — used by the
// webhook's duplicate-delivery guard. date: 'YYYY-MM-DD'; the Setmore
// appointments endpoint wants dd-mm-yyyy.
/**
 * Availability for a tier whose session times are fixed by us rather than by
 * Setmore (see `fixedSchedule`).
 *
 * /bookingapi/slots lays start times on a grid derived from the service
 * duration — 15 minutes here — so it never offers the 25-minute cadence these
 * sessions actually run on, and filtering against it throws away two thirds of
 * the day. Bookings themselves are not constrained that way: the API writes an
 * appointment at whatever start time it's given.
 *
 * So availability is computed from what is actually in the calendar. Every
 * appointment on the date counts, not just this service's — a Golden session
 * booked over the top would otherwise be invisible here.
 */
async function getFixedScheduleSlots(tier, date) {
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  const appointments = await getAppointmentsOnDate(date);

  // start_time / end_time are 'yyyy-MM-ddTHH:mm' in the studio's own timezone.
  const busy = [];
  for (const appt of appointments) {
    const start = (appt.start_time || '').split('T')[1];
    const end = (appt.end_time || '').split('T')[1];
    if (!start) continue;
    const from = toMinutes(start);
    // An appointment with no end time still blocks its own start; assume the
    // tier's own length rather than treating it as zero-width.
    const to = end ? toMinutes(end) : from + tier.durationMinutes;
    busy.push([from, to]);
  }

  return tier.slotTimes.filter((time) => {
    const from = toMinutes(time);
    const to = from + tier.durationMinutes;
    // Half-open intervals: an appointment ending exactly when this one starts
    // is not a clash.
    return !busy.some(([bFrom, bTo]) => from < bTo && to > bFrom);
  });
}

async function getAppointmentsOnDate(date) {
  if (MOCK) return [];
  const [y, m, d] = date.split('-');
  const data = await setmoreFetch('/bookingapi/appointments', {
    query: { startDate: `${d}-${m}-${y}`, endDate: `${d}-${m}-${y}`, customerDetails: 'true' },
  });
  return (data && data.appointments) || [];
}

const toSetmoreRangeDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
};

// Appointments across a date range (both 'YYYY-MM-DD'), with embedded customer
// records and cursor pagination. Used by the scheduled Setmore→Resend sync.
async function getAppointmentsInRange(startDate, endDate) {
  if (MOCK) {
    return [{
      key: 'mock-appt-range',
      start_time: `${startDate}T10:00`,
      customer: { key: 'mock-customer-key', first_name: 'Mock', last_name: 'Customer', email_id: 'mock-customer@example.com' },
    }];
  }
  const appointments = [];
  let cursor;
  for (let page = 0; page < 25; page++) { // hard cap — never loop forever on a stuck cursor
    const query = {
      startDate: toSetmoreRangeDate(startDate),
      endDate: toSetmoreRangeDate(endDate),
      customerDetails: 'true',
    };
    if (cursor) query.cursor = cursor;
    const data = await setmoreFetch('/bookingapi/appointments', { query });
    appointments.push(...((data && data.appointments) || []));
    const next = data && data.pagination && data.pagination.cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return appointments;
}

module.exports = {
  TIERS,
  SERVICE_KEY_TO_TIER,
  TIMEZONE,
  MOCK,
  SetmoreError,
  getStaffKey,
  getSlots,
  findCustomer,
  createCustomer,
  createAppointment,
  getAppointmentsOnDate,
  getAppointmentsInRange,
  getFixedScheduleSlots,
};
