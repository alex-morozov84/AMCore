import {
  constrainedRetryFloor,
  floorEligible,
  HORIZON_CHECK_OVERHEAD_MS,
  latestRetryFloor,
  transportFenceEligible,
} from './provider-window-clock'

describe('Provider-window interval admission', () => {
  const base = {
    redisTime: 10000,
    wallTime: 10000,
    monotonicElapsedMs: 0,
    wallElapsedMs: 0,
    pgSampleAgeMs: 0,
    nominalDeadline: 104001,
    floorUpper: 0,
  }

  it('reserves both timestamp errors and full scheduling/transport/margin', () => {
    expect(HORIZON_CHECK_OVERHEAD_MS).toBe(94000)
    expect(transportFenceEligible(base)).toBe(true)
    expect(transportFenceEligible({ ...base, nominalDeadline: 104000 })).toBe(false)
    expect(transportFenceEligible({ ...base, nominalDeadline: 103999 })).toBe(false)
  })

  it('rejects the independently reviewed opposite-offset counterexample', () => {
    expect(
      transportFenceEligible({
        ...base,
        redisTime: 86309999,
        wallTime: 86309999,
        nominalDeadline: 86402000,
      })
    ).toBe(false)
  })

  it('uses current lower bounds to prevent early Retry-After under changing offsets', () => {
    const floor = latestRetryFloor(0, 8000, 60000)
    expect(floor).toBe(70000)
    expect(floorEligible(71999, floor)).toBe(false)
    expect(floorEligible(72000, floor)).toBe(true)
    expect(latestRetryFloor(floor, 10000, 1)).toBe(floor)
  })

  it('keeps absolute Retry-After UTC bounds independent of a wall-to-duration conversion', () => {
    expect(constrainedRetryFloor(0, 8000, { kind: 'absolute', timestamp: 70000 })).toBe(72000)
    expect(constrainedRetryFloor(0, 8000, { kind: 'absolute', timestamp: 5000 })).toBe(10000)
    expect(constrainedRetryFloor(80000, 8000, { kind: 'absolute', timestamp: 70000 })).toBe(80000)
    expect(() =>
      constrainedRetryFloor(0, 8000, { kind: 'absolute', timestamp: Number.MAX_SAFE_INTEGER })
    ).toThrow('CLOCK_UNCERTAIN')
  })

  it('includes delayed EVAL delivery, the wall branch and PG sample freshness', () => {
    expect(
      transportFenceEligible({
        ...base,
        nominalDeadline: 200000,
        monotonicElapsedMs: 1001,
        wallElapsedMs: 1001,
      })
    ).toBe(false)
    expect(transportFenceEligible({ ...base, pgSampleAgeMs: 1001 })).toBe(false)
    expect(transportFenceEligible({ ...base, wallTime: 10001 })).toBe(false)
    expect(transportFenceEligible({ ...base, wallElapsedMs: 201 })).toBe(false)
  })

  it('refuses negative/nonfinite/overflow timing instead of granting transport', () => {
    for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => transportFenceEligible({ ...base, wallElapsedMs: value })).toThrow(
        'CLOCK_UNCERTAIN'
      )
    }
  })
})
