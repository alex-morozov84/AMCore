// Runs read-only against the real repo's current (multi-locale)
// packages/shared/src/constants/index.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EngineError } from './actions.mjs'
import { assertKnownLocale, readCurrentSupportedLocales } from './project-config.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('readCurrentSupportedLocales (against the real repo)', () => {
  test('reads the real SUPPORTED_LOCALES', () => {
    assert.deepEqual(readCurrentSupportedLocales(REPO_ROOT), ['en', 'ru'])
  })
})

describe('assertKnownLocale (against the real repo)', () => {
  test('does not throw for a currently-supported locale', () => {
    assert.doesNotThrow(() => assertKnownLocale(REPO_ROOT, 'en'))
    assert.doesNotThrow(() => assertKnownLocale(REPO_ROOT, 'ru'))
  })

  test('fails closed with a clear message for an unsupported locale', () => {
    assert.throws(
      () => assertKnownLocale(REPO_ROOT, 'de'),
      (error) => error instanceof EngineError && /en, ru/.test(error.message)
    )
  })
})
