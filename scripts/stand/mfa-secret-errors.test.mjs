import assert from 'node:assert/strict'
import { test } from 'node:test'

import { redactMfaFailure } from '../../apps/web/e2e/support/mfa-secret-errors.mjs'

test('MFA failure redaction preserves the failure object while removing secrets and DOM fields', () => {
  const error = new Error('Failed fill of <fake-factor-seed> with <fake-backup-code>')
  error.errorContext = 'DOM containing <fake-factor-seed>'
  error.matcherResult = { actual: '<fake-backup-code>', expected: 'completed', ariaSnapshot: 'DOM' }
  const result = redactMfaFailure(error, ['<fake-factor-seed>', '<fake-backup-code>'])
  assert.equal(result, error)
  assert.equal(result.message, 'Failed fill of <redacted> with <redacted>')
  assert(result.stack.includes('Failed fill of <redacted>'))
  assert(!result.stack.includes('<fake-factor-seed>'))
  assert.equal(result.errorContext, undefined)
  assert.equal(result.matcherResult.ariaSnapshot, undefined)
  assert.equal(result.matcherResult.actual, '<redacted>')
  assert.equal(result.matcherResult.expected, 'completed')
})

test('nonsecret diagnostics and non-error values retain their meaning', () => {
  const error = new Error('Expected completed, received unknown')
  assert.equal(redactMfaFailure(error, ['<fake-code>']).message, error.message)
  assert.equal(redactMfaFailure(null, []), null)
  assert.equal(redactMfaFailure('failure <fake-code>', ['<fake-code>']), 'failure <redacted>')
})
