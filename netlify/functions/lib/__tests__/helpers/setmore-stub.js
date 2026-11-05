// A stand-in for Setmore (and Resend) behind `fetch`, for tests that drive the
// booking functions end to end. Appointments are filtered by the dd-mm-yyyy
// startDate/endDate query exactly as Setmore does, on start_time's own date
// part: Setmore's start_time is studio-local with a fake 'Z', so the date is
// read off the string, never through `new Date`.
import { vi } from 'vitest'

const reply = (body, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })

const isoFromDmy = (s) => String(s || '').split('-').reverse().join('-')

export function stubSetmore({ appointments = [], slots = ['10:00 AM'], failAppointments = false } = {}) {
  const calls = []
  const created = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    url = String(url)
    calls.push({ url, method: init.method || 'GET', body: init.body })
    if (url.includes('/o/oauth2/token')) return reply({ response: true, data: { token: { access_token: 'tok', expires_in: 3600 } } })
    if (url.includes('/bookingapi/staffs')) return reply({ response: true, data: { staffs: [{ key: 'staff1' }] } })
    if (url.includes('/bookingapi/slots')) return reply({ response: true, data: { slots } })
    if (url.includes('/bookingapi/appointments?')) {
      if (failAppointments) return reply({ response: false, msg: 'Setmore is down' }, 500)
      const q = new URL(url).searchParams
      const from = isoFromDmy(q.get('startDate'))
      const to = isoFromDmy(q.get('endDate'))
      const inRange = appointments.filter((a) => {
        const day = String(a.start_time || '').slice(0, 10)
        return day >= from && day <= to
      })
      return reply({ response: true, data: { appointments: inRange } })
    }
    if (url.includes('/bookingapi/customer/create')) return reply({ response: true, data: { customer: { key: 'c1' } } })
    if (url.includes('/bookingapi/customer')) return reply({ response: true, data: { customer: [] } })
    if (url.includes('/bookingapi/appointment/create')) {
      const body = init.body ? JSON.parse(init.body) : {}
      created.push(body)
      return reply({ response: true, data: { appointment: { key: 'a1', ...body } } })
    }
    if (url.includes('/emails')) return reply({ id: 'e1' })
    return reply({ ok: true })
  }))
  return { calls, created }
}
