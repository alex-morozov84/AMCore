import {
  NOTIFICATION_BACKOFF_BASE_MS,
  NOTIFICATION_BACKOFF_CAP_MS,
  NOTIFICATION_BACKOFF_JITTER,
  NOTIFICATION_RETRY_AFTER_MAX_MS,
} from '../notification-dispatch.constants'

import {
  applyRetryAfterFloor,
  computeNextAttemptAt,
  resolveRetryFloor,
} from './notification-backoff'

describe('computeNextAttemptAt', () => {
  const now = new Date('2026-06-18T00:00:00.000Z')
  const delayMs = (attemptCount: number): number =>
    computeNextAttemptAt(attemptCount, now).getTime() - now.getTime()

  afterEach(() => jest.restoreAllMocks())

  it('doubles the base delay per attempt with no jitter (random=0.5 → factor 1.0)', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(delayMs(1)).toBe(NOTIFICATION_BACKOFF_BASE_MS) // 30s
    expect(delayMs(2)).toBe(NOTIFICATION_BACKOFF_BASE_MS * 2) // 60s
    expect(delayMs(3)).toBe(NOTIFICATION_BACKOFF_BASE_MS * 4) // 120s
    expect(delayMs(4)).toBe(NOTIFICATION_BACKOFF_BASE_MS * 8) // 240s
  })

  it('caps the exponential growth at the configured ceiling', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    // A large attempt count would explode without the cap.
    expect(delayMs(20)).toBe(NOTIFICATION_BACKOFF_CAP_MS)
  })

  it('keeps the delay within the ±jitter band at both random extremes', () => {
    const base = NOTIFICATION_BACKOFF_BASE_MS * 2 // attemptCount=2 → 60s
    jest.spyOn(Math, 'random').mockReturnValue(0) // factor 1 - jitter
    expect(delayMs(2)).toBe(Math.round(base * (1 - NOTIFICATION_BACKOFF_JITTER)))
    jest.spyOn(Math, 'random').mockReturnValue(1) // factor ~1 + jitter
    expect(delayMs(2)).toBeCloseTo(base * (1 + NOTIFICATION_BACKOFF_JITTER), -1)
  })

  it('treats attemptCount 0 like the first attempt (exponent floored at 0)', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(delayMs(0)).toBe(NOTIFICATION_BACKOFF_BASE_MS)
  })
})

describe('applyRetryAfterFloor', () => {
  const now = new Date('2026-06-21T00:00:00.000Z')
  const backoffAt = new Date(now.getTime() + 60_000) // a 60s normal backoff

  it('returns the plain backoff when no floor is given', () => {
    expect(applyRetryAfterFloor(backoffAt, undefined, now)).toEqual(backoffAt)
  })

  it('ignores a non-positive / non-finite floor', () => {
    expect(applyRetryAfterFloor(backoffAt, 0, now)).toEqual(backoffAt)
    expect(applyRetryAfterFloor(backoffAt, -5, now)).toEqual(backoffAt)
    expect(applyRetryAfterFloor(backoffAt, Number.POSITIVE_INFINITY, now)).toEqual(backoffAt)
  })

  it('keeps the backoff when the floor is below it', () => {
    expect(applyRetryAfterFloor(backoffAt, 10_000, now)).toEqual(backoffAt)
  })

  it('honors a floor above the backoff (never retries before the provider asks)', () => {
    const result = applyRetryAfterFloor(backoffAt, 5 * 60_000, now)
    expect(result.getTime()).toBe(now.getTime() + 5 * 60_000)
  })

  it('clamps an absurd floor to the 24h defensive max, never parking indefinitely', () => {
    const result = applyRetryAfterFloor(backoffAt, 99 * 24 * 60 * 60_000, now)
    expect(result.getTime()).toBe(now.getTime() + NOTIFICATION_RETRY_AFTER_MAX_MS)
  })
})

describe('resolveRetryFloor (normalized once, before any branching)', () => {
  const now = new Date('2026-10-05T00:00:00.000Z')
  const H = 60 * 60_000

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'yields no floor for %s (ordinary backoff)',
    (value) => {
      expect(resolveRetryFloor(value, now)).toBeUndefined()
    }
  )

  it('honors a valid delay up to exactly 24 h as the earliest permitted next attempt', () => {
    expect(resolveRetryFloor(5 * 60_000, now)!.getTime()).toBe(now.getTime() + 5 * 60_000)
    expect(resolveRetryFloor(24 * H, now)!.getTime()).toBe(now.getTime() + 24 * H)
  })

  it('clamps a valid delay above 24 h to 24 h — the ADR-052-accepted exception, asserted explicitly', () => {
    // A valid 24 h + 1 s and a valid 48 h Retry-After are retried at 24 h, i.e. possibly EARLIER
    // than the provider asked. This is the documented policy, not a bug.
    expect(resolveRetryFloor(24 * H + 1_000, now)!.getTime()).toBe(now.getTime() + 24 * H)
    expect(resolveRetryFloor(48 * H, now)!.getTime()).toBe(now.getTime() + 24 * H)
  })

  it('jitter can never lower the floor: the later of backoff and floor wins', () => {
    const backoffAt = new Date(now.getTime() + 60_000)
    const floorMs = 120_000
    for (const random of [0, 0.5, 1]) {
      jest.spyOn(Math, 'random').mockReturnValue(random)
      const next = applyRetryAfterFloor(computeNextAttemptAt(2, now), floorMs, now)
      expect(next.getTime()).toBeGreaterThanOrEqual(now.getTime() + floorMs)
    }
    jest.restoreAllMocks()
    expect(applyRetryAfterFloor(backoffAt, floorMs, now).getTime()).toBe(now.getTime() + floorMs)
  })
})
