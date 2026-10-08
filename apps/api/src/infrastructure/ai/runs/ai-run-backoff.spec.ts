import { AI_RUN_BACKOFF_CAP_MS } from './ai-run.constants'
import { computeNextRunAttemptAt } from './ai-run-backoff'

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
})
