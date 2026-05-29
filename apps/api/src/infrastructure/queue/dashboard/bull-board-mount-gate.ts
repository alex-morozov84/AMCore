/**
 * Bull Board mount gate (EQS-01).
 *
 * Pure decision so it is unit-testable without importing the heavy queue
 * module. Disabled in production unless `ENABLE_BULL_BOARD=true` — the router
 * and placeholder controller are then absent from the module graph (zero
 * attack surface). Always enabled outside production, but still auth-protected
 * by the Bull Board middleware.
 */
export function isBullBoardEnabled(
  nodeEnv: string | undefined,
  enableFlag: string | undefined
): boolean {
  return nodeEnv !== 'production' || enableFlag === 'true'
}
