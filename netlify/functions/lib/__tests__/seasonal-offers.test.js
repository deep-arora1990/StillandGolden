// The two seasonal offers (Oct–Dec 2026): In-home Christmas sessions on the
// normal calendar inside a date window, and Sunset beach minis — set weekdays,
// one a day, time agreed directly with Deep, with a choice of beach.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

const reply = (body, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })

async function fresh(mod) {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test'
  delete process.env.SETMORE_MOCK
  return await import(mod)
}
const wd = (d) => new Date(`${d}T00:00:00Z`).getUTCDay()

describe('offer dates', () => {
  it('beach minis: Mon/Wed/Fri/Sat/Sun only, Oct–Nov, never 8 November', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const dates = TIERS['sunset-beach-minis'].allowedDates
    expect(dates[0]).toBe('2026-10-02')                       // 1 Oct is a Thursday
    expect(dates.at(-1)).toBe('2026-11-30')
    expect(dates).not.toContain('2026-11-08')
    expect(dates.some((d) => [2, 4].includes(wd(d)))).toBe(false)
    // Daylight saving starts 4 Oct: no day skipped or repeated across it.
    expect(dates.filter((d) => d >= '2026-10-02' && d <= '2026-10-07'))
      .toEqual(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-07'])
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('in-home Christmas: every day from 1 October to the first weekend of December', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const dates = TIERS['in-home-christmas'].allowedDates
    expect(dates[0]).toBe('2026-10-01')
    expect(dates.at(-1)).toBe('2026-12-06')
    expect(dates).toHaveLength(67)
  })

  it('both are $295 against a genuine $400 comparison (Glimpse + its full gallery)', async () => {
    const { TIERS } = await fresh('../setmore.js')
    for (const k of ['sunset-beach-minis', 'in-home-christmas']) {
      expect(TIERS[k].priceCents).toBe(29500)
      expect(TIERS[k].valuedAt).toBe(400)
    }
  })
})

describe('one session per day', () => {
  beforeEach(() => installFreshBlobs())
  afterEach(() => { vi.unstubAllGlobals(); removeBlobs() })

  function stubAppointments(appts) {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      url = String(url)
      if (url.includes('/o/oauth2/token')) return reply({ response: true, data: { token: { access_token: 't', expires_in: 3600 } } })
      if (url.includes('/staffs')) return reply({ response: true, data: { staffs: [{ key: 's' }] } })
      if (url.includes('/appointments')) return reply({ response: true, data: { appointments: appts } })
      return reply({ response: true, data: {} })
    }))
  }

  it('offers the day when nothing is booked on it', async () => {
    stubAppointments([])
    const { TIERS, getFixedScheduleSlots } = await fresh('../setmore.js')
    expect(await getFixedScheduleSlots(TIERS['sunset-beach-minis'], '2026-10-10')).toEqual(['18:30'])
  })

  // Deep moves the placeholder to the agreed time — sunset drifts later through
  // spring. Once moved it no longer overlaps 18:30, and a plain overlap check
  // would reopen the day for a second booking.
  it('closes the day once a beach mini exists on it, even after it has been moved', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const key = TIERS['sunset-beach-minis'].serviceKey
    stubAppointments([{ service_key: key, start_time: '2026-10-10T19:40Z', end_time: '2026-10-10T20:25Z' }])
    const { getFixedScheduleSlots } = await fresh('../setmore.js')
    expect(await getFixedScheduleSlots(TIERS['sunset-beach-minis'], '2026-10-10')).toEqual([])
  })

  it('a daytime session of another kind does not close the evening', async () => {
    stubAppointments([{ service_key: 'golden-key', start_time: '2026-10-10T10:00Z', end_time: '2026-10-10T12:00Z' }])
    const { TIERS, getFixedScheduleSlots } = await fresh('../setmore.js')
    expect(await getFixedScheduleSlots(TIERS['sunset-beach-minis'], '2026-10-10')).toEqual(['18:30'])
  })
})

