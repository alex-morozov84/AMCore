/** Limits and lifetimes of the operator email test. The shared admission layer enforces them. */
export const EMAIL_TEST_POLICY = {
  /** Logical response deadline, one budget counted from `sentAt` (Redis time). */
  deadlineMs: 10_000,
  operatorCooldownSeconds: 60,
  platformPerHour: 20,
  leaseSeconds: 30,
  /** Time to confirm a prepared test. */
  issueTtlMs: 30 * 60_000,
  attemptTtlMs: 24 * 60 * 60_000,
  lastTtlMs: 7 * 24 * 60 * 60_000,
  actorTtlMs: 24 * 60 * 60_000,
  /** The in-process pause allowed between sending MARK_SENDING and calling the transport. */
  precheckMs: 5_000,
  /** A reservation that never started reads as "did not start" after this long. */
  abandonedAfterMs: 60_000,
  /** A sending attempt without a settle reads as unknown after `deadlineAt` plus this. */
  unknownGraceMs: 20_000,
  /** Freshness of the email evidence shown on the row. */
  staleAfterSeconds: 24 * 60 * 60,
  /** Every Redis command of this feature is bounded to this. */
  redisCommandMs: 250,
} as const
