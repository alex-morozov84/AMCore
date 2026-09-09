import { beforeEach, describe, expect, it, vi } from 'vitest'

import { checkSuppression, resetSuppressionRegistryForTests } from './suppression'

vi.mock('server-only', () => ({}))

beforeEach(() => {
  resetSuppressionRegistryForTests()
})

describe('checkSuppression', () => {
  it('logs the first occurrence of a key', () => {
    expect(checkSuppression('k1', 60_000, 1_000)).toEqual({
      shouldLog: true,
      suppressedSinceLastLog: 0,
      globalOverflowSuppressedSinceLastLog: 0,
    })
  })

  it('suppresses repeats of the same key within the window', () => {
    checkSuppression('k1', 60_000, 1_000)

    expect(checkSuppression('k1', 60_000, 1_500)).toMatchObject({ shouldLog: false })
    expect(checkSuppression('k1', 60_000, 2_000)).toMatchObject({ shouldLog: false })
  })

  it('logs again once the window elapses, reporting the suppressed count', () => {
    checkSuppression('k1', 60_000, 0) // first, logs
    checkSuppression('k1', 60_000, 10_000) // suppressed #1
    checkSuppression('k1', 60_000, 20_000) // suppressed #2

    expect(checkSuppression('k1', 60_000, 61_000)).toEqual({
      shouldLog: true,
      suppressedSinceLastLog: 2,
      globalOverflowSuppressedSinceLastLog: 0,
    })
  })

  it('tracks distinct keys independently', () => {
    checkSuppression('k1', 60_000, 0)

    expect(checkSuppression('k2', 60_000, 0)).toMatchObject({ shouldLog: true })
  })

  it('bounds the per-key registry size, evicting the oldest key once capacity is exceeded', () => {
    for (let i = 0; i < 501; i++) {
      // Distinct global-budget-exempt timestamps aren't needed here since
      // maxLogLinesPerWindow is raised well above 501 for this registry-only test.
      checkSuppression(`key-${i}`, 60_000, 0, 10_000)
    }

    // key-0 was evicted to make room for key-500, so it logs again as "new".
    expect(checkSuppression('key-0', 60_000, 0, 10_000)).toMatchObject({ shouldLog: true })
  })

  it('caps total log lines per window across distinct keys (the actual volume bound)', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkSuppression(`key-${i}`, 60_000, 0, 5)).toMatchObject({ shouldLog: true })
    }

    // The 6th distinct key in the same window exceeds the global cap of 5.
    expect(checkSuppression('key-5', 60_000, 0, 5)).toEqual({
      shouldLog: false,
      suppressedSinceLastLog: 0,
      globalOverflowSuppressedSinceLastLog: 0,
    })
    expect(checkSuppression('key-6', 60_000, 0, 5)).toMatchObject({ shouldLog: false })
  })

  it('reports the global-overflow count on the next successful log after the window rolls over', () => {
    for (let i = 0; i < 5; i++) {
      checkSuppression(`key-${i}`, 60_000, 0, 5)
    }
    checkSuppression('overflow-1', 60_000, 0, 5) // dropped, global cap hit
    checkSuppression('overflow-2', 60_000, 0, 5) // dropped, global cap hit

    expect(checkSuppression('key-new', 60_000, 61_000, 5)).toEqual({
      shouldLog: true,
      suppressedSinceLastLog: 0,
      globalOverflowSuppressedSinceLastLog: 2,
    })
  })

  it('does not let a global-cap rejection consume a per-key repeat suppression slot incorrectly', () => {
    checkSuppression('k1', 60_000, 0, 1) // logs, fills the global budget of 1
    // k2 is a brand-new key but the global budget is already spent.
    expect(checkSuppression('k2', 60_000, 0, 1)).toMatchObject({ shouldLog: false })
    // k1 itself, still within its own window, is suppressed for the ordinary per-key reason.
    expect(checkSuppression('k1', 60_000, 100, 1)).toMatchObject({ shouldLog: false })
  })
})
