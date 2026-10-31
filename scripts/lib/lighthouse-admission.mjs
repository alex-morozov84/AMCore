import { invariant } from './lighthouse-plan.mjs'
export function admitAuditAfterTests(m, ci) {
  invariant(m.purpose === 'e2e' && !m.mocked, 'audit-requires-disposable-real-stack')
  const tested = m.testOutcome === 'passed' && !m.auditOnly
  const localOnly = m.auditOnly === true && m.testOutcome === 'not_run_local_audit' && ci !== 'true'
  invariant(tested || localOnly, 'audit-prior-test-failure')
}
