import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Vitest Configuration for Email Integration Tests
 *
 * Used specifically for React Email template rendering tests.
 * React Email officially supports Vitest with happy-dom environment.
 *
 * @see https://react.email/docs/introduction#testing
 */
export default defineConfig({
  test: {
    name: 'email-integration',
    environment: 'happy-dom',
    include: ['**/*.integration.spec.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage-email',
      include: ['src/infrastructure/email/templates/**/*.tsx'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
