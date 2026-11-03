import diagnostics from '../ci-diagnostic.cjs'

export function recordDiagnostic(attempt, error, phase) {
  const detail = {
    phase,
    ...diagnostics.failure(error, { file: attempt.absolutePath }),
    exit: attempt.exit ?? null,
    signal:
      typeof attempt.signal === 'string' && /^SIG[A-Z]+$/.test(attempt.signal)
        ? attempt.signal
        : null,
    forced: attempt.forced ?? null,
    clean: attempt.clean,
    closed: attempt.closed ?? null,
    spawns: attempt.spawns,
  }
  attempt.lifecycleFailure = true
  attempt.diagnostic ??= detail
  attempt.diagnostics ??= []
  attempt.diagnostics.push(detail)
  console.error('API E2E lifecycle failure:', JSON.stringify(detail))
}