describe('the placeholder time never reaches a client', () => {
  it('confirmation email says "to be confirmed" and names the beach', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { valuesFromBooking } = await fresh('../booking-confirmation.js')
    const v = valuesFromBooking({ firstName: 'A', date: '2026-10-10', time: '18:30', notes: 'Location: Carrum\nhello' }, TIERS['sunset-beach-minis'])
    expect(v.timeLabel).toMatch(/to be confirmed/i)
    expect(v.timeLabel).not.toMatch(/6:30|18:30/)
    expect(v.sessionName).toBe('Sunset beach mini — Carrum beach')
  })

  it('in-home Christmas keeps its real time', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { valuesFromBooking } = await fresh('../booking-confirmation.js')
    const v = valuesFromBooking({ firstName: 'A', date: '2026-11-14', time: '10:00' }, TIERS['in-home-christmas'])
    expect(v.timeLabel).not.toMatch(/to be confirmed/i)
  })
})

describe('booking-services exposes offers without listing them', () => {
  it('includes the offers flagged unlisted, and still excludes hidden campaign tiers', async () => {
    const { handler } = await fresh('../../booking-services.js')
    const { services } = JSON.parse((await handler({ httpMethod: 'GET' })).body)
    const beach = services.find((s) => s.tier === 'sunset-beach-minis')
    expect(beach).toMatchObject({ unlisted: true, timeTbc: true, valuedAt: 400, locations: ['Frankston', 'Seaford', 'Carrum'] })
    expect(services.find((s) => s.tier === 'in-home-christmas').unlisted).toBe(true)
    expect(services.find((s) => s.tier === 'christmas-minis')).toBeUndefined()
    expect(services.find((s) => s.tier === 'golden').unlisted).toBe(false)
  })
})

describe('checkout validates the beach', () => {
  const base = { service_key: '40b4d796-6949-4812-adfd-8ea896db36b2', date: '2026-10-10', time: '18:30',
                 firstName: 'A', lastName: 'B', email: 'a@example.com' }
  const ev = (body) => ({ httpMethod: 'POST', headers: { origin: 'https://stillandgolden.com.au' }, body: JSON.stringify(body) })

  it('refuses a beach minis booking with no beach, or one that is not offered', async () => {
    const { handler } = await fresh('../../booking-checkout.js')
    for (const location of [undefined, '', 'Bondi']) {
      const res = await handler(ev({ ...base, location }))
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body).error.message).toMatch(/location/i)
    }
  })

  it('refuses a date outside the offer', async () => {
    const { handler } = await fresh('../../booking-checkout.js')
    const res = await handler(ev({ ...base, date: '2026-11-08', location: 'Carrum' }))   // minis day
    expect(res.statusCode).toBe(400)
  })
})

// In-home Christmas has no schedule of its own: which days are open is whatever
// Setmore says for the in-home Christmas service. The date window only ever
// removes days (30 Sep 2026 — a local preview in mock mode showed every day
// open, which read as the window opening the calendar).
describe('in-home Christmas availability comes from Setmore', () => {
  beforeEach(() => { installFreshBlobs(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-30T08:00:00Z')) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); removeBlobs(); delete process.env.SETMORE_MOCK })

  it('offers exactly the days Setmore has slots for, inside the window', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const key = TIERS['in-home-christmas'].serviceKey
    const asked = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      url = String(url)
      if (url.includes('/o/oauth2/token')) return reply({ response: true, data: { token: { access_token: 't', expires_in: 3600 } } })
      if (url.includes('/staffs')) return reply({ response: true, data: { staffs: [{ key: 's' }] } })
      if (url.includes('/slots')) {
        const body = JSON.parse(init.body)
        asked.push(body)
        const open = ['02/12/2026', '05/12/2026'].includes(body.selected_date)
        return reply({ response: true, data: { slots: open ? ['10:00 AM'] : [] } })
      }
      return reply({ response: true, data: {} })
    }))
    const { handler } = await fresh('../../booking-availability.js')
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { service_key: key, year: '2026', month: '12' } })
    expect(JSON.parse(res.body).availableDates).toEqual(['2026-12-02', '2026-12-05'])
    expect(asked.every((b) => b.service_key === key)).toBe(true)
    expect(asked.map((b) => b.selected_date).at(-1)).toBe('06/12/2026')   // nothing after the window
  })

  it('the local preview mock follows the regular calendar too', async () => {
    vi.resetModules()
    process.env.SETMORE_MOCK = '1'
    const { TIERS, getSlots } = await import('../setmore.js')
    expect(await getSlots(TIERS['in-home-christmas'].serviceKey, '2026-10-04')).toEqual([])   // a Sunday: mock-closed
    expect((await getSlots(TIERS['in-home-christmas'].serviceKey, '2026-10-06')).length).toBeGreaterThan(0)
    expect((await getSlots(TIERS['fathers-day'].serviceKey, '2026-08-30')).length).toBe(10)  // one-day event unchanged
  })
})

