import { z } from 'zod'

/**
 * The Telegram reachability check (`getMe` from every worker). One place for its numbers: the job,
 * the store, the metric and the Console reader read them from here.
 */
export const TELEGRAM_REACHABILITY = {
  periodMs: 60_000,
  /** The check's own HTTP deadline; below the period so two checks never overlap. */
  deadlineMs: 8_000,
  /** An observation is recent for three periods plus slack for one late tick. */
  staleAfterSeconds: 210,
  /** How long a worker's last observation is kept after it stopped writing. */
  retentionMs: 60 * 60 * 1000,
  /** Hard cap of stored workers. A new worker beyond it is refused, nobody is evicted. */
  maxWorkers: 32,
  /** A write that reaches Redis later than this after its observation is refused as late. */
  maxWriteDelayMs: 5_000,
  /** Per Redis command; the dedicated connection has no offline queue. */
  redisCommandMs: 2_000,
  /** Upper bound of one stored value. */
  maxValueBytes: 512,
  /** Bound on cancelling an unread error body before the check slot is released. */
  bodyCancelMs: 1_000,
} as const

export const TELEGRAM_CHECK_RESULTS = ['ok', 'failed', 'unknown'] as const
export type TelegramCheckResult = (typeof TELEGRAM_CHECK_RESULTS)[number]

/** Closed failure codes; the Console words each one. Never a provider message. */
export const TELEGRAM_CHECK_FAILURES = [
  'auth_rejected',
  'request_rejected',
  'rate_limited',
  'provider_error',
  'unexpected_response',
  'invalid_response',
  'timeout',
  'unreachable',
] as const
export type TelegramCheckFailure = (typeof TELEGRAM_CHECK_FAILURES)[number]

export type TelegramCheckOutcome =
  { result: 'ok'; failure: null } | { result: 'failed' | 'unknown'; failure: TelegramCheckFailure }

/** One worker's stored observation. No token, URL, host, bot identity or provider text. */
export const telegramObservationSchema = z.strictObject({
  v: z.literal(1),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.number().int().positive(),
  seq: z.number().int().positive(),
  result: z.enum(TELEGRAM_CHECK_RESULTS),
  failure: z.enum(TELEGRAM_CHECK_FAILURES).nullable(),
})
export type TelegramObservation = z.infer<typeof telegramObservationSchema>
