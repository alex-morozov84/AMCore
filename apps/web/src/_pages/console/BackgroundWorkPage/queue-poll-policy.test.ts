import { describe, expect, it } from 'vitest'

import {
  allUnavailableSummary,
  availableQueue,
  disabledQueue,
  mixedSummary,
  summary,
  unavailableQueue,
} from './queue-fixtures'
import { isDegraded } from './queue-poll-policy'

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
