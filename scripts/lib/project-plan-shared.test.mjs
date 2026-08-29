// Deliberately runs against the real repo (read-only — .write() is never
// called) rather than a hand-written fixture: the whole point of these
// steps is "does the regex still match the actual current file," and a
// fixture invented to match the regex couldn't catch drift in the real one.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EngineError } from './actions.mjs'
import { buildSharedLocaleSteps } from './project-plan-shared.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('buildSharedLocaleSteps (against the real repo, read-only)', () => {
  test('trims SUPPORTED_LOCALES/DEFAULT_LOCALE and the telegram/email message maps to one locale', () => {
    const steps = buildSharedLocaleSteps(REPO_ROOT, 'ru')
    assert.equal(steps.length, 3)

    const [constants, telegram, email] = steps
    assert.match(constants.after, /export const SUPPORTED_LOCALES = \['ru'\] as const/)
    assert.match(constants.after, /export const DEFAULT_LOCALE: SupportedLocale = 'ru'/)
    assert.doesNotMatch(constants.after, /'en'/)

    assert.match(telegram.after, /ru: \{/)
    assert.doesNotMatch(telegram.after, /en: \{/)

    assert.match(email.after, /ru: \{/)
    assert.doesNotMatch(email.after, /en: \{/)
  })

  test('fails closed for a locale that has no block to keep', () => {
    assert.throws(() => buildSharedLocaleSteps(REPO_ROOT, 'fr'), EngineError)
  })
})
