/**
 * Bull Board mount gate (EQS-01, role-gated for ADR-041).
 *
 * Pure decision so it is unit-testable without importing the heavy queue
 * module. Disabled in production unless `ENABLE_BULL_BOARD=true` — the router
 * is then absent from the module graph (zero attack surface). Always enabled
 * outside production, but still auth-protected by the Bull Board middleware.
 * **Never** mounted on the `worker` role, which exposes a health-only HTTP
 * surface.
 *
 * The Board has no writable mode: every adapter is built read-only and the
 * HTTP boundary rejects everything but GET/HEAD (see "Bull Board Dashboard" in
 * the queue README). There is no flag that changes this; the retired
 * `BULL_BOARD_READ_ONLY` variable is ignored (see `bull-board-legacy-flag.ts`).
 */
export function isBullBoardEnabled(
  nodeEnv: string | undefined,
  enableFlag: string | undefined,
  processRole?: string | undefined
): boolean {
  if (processRole === 'worker') return false
  return nodeEnv !== 'production' || enableFlag === 'true'
}
