// A small in-memory Stripe for the gift voucher tests: coupons, promotion
// codes (looked up by code, as the real list endpoint does) and checkout
// sessions. Only what the voucher code calls.
export function fakeStripe() {
  const coupons = new Map()
  const promos = new Map()
  const sessions = []
  let n = 0
  const notFound = () => Object.assign(new Error('No such coupon'), { statusCode: 404, code: 'resource_missing' })
  return {
    _promos: promos,
    _coupons: coupons,
    _sessions: sessions,
    coupons: {
      async retrieve(id) { if (!coupons.has(id)) throw notFound(); return coupons.get(id) },
      async create(params) { const c = { id: params.id || `co_${++n}`, ...params }; coupons.set(c.id, c); return c },
    },
    promotionCodes: {
      async list({ code }) { return { data: [...promos.values()].filter((p) => p.code.toUpperCase() === String(code).toUpperCase()) } },
      async create(params) {
        if ([...promos.values()].some((p) => p.code === params.code)) throw new Error('code exists')
        const p = { id: `promo_${++n}`, code: params.code, active: params.active, promotion: params.promotion, metadata: { ...params.metadata } }
        promos.set(p.id, p)
        return p
      },
      async update(id, { metadata }) { const p = promos.get(id); p.metadata = { ...p.metadata, ...metadata }; return p },
    },
    checkout: {
      sessions: {
        async create(params) { const s = { id: `cs_test_${++n}`, url: `https://checkout.stripe.test/${n}`, ...params }; sessions.push(s); return s },
        async retrieve(id) { return sessions.find((s) => s.id === id) || { id, metadata: {} } },
        async update(id, { metadata }) {
          let s = sessions.find((x) => x.id === id)
          if (!s) { s = { id, metadata: {} }; sessions.push(s) }
          s.metadata = { ...s.metadata, ...metadata }
          return s
        },
      },
    },
    // The handler verifies the signature; here the body is the event.
    webhooks: { constructEvent(body) { return JSON.parse(body) } },
  }
}
