export function validatePlan(plan) {
  if (
    plan?.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(plan.sha) ||
    !/^[a-f0-9]{64}$/.test(plan.inputs) ||
    typeof plan.run !== 'string' ||
    !plan.run ||
    typeof plan.runAttempt !== 'string' ||
    !plan.runAttempt ||
    (plan.pullRequestHead !== null && !/^[a-f0-9]{40}$/.test(plan.pullRequestHead)) ||
    !Array.isArray(plan.all) ||
    !plan.all.length ||
    !Array.isArray(plan.shards) ||
    !plan.shards.length ||
    plan.shards.length > 3
  )
    throw new Error('Invalid API E2E plan provenance')
  const validPath = (path) =>
    typeof path === 'string' &&
    path.startsWith('test/') &&
    path.endsWith('.e2e-spec.ts') &&
    !path.includes('..') &&
    !path.includes('\\')
  if (
    !plan.all.every(validPath) ||
    new Set(plan.all).size !== plan.all.length ||
    plan.shards.some(
      (shard, index) =>
        shard.id !== `${index + 1}/${plan.shards.length}` ||
        !Array.isArray(shard.paths) ||
        !shard.paths.length ||
        !shard.paths.every(validPath)
    )
  ) {
    throw new Error('Invalid API E2E plan inventory')
  }
  const union = plan.shards.flatMap((shard) => shard.paths)
  if (
    new Set(union).size !== union.length ||
    JSON.stringify([...union].sort()) !== JSON.stringify([...plan.all].sort())
  ) {
    throw new Error('Incomplete/duplicate API E2E plan partition')
  }
}

export function validateAttempt(attempt) {
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
    attempt.exit !== 0
  ) {
    throw new Error('Abnormal/forced/replayed API E2E attempt')
  }
  const rows = attempt.rows
  if (
    rows.some(
      (row) =>
        row.attempt !== attempt.id ||
        (/^(run-start|suite-start|suite-end|terminal)$/.test(row.event) &&
          row.pid !== attempt.pid) ||
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
    rows.filter((row) => row.event === 'terminal').length !== 1 ||
    !rows.some((row) => row.event === 'terminal' && row.success === true) ||
    attempt.final?.success !== true
  ) {
    throw new Error('Missing/duplicate/incomplete API E2E report')
  }
  const suite = suites[0]
  if (rows.find((row) => row.event === 'suite-start').path !== attempt.absolutePath)
    throw new Error('Mismatched suite start')
  if (
    suite.path !== attempt.absolutePath ||
    suite.runtimeError !== false ||
    suite.failure !== false ||
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
  if (attempt.clean !== true) throw new Error('Owned resource cleanup not verified')
}
export function validateReports(plan, reports) {
  validatePlan(plan)
  if (reports.length !== plan.shards.length) throw new Error('Missing API E2E shard report')
  const seen = new Set()
  const attemptIds = new Set()
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
      validateAttempt(attempt)
    }
  }
}
