const { defineConfig } = require('vitest/config')

module.exports = defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
