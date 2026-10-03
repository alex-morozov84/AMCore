import { describe, expect, it } from 'vitest'

import { ApiNetworkError, ApiRequestError } from '@/shared/api/http-client'

import {
  allUnavailableSummary,
  availableQueue,
  disabledQueue,
  mixedSummary,
  summary,
  unavailableQueue,
} from './queue-fixtures'
import {
  backoffMs,
  canRefreshManually,
  floorsAfterFailure,
  isAccessLoss,
  isAdmitted,
  isDegraded,
  MAX_BACKOFF_MS,
  NO_FLOORS,
  retryAfterSecondsOf,
} from './queue-poll-policy'

describe('degraded streak classification', () => {
  it('counts only a response where every enabled queue is unavailable', () => {
    expect(isDegraded(allUnavailableSummary)).toBe(true)
    expect(isDegraded(summary([unavailableQueue('a'), disabledQueue('b')]))).toBe(true)
  })

  it('treats a mixture, disabled-only and empty inventories as healthy', () => {
    expect(isDegraded(mixedSummary)).toBe(false)
    expect(isDegraded(summary([disabledQueue('a')]))).toBe(false)
    expect(isDegraded(summary([]))).toBe(false)
    expect(isDegraded(summary([availableQueue('a')]))).toBe(false)
  })
})

describe('backoff and cool-down floors', () => {
  it('doubles from 30 s and caps at 300 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([
      0,
      30_000,
      60_000,
      120_000,
      240_000,
      300_000,
      MAX_BACKOFF_MS,
    ])
  })

  it('never lets a backoff shorten a Retry-After', () => {
    const floors = floorsAfterFailure(1_000, 1, 120)
    expect(floors.retryAfterUntil).toBe(121_000)
    expect(floors.backoffUntil).toBe(121_000)
    expect(floorsAfterFailure(1_000, 3).retryAfterUntil).toBe(0)
  })

  it('caps an absurd Retry-After', () => {
    expect(floorsAfterFailure(0, 1, 86_400).retryAfterUntil).toBe(300_000)
  })
})

describe('admission', () => {
  const base = {
    auto: true,
    denied: false,
    visible: true,
    online: true,
    now: 100,
    floors: NO_FLOORS,
  }

  it('admits automatic fetches only when every condition holds', () => {
    expect(isAdmitted(base)).toBe(true)
    expect(isAdmitted({ ...base, auto: false })).toBe(false)
    expect(isAdmitted({ ...base, denied: true })).toBe(false)
    expect(isAdmitted({ ...base, visible: false })).toBe(false)
    expect(isAdmitted({ ...base, online: false })).toBe(false)
    expect(isAdmitted({ ...base, floors: { retryAfterUntil: 0, backoffUntil: 101 } })).toBe(false)
    expect(isAdmitted({ ...base, floors: { retryAfterUntil: 101, backoffUntil: 0 } })).toBe(false)
    expect(isAdmitted({ ...base, floors: { retryAfterUntil: 100, backoffUntil: 100 } })).toBe(true)
  })

  it('lets a manual refresh ignore auto and backoff but not Retry-After, offline or denial', () => {
    const manual = { denied: false, online: true, now: 100, floors: NO_FLOORS }
    expect(canRefreshManually(manual)).toBe(true)
    expect(
      canRefreshManually({ ...manual, floors: { retryAfterUntil: 0, backoffUntil: 999 } })
    ).toBe(true)
    expect(
      canRefreshManually({ ...manual, floors: { retryAfterUntil: 101, backoffUntil: 0 } })
    ).toBe(false)
    expect(canRefreshManually({ ...manual, online: false })).toBe(false)
    expect(canRefreshManually({ ...manual, denied: true })).toBe(false)
  })
})

describe('error classification', () => {
  it('ends the display on 401/403 only', () => {
    expect(isAccessLoss(new ApiRequestError(401, undefined))).toBe(true)
    expect(isAccessLoss(new ApiRequestError(403, undefined))).toBe(true)
    expect(isAccessLoss(new ApiRequestError(429, undefined, 5))).toBe(false)
    expect(isAccessLoss(new ApiRequestError(503, undefined))).toBe(false)
    expect(isAccessLoss(new ApiNetworkError(new Error('offline')))).toBe(false)
    expect(retryAfterSecondsOf(new ApiRequestError(429, undefined, 5))).toBe(5)
    expect(retryAfterSecondsOf(new Error('x'))).toBeUndefined()
  })
})
