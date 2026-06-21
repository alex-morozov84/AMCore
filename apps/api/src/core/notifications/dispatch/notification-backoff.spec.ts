import {
  NOTIFICATION_BACKOFF_BASE_MS,
  NOTIFICATION_BACKOFF_CAP_MS,
  NOTIFICATION_BACKOFF_JITTER,
  NOTIFICATION_RETRY_AFTER_MAX_MS,
} from '../notification-dispatch.constants'

import { applyRetryAfterFloor, computeNextAttemptAt } from './notification-backoff'

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
