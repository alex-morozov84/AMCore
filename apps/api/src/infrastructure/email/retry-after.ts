import type { RetryAfterConstraint } from '../background-work/provider-window-clock'

export type { RetryAfterConstraint } from '../background-work/provider-window-clock'

/**
 * Normalize an HTTP `Retry-After` response header into a delay in milliseconds (RFC 9110
 * §10.2.3: a non-negative decimal number of seconds, or an HTTP-date). This is a deliberately
 * strict adapter input parser:
 *
 * - delta-seconds: ASCII digits only, at most 10 of them (a longer value is unsupported, not
 *   "malformed" — the caller falls back to ordinary backoff);
 * - HTTP-date: only the fixed IMF-fixdate form (`Sun, 06 Nov 1994 08:49:37 GMT`), measured
 *   against `now` (the response-received time);
 * - anything else (junk, negative, fractional, exponent, empty, a date in the past, `0`) yields
 *   `undefined` — no signal, ordinary backoff. Never throws.
 *
 * Resend documents the seconds form; accepting the date form is a standards-based robustness
 * choice, not a claim that Resend emits it. Bounding the delay (the 24 h policy maximum) is the
 * consumer's job.
 */
const DELTA_SECONDS = /^\d{1,10}$/
const IMF_FIXDATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/

/** Provider-window policy must preserve absolute dates; converting through Date.now loses its bound. */
export function parseRetryAfterConstraint(
  value: string | null | undefined
): RetryAfterConstraint | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = value.trim()
  if (DELTA_SECONDS.test(trimmed)) return { kind: 'duration', milliseconds: Number(trimmed) * 1000 }
  if (IMF_FIXDATE.test(trimmed)) {
    const timestamp = Date.parse(trimmed)
    if (
      Number.isSafeInteger(timestamp) &&
      timestamp >= 0 &&
      new Date(timestamp).toUTCString() === trimmed
    )
      return { kind: 'absolute', timestamp }
  }
  return { kind: 'unsupported' }
}

export function parseRetryAfterMs(
  value: string | null | undefined,
  now: Date = new Date()
): number | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (DELTA_SECONDS.test(trimmed)) {
    const seconds = Number(trimmed)
    return seconds > 0 ? seconds * 1000 : undefined
  }
  if (IMF_FIXDATE.test(trimmed)) {
    const at = Date.parse(trimmed)
    if (!Number.isFinite(at)) return undefined
    const delay = at - now.getTime()
    return delay > 0 ? delay : undefined
  }
  return undefined
}
