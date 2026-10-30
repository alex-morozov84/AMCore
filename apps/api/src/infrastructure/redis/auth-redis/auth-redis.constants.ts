/**
 * Lifecycle of one client generation.
 * - connecting: first connection attempt.
 * - active: ready and serving.
 * - reconnecting: an established generation lost readiness.
 * - failed: the client closed itself (unplanned end).
 * - retiring: replaced by the supervisor; waiting for logical disposal to be observed.
 * - leaked: disposal was requested but `isOpen` stayed true past the limit; still counted.
 * - closed: logically disposed (`destroy()` returned and `isOpen === false`).
 */
export type AuthRedisGenerationState =
  'connecting' | 'active' | 'reconnecting' | 'failed' | 'retiring' | 'leaked' | 'closed'

export type AuthRedisReplacementReason =
  'stall' | 'no-success' | 'handshake' | 'reconnect-hang' | 'unplanned-end' | 'protocol-mismatch'

export type AuthRedisEvent =
  | { kind: 'client-error'; generation: number; error: unknown }
  | { kind: 'reconnecting'; generation: number }
  | { kind: 'replaced'; generation: number; reason: AuthRedisReplacementReason }
  | {
      kind: 'alert'
      alert: 'retire-timeout' | 'retiring-cap' | 'protocol-mismatch'
      generation: number
    }

/** Client-facing text of the 503 for an unavailable authentication dependency. */
export const AUTH_UNAVAILABLE_MESSAGE = 'Authentication temporarily unavailable'

/**
 * Timing values measured in the T082 probes (application-level fault model, loopback). The
 * recovery figures derived from them are scoped test targets, not guarantees: they assume the
 * tested fault classes, an available replacement connection and normal timer scheduling.
 */
export const AUTH_REDIS_DEFAULTS = {
  /** Oldest unsettled operation of the active generation that triggers a stall replacement. */
  stallMs: 2000,
  /** No connection-level progress while connecting or reconnecting. */
  notReadyMs: 3000,
  /** Active and ready, but no successful operation for this long. */
  noSuccessMs: 3000,
  /** A success newer than this counts as healthy time. */
  okFreshMs: 3000,
  flapMinMs: 1000,
  flapMaxMs: 8000,
  /** Continuous health needed to reset the flap cooldown. */
  healthyResetMs: 30000,
  /** Fixed cadence of handshake-type replacements. */
  spawnCadenceMs: 3000,
  /** Retiring or leaked generations tolerated before replacement is refused. */
  retiringCap: 3,
  retireMaxMs: 5000,
  pingMs: 1000,
  pingDeadlineMs: 250,
  tickMs: 250,
  connectTimeoutMs: 1000,
  /** Closed generations kept for diagnostics. */
  history: 8,
  logSize: 100,
} as const

export type AuthRedisTiming = { -readonly [K in keyof typeof AUTH_REDIS_DEFAULTS]: number }
