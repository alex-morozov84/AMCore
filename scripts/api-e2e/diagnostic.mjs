export function recordDiagnostic(attempt, error, phase) {
  const message = error instanceof Error ? error.message : String(error)
  attempt.lifecycleFailure = true
  attempt.diagnostic ??= message
  attempt.diagnostics ??= []
  attempt.diagnostics.push({ phase, message })
}
