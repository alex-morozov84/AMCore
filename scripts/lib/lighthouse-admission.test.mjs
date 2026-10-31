import test from 'node:test'
import assert from 'node:assert/strict'
import { admitAuditAfterTests } from './lighthouse-admission.mjs'
test('local audit-only never certifies ordinary tests or bypasses CI prior failure', () => {
  const m = { purpose: 'e2e', mocked: false }
  admitAuditAfterTests({ ...m, testOutcome: 'passed', auditOnly: false }, 'true')
  admitAuditAfterTests({ ...m, testOutcome: 'not_run_local_audit', auditOnly: true }, undefined)
  for (const value of [
    { ...m, testOutcome: 'failed' },
    { ...m, testOutcome: 'not_run_local_audit', auditOnly: true },
    { ...m, testOutcome: 'passed', auditOnly: true },
    { ...m, testOutcome: 'passed', mocked: true },
  ])
    assert.throws(() => admitAuditAfterTests(value, 'true'))
})
