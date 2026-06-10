/**
 * Bull Board mount gate (EQS-01, role-gated for ADR-041).
 *
 * Pure decision so it is unit-testable without importing the heavy queue
 * module. Disabled in production unless `ENABLE_BULL_BOARD=true` — the router
 * and placeholder controller are then absent from the module graph (zero
 * attack surface). Always enabled outside production, but still auth-protected
 * by the Bull Board middleware. **Never** mounted on the `worker` role, which
 * exposes a health-only HTTP surface.
 */
export function isBullBoardEnabled(
  nodeEnv: string | undefined,
  enableFlag: string | undefined,
  processRole?: string | undefined
): boolean {
  if (processRole === 'worker') return false
  return nodeEnv !== 'production' || enableFlag === 'true'
}

/**
 * Bull Board read-only mode (ADR-047). Secure default: the dashboard renders
 * **read-only** unless an operator explicitly opts into write actions
 * (retry / promote / clean / remove jobs) with `BULL_BOARD_READ_ONLY=false`.
 * Fail-safe — any value other than the literal `'false'` (incl. unset) stays
 * read-only. Read from `process.env` at module-construction time, like the mount
 * gate, so it cannot rely on `EnvService`/`ConfigModule`.
 */
export function isBullBoardReadOnly(readOnlyFlag: string | undefined): boolean {
  return readOnlyFlag !== 'false'
}
