// When a paid booking can't be written to Setmore, the payment is HELD: no
// refund, Deep is told how to rebook, and the customer is told only what is
// true. Before 25 Sep 2026 a failure refunded automatically — except for split
// payments, where the refund could never work and the subscription was left
// billing weekly — and told the customer "I've issued a full refund" either way.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

async function webhook() {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test'
  delete process.env.SETMORE_MOCK
  return (await import('../../stripe-webhook.js'))._test
}

const WEEK = 7 * 24 * 3600
function fakeStripe({ capFails = false } = {}) {
  const calls = { refunds: 0, retrieve: 0, update: [] }
  return {
    calls,
    refunds: { create: async () => { calls.refunds++; return { id: 're_1', status: 'succeeded' } } },
    subscriptions: {
      retrieve: async () => {
        calls.retrieve++
        if (capFails) throw new Error('stripe down')
        return { items: { data: [{ current_period_start: 1_000_000, current_period_end: 1_000_000 + WEEK }] } }
      },
      update: async (id, params) => { calls.update.push({ id, params }); return {} },
    },
  }
}
function fakeResend() {
  const sent = []
  return { sent, emails: { send: async (m) => { sent.push(m); return { id: 'e' } } } }
}

const base = { firstName: 'Mary Jane', lastName: 'Example', email: 'client@example.com',
               phone: '+61400000000', service_key: 'svc', date: '2026-10-10', time: '11:30' }
const err = new Error('Unable to fetch customer!')

describe('held booking', () => {
  beforeEach(() => installFreshBlobs())
  afterEach(() => removeBlobs())

  it('refunds nothing — the payment is held for Deep to decide', async () => {
    const { holdFailedBooking } = await webhook()
    const stripe = fakeStripe(); const resend = fakeResend()
    await holdFailedBooking(stripe, resend, { id: 'cs_1', payment_intent: 'pi_1' }, base, err)
    expect(stripe.calls.refunds).toBe(0)
  })

  it('tells the customer only what is true: no refund, time to be confirmed personally', async () => {
    const { holdFailedBooking } = await webhook()
    const resend = fakeResend()
    await holdFailedBooking(fakeStripe(), resend, { id: 'cs_1' }, base, err)
    const toCustomer = resend.sent.find((m) => m.to === base.email)
    expect(toCustomer.text).not.toMatch(/refund/i)
    expect(toCustomer.text).toMatch(/confirm it with you personally/)
  })

  it('gives Deep everything needed to rebook, and how to cancel instead', async () => {
    const { holdFailedBooking } = await webhook()
    const resend = fakeResend()
    await holdFailedBooking(fakeStripe(), resend, { id: 'cs_1' }, base, err)
    const toDeep = resend.sent.find((m) => m.to !== base.email)
    expect(toDeep.subject).toMatch(/ACTION NEEDED — paid booking not in the calendar/)
    expect(toDeep.text).toMatch(/Nothing has been refunded/)
    expect(toDeep.text).toMatch(/2026-10-10 at 11:30/)
    expect(toDeep.text).toMatch(/Unable to fetch customer!/)
  })

  // The case that actually happened: split payment, booking failed, and the
  // subscription was left with nothing to stop it.
  it('still caps a split subscription, so a held booking cannot bill weekly forever', async () => {
    const { holdFailedBooking } = await webhook()
    const stripe = fakeStripe()
    await holdFailedBooking(stripe, fakeResend(), { id: 'cs_1', subscription: 'sub_1' }, { ...base, pay_mode: 'split' }, err)
    expect(stripe.calls.update).toHaveLength(1)
    expect(stripe.calls.update[0]).toEqual({ id: 'sub_1', params: { cancel_at: 1_000_000 + 2 * WEEK } })
  })

  it('tells Deep how to stop a split he decides not to keep', async () => {
    const { holdFailedBooking } = await webhook()
    const resend = fakeResend()
    await holdFailedBooking(fakeStripe(), resend, { id: 'cs_1', subscription: 'sub_1' }, { ...base, pay_mode: 'split' }, err)
    const toDeep = resend.sent.find((m) => m.to !== base.email)
    expect(toDeep.text).toMatch(/Cancel subscription → Immediately/)
    expect(toDeep.text).toMatch(/Subscription: sub_1/)
  })

  it('leaves a paid-in-full booking\'s Stripe records alone', async () => {
    const { holdFailedBooking } = await webhook()
    const stripe = fakeStripe()
    await holdFailedBooking(stripe, fakeResend(), { id: 'cs_1', payment_intent: 'pi_1' }, base, err)
    expect(stripe.calls.retrieve).toBe(0)
    expect(stripe.calls.update).toHaveLength(0)
  })

  it('alerts Deep if the cap itself fails, with the safe way to stop it', async () => {
    const { holdFailedBooking } = await webhook()
    const resend = fakeResend()
    await holdFailedBooking(fakeStripe({ capFails: true }), resend, { id: 'cs_1', subscription: 'sub_1' }, { ...base, pay_mode: 'split' }, err)
    const alert = resend.sent.find((m) => /uncapped subscription/.test(m.subject))
    expect(alert).toBeTruthy()
    expect(alert.text).toMatch(/AFTER the second payment/)
  })
})
