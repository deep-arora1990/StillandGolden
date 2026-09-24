// Storage shared by every running copy of the site's functions.
//
// Why it exists: each Netlify function invocation may land on a different
// container, and until 24 Sep 2026 every container kept its own Setmore token
// and its own availability cache. Copies re-checked months another copy had
// just checked, and each fetched its own token — and a new Setmore token
// appears to cancel the previous one, so the copies kept cancelling each other.
// That churn is what throttled the account. Netlify Blobs gives them one place
// to share both.
//
// These are Lambda-compatibility handlers (exports.handler), where Blobs is NOT
// configured automatically: connectStore(event) must run at the top of any
// handler that wants the shared store. A handler that doesn't — or a local dev
// run, or a test — gets an in-memory store with the same interface instead, so
// callers never branch and nothing breaks if Blobs is unavailable. Losing the
// shared store costs efficiency, never correctness.

const { connectLambda, getStore } = require('@netlify/blobs');

let connected = false;
const memoryStores = new Map();

// Test-only injection, through a global rather than module state. Under vitest
// a CJS `require` and an ESM `import` of this file load TWO separate instances,
// so a setter on one never reaches the other — which silently made an earlier
// version of these tests pass by accident. A global is visible to both.
const injectedFactory = () => globalThis.__sgStoreFactory || null;

function connectStore(event) {
  if (injectedFactory()) return;
  try {
    connectLambda(event);
    connected = true;
  } catch (err) {
    console.warn('shared-store: Blobs unavailable, using per-instance memory:', err.message);
  }
}

// Mirrors the subset of the Blobs store API this site uses.
function memoryStore(name) {
  if (!memoryStores.has(name)) {
    const map = new Map();
    memoryStores.set(name, {
      async get(key, opts = {}) {
        if (!map.has(key)) return null;
        const raw = map.get(key);
        return opts.type === 'json' ? JSON.parse(raw) : raw;
      },
      async setJSON(key, value) { map.set(key, JSON.stringify(value)); return { modified: true }; },
      async delete(key) { map.delete(key); },
      async list({ prefix = '' } = {}) {
        return { blobs: [...map.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
      },
    });
  }
  return memoryStores.get(name);
}

function store(name, opts) {
  const injected = injectedFactory();
  if (injected) return injected(name, opts);
  if (!connected) return memoryStore(name);
  try {
    return getStore({ name, ...opts });
  } catch (err) {
    console.warn(`shared-store: getStore(${name}) failed, using memory:`, err.message);
    return memoryStore(name);
  }
}

// Both stores use Blobs' default EVENTUAL consistency: reads may lag a change
// by up to 60 seconds, including a cached "not found" for a key just written.
//
// The token was first read with strong consistency, and that failed on every
// call in production (24 Sep 2026): strong reads need an `uncachedEdgeURL`, and
// connectLambda() — the only way to configure Blobs in these Lambda-
// compatibility handlers — never provides one (confirmed in the library
// source). Rather than every read failing and falling back per-container,
// eventual consistency gets the main benefit: a new container adopts the
// existing token instead of fetching its own, which was the bulk of the churn.
//
// The cost is bounded: when a shared token is genuinely rejected (Studio or the
// 5am contact sync issuing their own, say), instances can disagree for up to a
// minute and replace it a few extra times before settling. Moving the busiest
// handlers to Netlify's current function format would allow strong reads and
// remove even that.
const tokenStore = () => store('setmore-token');
const availabilityStore = () => store('availability');

// Tests inject a store shared between two "instances" to prove they share.
function __setStoreFactoryForTest(fn) {
  if (fn) globalThis.__sgStoreFactory = fn;
  else delete globalThis.__sgStoreFactory;
}

module.exports = { connectStore, tokenStore, availabilityStore, memoryStore, __setStoreFactoryForTest };
