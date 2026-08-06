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
  // Live-payment test tier ($1 Setmore service). Hidden from the session
  // picker; reachable only via /book.html?service=test. Remove after go-live.
  test: {
    name: 'Test',
    tagline: 'Payment test',
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
      if (attempt < 2) await sleepMs(800 * (attempt + 1));
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

  // The exchange rejects the value (any 400/401 shape: "invalid_refresh_token",
  // "invalid_request", …) → the env var is not a refresh token; per the Setmore
  // docs fallback, treat it as an access token directly. If it isn't one
  // either, the next authed call 401s and surfaces as SETMORE_DOWN.
  if (res.status === 400 || res.status === 401 || body.error === 'invalid_refresh_token') {
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
  if (MOCK) return mockSlots(date);
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
  const customers = (data && data.customers) || (data && data.customer ? [data.customer] : []);
  return customers.find((c) => (c.email_id || '').toLowerCase() === email.toLowerCase()) || customers[0] || null;
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
async function getAppointmentsOnDate(date) {
  if (MOCK) return [];
  const [y, m, d] = date.split('-');
  const data = await setmoreFetch('/bookingapi/appointments', {
    query: { startDate: `${d}-${m}-${y}`, endDate: `${d}-${m}-${y}`, customerDetails: 'true' },
  });
  return (data && data.appointments) || [];
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
};
