// The Studio "Refresh availability" button lands here. It exists for the one
// thing the shared cache can't see: a change Deep makes directly in Setmore,
// like opening a weekday for a client.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

const SECRET = 'test-refresh-secret'
let blobs

async function handler() {
  vi.resetModules()
  return (await import('../../availability-refresh.js')).handler
}
const post = (secret, body) => ({
  httpMethod: 'POST',
  headers: secret ? { 'x-refresh-secret': secret } : {},
  body: body ? JSON.stringify(body) : undefined,
})

describe('availability-refresh', () => {
  beforeEach(async () => {
    blobs = installFreshBlobs()
    process.env.AVAILABILITY_REFRESH_SECRET = SECRET
    const s = blobs('availability')
    await s.setJSON('golden/2026-10', { availableDates: [], fetchedAt: 1 })
    await s.setJSON('glimpse/2026-10', { availableDates: [], fetchedAt: 1 })
    await s.setJSON('golden/2027-03', { availableDates: [], fetchedAt: 1 })
  })
  afterEach(() => { removeBlobs(); delete process.env.AVAILABILITY_REFRESH_SECRET })

  const remaining = async () => (await blobs('availability').list()).blobs.map((b) => b.key).sort()

  it('refuses a request without the secret, and clears nothing', async () => {
    const res = await (await handler())(post(null))
    expect(res.statusCode).toBe(401)
    expect(await remaining()).toHaveLength(3)
  })

  it('refuses a wrong secret', async () => {
    expect((await (await handler())(post('nope'))).statusCode).toBe(401)
    expect(await remaining()).toHaveLength(3)
  })

  it('clears every cached month with the right secret', async () => {
    const res = await (await handler())(post(SECRET))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).cleared).toBe(3)
    expect(await remaining()).toEqual([])
  })

  it('can clear a single month, across every package', async () => {
    const res = await (await handler())(post(SECRET, { year: 2026, month: 10 }))
    expect(JSON.parse(res.body).cleared).toBe(2)
    expect(await remaining()).toEqual(['golden/2027-03'])
  })

  it('only accepts POST', async () => {
    expect((await (await handler())({ httpMethod: 'GET', headers: { 'x-refresh-secret': SECRET } })).statusCode).toBe(405)
  })

  // A missing variable must fail closed, never open.
  it('refuses everything when no secret is configured', async () => {
    delete process.env.AVAILABILITY_REFRESH_SECRET
    expect((await (await handler())(post(''))).statusCode).toBe(500)
    expect((await (await handler())(post(undefined))).statusCode).toBe(500)
    expect(await remaining()).toHaveLength(3)
  })
})
