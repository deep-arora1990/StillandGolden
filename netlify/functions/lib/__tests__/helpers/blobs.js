// An in-memory stand-in for Netlify Blobs, shared by everything that asks for
// the same store name — which is exactly what the real thing gives two
// separate function containers. Install a fresh one per test so nothing leaks.
export function sharedBlobs() {
  const stores = new Map()
  return (name, opts = {}) => {
    // The real platform refuses strong consistency in these Lambda-
    // compatibility handlers — connectLambda() never supplies the
    // uncachedEdgeURL it needs. A fake that allowed it is exactly how a
    // strong-consistency store passed every test on 24 Sep and then failed
    // every call in production. Refuse it the same way.
    if (opts.consistency === 'strong') {
      throw new Error("Netlify Blobs has failed to perform a read using strong consistency because the environment has not been configured with a 'uncachedEdgeURL' property")
    }
    if (!stores.has(name)) {
      const m = new Map()
      stores.set(name, {
        async get(k, o = {}) { return m.has(k) ? (o.type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null },
        async setJSON(k, v) { m.set(k, JSON.stringify(v)); return { modified: true } },
        async delete(k) { m.delete(k) },
        async list({ prefix = '' } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) } },
      })
    }
    return stores.get(name)
  }
}

export function installFreshBlobs() {
  const blobs = sharedBlobs()
  globalThis.__sgStoreFactory = blobs
  return blobs
}

export function removeBlobs() {
  delete globalThis.__sgStoreFactory
}
