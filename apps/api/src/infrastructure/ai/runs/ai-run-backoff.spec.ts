import { AI_RUN_BACKOFF_CAP_MS } from './ai-run.constants'
import { applyRunRetryAfterFloor, computeNextRunAttemptAt } from './ai-run-backoff'

const NOW = new Date('2026-06-26T00:00:00.000Z')

describe('ai-run-backoff', () => {
  afterEach(() => jest.restoreAllMocks())

  describe('computeNextRunAttemptAt', () => {
    beforeEach(() => jest.spyOn(Math, 'random').mockReturnValue(0.5)) // zero jitter

    it('applies the base delay after the first failure and doubles thereafter', () => {
      const delayMs = (attempt: number): number =>
        computeNextRunAttemptAt(attempt, NOW).getTime() - NOW.getTime()
      expect(delayMs(1)).toBe(30_000)
      expect(delayMs(2)).toBe(60_000)
      expect(delayMs(3)).toBe(120_000)
    })

    it('caps the exponential growth', () => {
      const delay = computeNextRunAttemptAt(20, NOW).getTime() - NOW.getTime()
      expect(delay).toBe(AI_RUN_BACKOFF_CAP_MS)
    })

    it('keeps the jittered delay within ±20% of the capped base', () => {
      jest.spyOn(Math, 'random').mockReturnValue(1) // max positive jitter
      const delay = computeNextRunAttemptAt(1, NOW).getTime() - NOW.getTime()
      expect(delay).toBe(36_000) // 30s * 1.2
    })
  })

  describe('applyRunRetryAfterFloor', () => {
    it('uses the provider floor when it is later than the backoff', () => {
      const backoffAt = new Date(NOW.getTime() + 30_000)
      const result = applyRunRetryAfterFloor(backoffAt, 120_000, NOW)
      expect(result.getTime() - NOW.getTime()).toBe(120_000)
    })

    it('keeps the backoff when the floor is earlier', () => {
      const backoffAt = new Date(NOW.getTime() + 120_000)
      expect(applyRunRetryAfterFloor(backoffAt, 30_000, NOW)).toEqual(backoffAt)
    })

    it('clamps an absurd floor to 24h', () => {
      const backoffAt = new Date(NOW.getTime() + 30_000)
      const result = applyRunRetryAfterFloor(backoffAt, 10 * 24 * 60 * 60 * 1000, NOW)
      expect(result.getTime() - NOW.getTime()).toBe(24 * 60 * 60 * 1000)
    })

    it('ignores a non-positive/invalid floor', () => {
      const backoffAt = new Date(NOW.getTime() + 30_000)
      expect(applyRunRetryAfterFloor(backoffAt, 0, NOW)).toEqual(backoffAt)
      expect(applyRunRetryAfterFloor(backoffAt, undefined, NOW)).toEqual(backoffAt)
    })
  })
})
