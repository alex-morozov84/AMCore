// Deliberately runs against the real repo (read-only — .write() is never
// called) rather than a hand-written fixture: the whole point of these
// steps is "does the regex still match the actual current file," and a
// fixture invented to match the regex couldn't catch drift in the real one.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EngineError, trimLocaleRecordLiteral } from './actions.mjs'
import { buildSharedLocaleSteps } from './project-plan-shared.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('buildSharedLocaleSteps (against the real repo, read-only)', () => {
  test('trims SUPPORTED_LOCALES/DEFAULT_LOCALE and the telegram message map to one locale', () => {
    const steps = buildSharedLocaleSteps(REPO_ROOT, 'ru')
    assert.equal(steps.length, 2)

    const [constants, telegram] = steps
    assert.match(constants.after, /export const SUPPORTED_LOCALES = \['ru'\] as const/)
    assert.match(constants.after, /export const DEFAULT_LOCALE: SupportedLocale = 'ru'/)
    assert.doesNotMatch(constants.after, /'en'/)

    assert.match(telegram.after, /ru: \{/)
    assert.doesNotMatch(telegram.after, /en: \{/)
  })

  test('fails closed for a locale that has no block to keep', () => {
    assert.throws(() => buildSharedLocaleSteps(REPO_ROOT, 'fr'), EngineError)
  })
})

describe('trimLocaleRecordLiteral', () => {
  const content = [
    'export const x = {',
    '  en: {',
    "    title: 'Hi',",
    '  },',
    '  ru: {',
    "    title: 'Привет',",
    '  },',
    '}',
    '',
  ].join('\n')

  test('keeps only the requested locale block', () => {
    const after = trimLocaleRecordLiteral(content, 'ru')
    assert.doesNotMatch(after, /en: \{/)
    assert.match(after, /ru: \{\n {4}title: 'Привет',\n {2}\},\n/)
  })

  test('fails closed when the requested locale has no block', () => {
    assert.throws(() => trimLocaleRecordLiteral(content, 'fr'), EngineError)
  })
})
