import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from './actions.mjs'
import { validateAnswers } from './brand-validate.mjs'

describe('validateAnswers', () => {
  test('accepts a fully valid answer set', () => {
    assert.doesNotThrow(() =>
      validateAnswers({
        workflowMode: 'strict',
        themeMode: 'system',
        themePersistence: 'local-storage',
      })
    )
  })

  test('accepts an empty answer set (every field is optional)', () => {
    assert.doesNotThrow(() => validateAnswers({}))
  })

  for (const [key, flag, bad] of [
    ['workflowMode', '--workflow-mode', 'banana'],
    ['themeMode', '--theme-mode', 'neon'],
    ['themePersistence', '--theme-persistence', 'database'],
  ]) {
    test(`rejects an out-of-range ${flag}`, () => {
      assert.throws(
        () => validateAnswers({ [key]: bad }),
        (error) => {
          assert.ok(error instanceof EngineError)
          assert.match(error.message, new RegExp(`${flag}=${bad} is not one of`))
          return true
        }
      )
    })
  }

  for (const key of [
    'productName',
    'purpose',
    'productDescription',
    'upstreamSyncPolicy',
    'packageName',
  ]) {
    test(`rejects a newline in ${key}`, () => {
      assert.throws(() => validateAnswers({ [key]: 'a\nb' }), EngineError)
    })
  }

  describe('packageName', () => {
    for (const valid of ['acme', 'acme-app', 'acme.app', '@acme/app']) {
      test(`accepts "${valid}"`, () => {
        assert.doesNotThrow(() => validateAnswers({ packageName: valid }))
      })
    }

    for (const invalid of ['Bad Name!', 'UPPERCASE', 'has spaces', '.starts-with-dot', '']) {
      test(`rejects "${invalid}"`, () => {
        assert.throws(() => validateAnswers({ packageName: invalid }), EngineError)
      })
    }

    test('rejects a name over 214 characters', () => {
      assert.throws(() => validateAnswers({ packageName: 'a'.repeat(215) }), EngineError)
    })

    for (const reserved of ['node_modules', 'favicon.ico']) {
      test(`rejects the reserved name "${reserved}" (syntactically valid but denylisted by npm)`, () => {
        assert.throws(() => validateAnswers({ packageName: reserved }), EngineError)
      })
    }
  })
})