// Beach minis keep their own schedule (Deep, 30 Sep 2026): his Setmore hours
// are weekends only from October, and the evenings must stay on sale anyway —
// the booking is written through the API, which doesn't check working hours.
describe('beach minis ignore Setmore working hours', () => {
  beforeEach(() => { installFreshBlobs(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-30T08:00:00Z')) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); removeBlobs() })

  it('offers every advertised evening even when Setmore has no slots at all', async () => {
    const slotCalls = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      url = String(url)
      if (url.includes('/o/oauth2/token')) return reply({ response: true, data: { token: { access_token: 't', expires_in: 3600 } } })
      if (url.includes('/staffs')) return reply({ response: true, data: { staffs: [{ key: 's' }] } })
      if (url.includes('/slots')) { slotCalls.push(init.body); return reply({ response: true, data: { slots: [] } }) }
      if (url.includes('/appointments')) return reply({ response: true, data: { appointments: [] } })
      return reply({ response: true, data: {} })
    }))
    const { TIERS } = await fresh('../setmore.js')
    const tier = TIERS['sunset-beach-minis']
    const { handler } = await fresh('../../booking-availability.js')
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { service_key: tier.serviceKey, year: '2026', month: '10' } })
    expect(JSON.parse(res.body).availableDates).toEqual(tier.allowedDates.filter((d) => d.startsWith('2026-10')))
    expect(slotCalls).toHaveLength(0)
  })
})

// Both offers take the half-now, half-in-a-week option (Deep, 30 Sep 2026).
// The split path writes its own customer-facing text, so the placeholder
// sunset time has to be kept out of it separately.
describe('split payment on the offers', () => {
  it('both offers split $295 into two halves of $147.50', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { balancePlan } = await fresh('../deposits.js')
    for (const k of ['in-home-christmas', 'sunset-beach-minis']) {
      expect(TIERS[k].depositCents * 2).toBe(TIERS[k].priceCents)
      const plan = balancePlan(TIERS[k], '2026-11-20', '2026-10-01')
      expect(plan).toMatchObject({ eligible: true, depositCents: 14750, balanceCents: 14750 })
    }
  })

  it('the Stripe page for a split beach mini shows no time', async () => {
    const { TIERS } = await fresh('../setmore.js')
    const { balancePlan, splitCheckoutParams } = await fresh('../deposits.js')
    const tier = TIERS['sunset-beach-minis']
    const params = splitCheckoutParams(tier, balancePlan(tier, '2026-11-20', '2026-10-01'),
      { date: '2026-11-20', time: '18:30', firstName: 'Mary', lastName: 'Jane', email: 'm@example.com' })
    const shown = params.line_items[0].price_data.product_data.description
    expect(shown).not.toMatch(/18:30/)
    expect(shown).toMatch(/time to be confirmed/i)
    expect(params.subscription_data.metadata.time).toBe('18:30')   // the webhook still needs it to book
  })

  it('the balance reminder email shows no time for a beach mini, and keeps it otherwise', async () => {
    const { _test } = await fresh('../../stripe-webhook.js')
    const { TIERS } = await fresh('../setmore.js')
    const beach = _test.balanceReminderText({ service_key: TIERS['sunset-beach-minis'].serviceKey, date: '2026-11-20', time: '18:30', firstName: 'Mary' }, '$147.50', 'Friday 13 November')
    expect(beach).not.toMatch(/18:30/)
    const golden = _test.balanceReminderText({ service_key: TIERS.golden.serviceKey, date: '2026-11-20', time: '10:00', firstName: 'Mary' }, '$237.50', 'Friday 13 November')
    expect(golden).toMatch(/at 10:00/)
  })
})
