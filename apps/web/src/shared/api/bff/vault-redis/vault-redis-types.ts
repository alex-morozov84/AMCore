import type { WebRedisClient } from '../redis-client'

/** Unsettled operations one generation may hold; a retired generation's slots settle at once. */
export const VAULT_REDIS_CAPACITY = 512
/** Default wait of one vault Redis command; callers pass what is left of their own budget. */
export const VAULT_REDIS_DEADLINE_MS = 1000

export type VaultRedisClient = ReturnType<WebRedisClient['withCommandOptions']>
export type VaultRedisReason = 'capacity' | 'not_ready' | 'dispatch' | 'deadline' | 'command'
/** `not_sent` only when the command provably never left; anything later is `unknown`. */
export type VaultRedisOutcome = 'not_sent' | 'unknown'

export class VaultRedisError extends Error {
  constructor(
    readonly reason: VaultRedisReason,
    readonly outcome: VaultRedisOutcome,
    options?: { cause?: unknown }
  ) {
    super(`Vault Redis operation failed: ${reason}`, options)
    this.name = 'VaultRedisError'
  }
}

export type VaultGenerationState =
  'connecting' | 'active' | 'reconnecting' | 'failed' | 'retiring' | 'leaked' | 'closed'

export type VaultReplacementReason =
  'stall' | 'no-success' | 'handshake' | 'reconnect-hang' | 'unplanned-end' | 'protocol-mismatch'

export type VaultRedisEvent =
  | { kind: 'client-error'; generation: number; error: unknown }
  | { kind: 'reconnecting'; generation: number }
  | { kind: 'replaced'; generation: number; reason: VaultReplacementReason }
  | {
      kind: 'alert'
      alert: 'retire-timeout' | 'retiring-cap' | 'protocol-mismatch'
      generation: number
    }

/**
 * Timing values measured in the T082 probes (application-level fault model, loopback). Recovery
 * figures derived from them are scoped test targets, not guarantees.
 */
export const VAULT_REDIS_TIMING = {
  stallMs: 2000,
  notReadyMs: 3000,
  noSuccessMs: 3000,
  okFreshMs: 3000,
  flapMinMs: 1000,
  flapMaxMs: 8000,
  healthyResetMs: 30000,
  spawnCadenceMs: 3000,
  retiringCap: 3,
  retireMaxMs: 5000,
  pingMs: 1000,
  pingDeadlineMs: 250,
  tickMs: 250,
  connectTimeoutMs: 1000,
  history: 8,
} as const

export type VaultRedisTiming = { -readonly [K in keyof typeof VAULT_REDIS_TIMING]: number }
