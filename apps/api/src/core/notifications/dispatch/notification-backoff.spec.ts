import {
  NOTIFICATION_BACKOFF_BASE_MS,
  NOTIFICATION_BACKOFF_CAP_MS,
  NOTIFICATION_BACKOFF_JITTER,
} from '../notification-dispatch.constants'

import { computeNextAttemptAt } from './notification-backoff'

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
