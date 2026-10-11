export function validateAttempt(attempt) {
  if (
    !attempt.closed ||
    attempt.signal ||
    attempt.forced ||
    attempt.lifecycleFailure ||
    attempt.spawns !== 1 ||
    attempt.exit !== 0
  ) {
    throw new Error('Abnormal/forced/replayed API E2E attempt')
  }
  const rows = attempt.rows
  if (
    rows.some(
      (row) =>
        row.attempt !== attempt.id ||
        (row.pid && row.pid !== attempt.pid) ||
        /cleanup-fail/.test(row.event)
    )
  ) {
    throw new Error('Mismatched attempt identity or failed cleanup')
  }
  const suites = rows.filter((row) => row.event === 'suite-end')
  if (
    rows.filter((row) => row.event === 'run-start').length !== 1 ||
    rows.filter((row) => row.event === 'suite-start').length !== 1 ||
    suites.length !== 1 ||
    rows.filter((row) => row.event === 'terminal' && row.success).length !== 1 ||
    !attempt.final?.success
  ) {
    throw new Error('Missing/duplicate/incomplete API E2E report')
  }
  const suite = suites[0]
  if (
    suite.path !== attempt.absolutePath ||
    suite.runtimeError ||
    suite.failure ||
    !suite.assertions.length ||
    suite.assertions.some(
      (test) =>
        test.status !== 'passed' ||
        test.invocations !== 1 ||
        !Array.isArray(test.retryReasons) ||
        test.retryReasons.length
    )
  )
    throw new Error('Failed/skipped/retried API E2E assertion')
  if (!attempt.clean) throw new Error('Owned resource cleanup not verified')
}
export function validateReports(plan, reports) {
  if (reports.length !== plan.shards.length) throw new Error('Missing API E2E shard report')
  const seen = new Set()
  for (const report of reports) {
    const shard = plan.shards.find((item) => item.id === report.shard)
    if (
      !shard ||
      seen.has(shard.id) ||
      report.inputs !== plan.inputs ||
      report.sha !== plan.sha ||
      report.run !== plan.run ||
      report.runAttempt !== plan.runAttempt ||
      !report.success ||
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
      paths.add(attempt.path)
      validateAttempt(attempt)
    }
  }
}
