import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { useHistoryCooldown } from './use-history-cooldown'

const onAccessLoss = vi.fn()
const mount = () => renderHook(() => useHistoryCooldown(onAccessLoss))
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-22T09:00:00.000Z') })
  onAccessLoss.mockClear()
})
afterEach(() => vi.useRealTimers())

describe('histories share one cool-down that only moves later', () => {
  it('keeps a running Retry-After when another history answers well', () => {
    const { result } = mount()
    act(() => result.current.reportFailure(new ApiRequestError(429, undefined, 120)))
    expect(result.current.mayRefetch(true)).toBe(false)
    act(() => result.current.reportSuccess())
    expect(result.current.mayRefetch(true)).toBe(false)
    expect(result.current.floors.retryAfterUntil).toBeGreaterThan(Date.now() + 100_000)
    wait(121_000)
    expect(result.current.mayRefetch(true)).toBe(true)
  })

  it('never shortens a running Retry-After with a shorter refusal or one without it', () => {
    const { result } = mount()
    act(() => result.current.reportFailure(new ApiRequestError(429, undefined, 120)))
    const deadline = result.current.floors.retryAfterUntil
    act(() => result.current.reportFailure(new ApiRequestError(429, undefined, 5)))
    expect(result.current.floors.retryAfterUntil).toBe(deadline)
    act(() => result.current.reportFailure(new ApiRequestError(503, undefined)))
    expect(result.current.floors.retryAfterUntil).toBe(deadline)
    act(() => result.current.reportFailure(new ApiRequestError(429, undefined, 200)))
    expect(result.current.floors.retryAfterUntil).toBeGreaterThan(deadline)
  })

  it('ends the backoff on a good answer but lets a manual refresh ignore it anyway', () => {
    const { result } = mount()
    act(() => result.current.reportFailure(new ApiRequestError(503, undefined)))
    expect(result.current.mayRefetch(false)).toBe(false)
    expect(result.current.mayRefetch(true)).toBe(true)
    act(() => result.current.reportSuccess())
    expect(result.current.mayRefetch(false)).toBe(true)
    expect(result.current.floors).toEqual({ retryAfterUntil: 0, backoffUntil: 0 })
  })

  it('passes access loss to the page and starts no cool-down', () => {
    const { result } = mount()
    act(() => result.current.reportFailure(new ApiRequestError(403, undefined)))
    expect(onAccessLoss).toHaveBeenCalledTimes(1)
    expect(result.current.mayRefetch(false)).toBe(true)
  })
})
