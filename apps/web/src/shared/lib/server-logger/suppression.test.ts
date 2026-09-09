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
    })
  })

  it('suppresses repeats of the same key within the window', () => {
    checkSuppression('k1', 60_000, 1_000)

    expect(checkSuppression('k1', 60_000, 1_500)).toEqual({
      shouldLog: false,
      suppressedSinceLastLog: 0,
    })
    expect(checkSuppression('k1', 60_000, 2_000)).toEqual({
      shouldLog: false,
      suppressedSinceLastLog: 0,
    })
  })

  it('logs again once the window elapses, reporting the suppressed count', () => {
    checkSuppression('k1', 60_000, 0) // first, logs
    checkSuppression('k1', 60_000, 10_000) // suppressed #1
    checkSuppression('k1', 60_000, 20_000) // suppressed #2

    expect(checkSuppression('k1', 60_000, 61_000)).toEqual({
      shouldLog: true,
      suppressedSinceLastLog: 2,
    })
  })

  it('tracks distinct keys independently', () => {
    checkSuppression('k1', 60_000, 0)

    expect(checkSuppression('k2', 60_000, 0)).toEqual({
      shouldLog: true,
      suppressedSinceLastLog: 0,
    })
  })

  it('bounds registry size, evicting the oldest key once capacity is exceeded', () => {
    for (let i = 0; i < 501; i++) {
      checkSuppression(`key-${i}`, 60_000, 0)
    }

    // key-0 was evicted to make room for key-500, so it logs again as "new".
    expect(checkSuppression('key-0', 60_000, 0)).toEqual({
      shouldLog: true,
      suppressedSinceLastLog: 0,
    })
  })
})
