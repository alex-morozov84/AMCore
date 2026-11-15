import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const turbo = JSON.parse(readFileSync('turbo.json', 'utf8'))
const example = readFileSync('.env.example', 'utf8')

// Turborepo's strict environment mode (the default) filters a task's runtime variables.
// Web reads no .env file, so `pnpm dev` must pass these shell values through. They
// stay out of the task hash and out of globalEnv, never become NEXT_PUBLIC_*, and strict
// mode itself stays on. The origins are inputs of the placement fingerprint the API verifies.
test('native dev passes the web-to-API settings through strict mode and builds shared first', () => {
  assert.deepEqual(turbo.tasks.dev.passThroughEnv, [
    'WEB_FRONTEND_CONTEXT_KEY',
    'REDIS_URL',
    'FRONTEND_URL',
    'PRODUCT_ADMIN_ORIGIN',
    'WEB_TRUSTED_ORIGINS',
  ])
  // Web imports shared's built output; a fresh clone must build it before any dev process.
  assert.deepEqual(turbo.tasks.dev.dependsOn, ['^build'])
  assert.equal(turbo.envMode, undefined)
  assert.deepEqual(turbo.globalEnv, ['NEXT_PUBLIC_*'])
  assert.equal(turbo.tasks.dev.env, undefined)
})

// A copied .env must not carry a usable shared secret: an empty value makes web refuse.
test('the example ships no value for the confidential web-to-API proof key', () => {
  assert.match(example, /^WEB_FRONTEND_CONTEXT_KEY=$/m)
})
