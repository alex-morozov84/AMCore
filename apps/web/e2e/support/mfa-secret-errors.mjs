/** Preserve the failed verdict and diagnostics while removing only known MFA secrets/DOM snapshots. */
export function redactMfaFailure(error, secrets) {
  const values = [...secrets].filter((value) => typeof value === 'string' && value.length > 0)
  const redact = (text) =>
    values.reduce((result, value) => result.replaceAll(value, '<redacted>'), text)
  if (typeof error === 'string') return redact(error)
  if (!error || typeof error !== 'object') return error
  if (typeof error.message === 'string') error.message = redact(error.message)
  if (typeof error.stack === 'string') error.stack = redact(error.stack)
  delete error.errorContext
  // Playwright serializes matcherResult.ariaSnapshot into error-context.md separately.
  if (error.matcherResult && typeof error.matcherResult === 'object') {
    delete error.matcherResult.ariaSnapshot
    for (const key of ['actual', 'expected']) {
      if (typeof error.matcherResult[key] === 'string')
        error.matcherResult[key] = redact(error.matcherResult[key])
    }
  }
  return error
}
