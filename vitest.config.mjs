// The functions in this repo are CommonJS — they `require` each other and are
// loaded that way by Netlify. vitest 4 only exposes its own API as ESM, so a
// CommonJS test file cannot `require('vitest')`.
//
// `globals: true` puts describe/it/expect in scope without importing them,
// which lets the tests stay CommonJS and `require` the modules under test
// directly, rather than forcing ESM test files plus createRequire gymnastics.
export default {
  test: {
    globals: true,
    include: ['netlify/functions/lib/__tests__/**/*.test.js'],
  },
}
