// Setmore's customer search breaks on a space in the first name: a two-word
// first name returns HTTP 500 "Unable to fetch customer!" instead of an empty
// result (reproduced 25 Sep 2026). A client with a two-word first name
// paid for a session that was never booked. These pin the fix.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFreshBlobs, removeBlobs } from './helpers/blobs.js'

const reply = (body, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })

async function lib() {
  vi.resetModules()
  process.env.SETMORE_API_KEY = 'test-refresh-token'
  delete process.env.SETMORE_MOCK
  return await import('../setmore.js')
}

// searchReply(firstname) decides what Setmore's customer search returns.
function stub(searchReply) {
  const seen = { searches: [], creates: [] }
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    url = String(url)
    if (url.includes('/o/oauth2/token')) return reply({ response: true, data: { token: { access_token: 'tok', expires_in: 3600 } } })
    if (url.includes('/bookingapi/customer/create')) {
      seen.creates.push(JSON.parse(init.body))
      return reply({ response: true, data: { customer: { key: 'new-key' } } })
    }
    if (url.includes('/bookingapi/customer')) {
      const firstname = new URL(url).searchParams.get('firstname')
      seen.searches.push(firstname)
      return searchReply(firstname)
    }
    return reply({ response: true, data: {} })
  }))
  return seen
}

// What Setmore actually does: a space in the first name is a server error.
const realSetmore = (firstname) => /\s/.test(firstname)
  ? reply({ response: false, msg: 'Unable to fetch customer!' }, 500)
  : reply({ response: true, msg: 'Customer fetched successfully', data: { customer: [] } })

describe('findCustomer with multi-word first names', () => {
  beforeEach(() => installFreshBlobs())
  afterEach(() => { vi.unstubAllGlobals(); removeBlobs() })

  it('searches by the first word only, so Setmore does not fall over', async () => {
    const seen = stub(realSetmore)
    const { findCustomer } = await lib()
    const found = await findCustomer('Mary Jane', 'client@example.com')
    expect(found).toBeNull()                       // no match — caller creates one
    expect(seen.searches).toEqual(['Mary'])
  })

  it('still matches an existing customer on email', async () => {
    stub(() => reply({ response: true, data: { customer: [
      { key: 'other', email_id: 'someone@else.com' },
      { key: 'theirs', email_id: 'Client@Example.com' },
    ] } }))
    const { findCustomer } = await lib()
    expect((await findCustomer('Mary Jane', 'client@example.com')).key).toBe('theirs')
  })

  // A search failure must never cost a paid booking: the worst outcome of
  // skipping it is a duplicate customer record in Setmore.
  it('treats a failed search as "not found" rather than failing', async () => {
    stub(() => reply({ response: false, msg: 'Unable to fetch customer!' }, 500))
    const { findCustomer } = await lib()
    await expect(findCustomer('Anyone', 'client@example.com')).resolves.toBeNull()
  })

  it('keeps the full first name when the customer is created', async () => {
    const seen = stub(realSetmore)
    const { findCustomer, createCustomer } = await lib()
    expect(await findCustomer('Mary Jane', 'client@example.com')).toBeNull()
    await createCustomer({ firstName: 'Mary Jane', lastName: 'Example', email: 'client@example.com', phone: '' })
    expect(seen.creates[0].first_name).toBe('Mary Jane')
  })
})
