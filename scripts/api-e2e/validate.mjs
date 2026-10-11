import { validatePlan } from './plan-validation.mjs'
export { validatePlan }

export function validateAttempt(attempt, { ordinaryFailure = false } = {}) {
  if (
    typeof attempt.id !== 'string' ||
    !attempt.id ||
    typeof attempt.absolutePath !== 'string' ||
    !attempt.absolutePath ||
    attempt.closed !== true ||
    attempt.signal !== null ||
    attempt.forced !== false ||
    attempt.lifecycleFailure !== false ||
    !Number.isInteger(attempt.pid) ||
    attempt.pid <= 0 ||
    attempt.spawns !== 1 ||
    attempt.exit !== (ordinaryFailure ? 1 : 0) ||
    attempt.clean !== true
  ) {
    throw new Error('Abnormal/forced/replayed API E2E attempt')
  }
  const rows = attempt.rows
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) =>
        row.attempt !== attempt.id ||
        (/^(run-start|suite-start|suite-end|terminal)$/.test(row.event) &&
          row.pid !== attempt.pid) ||
        /cleanup-fail/.test(row.event)
    )
  )
    throw new Error('Mismatched attempt identity or failed cleanup')
  const single = (event) => {
    const matches = rows.filter((row) => row.event === event)
    if (matches.length !== 1) throw new Error('Missing/duplicate/incomplete API E2E report')
    return matches[0]
  }
  single('run-start')
  const start = single('suite-start'),
    suite = single('suite-end'),
    terminal = single('terminal')
  if (terminal.success !== !ordinaryFailure || attempt.final?.success !== !ordinaryFailure)
    throw new Error('Incomplete/mismatched API E2E terminal outcome')
  if (start.path !== attempt.absolutePath || suite.path !== attempt.absolutePath)
    throw new Error('Mismatched suite start/end')
  if (
    suite.runtimeError !== false ||
    suite.failure !== ordinaryFailure ||
    !Array.isArray(suite.assertions) ||
    !suite.assertions.length ||
    suite.assertions.some(
      (test) =>
        !['passed', ...(ordinaryFailure ? ['failed'] : [])].includes(test.status) ||
        test.invocations !== 1 ||
        !Array.isArray(test.retryReasons) ||
        test.retryReasons.length
    ) ||
    (ordinaryFailure && !suite.assertions.some((test) => test.status === 'failed'))
  ) {
    throw new Error('Failed/skipped/retried API E2E assertion')
  }
}

export function isOrdinaryFailure(attempt) {
  try {
    validateAttempt(attempt, { ordinaryFailure: true })
    return true
  } catch {
    return false
  }
}

export function actualSuitePath(attempt) {
  const absolute = attempt.absolutePath
  if (
    typeof absolute !== 'string' ||
    !absolute.startsWith('/') ||
    absolute.includes('\\') ||
    absolute.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('Invalid actual suite path')
  if (!absolute.endsWith(`/apps/api/${attempt.path}`))
    throw new Error('Assigned suite differs from actual suite path')
  return attempt.path
}

export function validateReports(plan, reports) {
  validatePlan(plan)
  if (reports.length !== plan.shards.length) throw new Error('Missing API E2E shard report')
  const seen = new Set()
  const attemptIds = new Set()
  const actualPaths = new Set()
  for (const report of reports) {
    const shard = plan.shards.find((item) => item.id === report.shard)
    if (
      !shard ||
      report.schemaVersion !== 1 ||
      report.pullRequestHead !== plan.pullRequestHead ||
      seen.has(shard.id) ||
      report.inputs !== plan.inputs ||
      report.sha !== plan.sha ||
      report.run !== plan.run ||
      report.runAttempt !== plan.runAttempt ||
      report.success !== true ||
      report.paths.join('\n') !== shard.paths.join('\n')
    ) {
      throw new Error('Invalid API E2E shard provenance/coverage')
    }
    seen.add(shard.id)
    if (report.attempts.length !== shard.paths.length)
      throw new Error('Incomplete API E2E attempts')
    const paths = new Set()
    for (const attempt of report.attempts) {
      if (paths.has(attempt.path) || !shard.paths.includes(attempt.path))
        throw new Error('Duplicate/unknown suite attempt')
      if (typeof attempt.id !== 'string' || !attempt.id || attemptIds.has(attempt.id))
        throw new Error('Duplicate/missing API E2E attempt identity')
      attemptIds.add(attempt.id)
      paths.add(attempt.path)
      const actual = actualSuitePath(attempt)
      if (actualPaths.has(actual)) throw new Error('Duplicate actual suite path')
      actualPaths.add(actual)
      validateAttempt(attempt)
    }
  }
}
