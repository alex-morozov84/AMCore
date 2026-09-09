import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logDegradation } from './degradation-event'
import { getServerLogger } from './logger'
import { resetSuppressionRegistryForTests } from './suppression'

vi.mock('server-only', () => ({}))
vi.mock('./logger', () => ({ getServerLogger: vi.fn() }))

const warn = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  resetSuppressionRegistryForTests()
  vi.mocked(getServerLogger).mockReturnValue({ warn } as never)
})

describe('logDegradation', () => {
  it('logs a warn-level structured record owning its own event name', () => {
    logDegradation({ source: 'queue-panel', reason: 'upstream' })

    expect(warn).toHaveBeenCalledWith(
      { event: 'secondary_data_degraded', source: 'queue-panel', reason: 'upstream' },
      'degraded_data'
    )
  })

  it('normalizes an invalid source instead of logging it verbatim', () => {
    logDegradation({ source: 'Not A Valid Source!!', reason: 'timeout' })

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'invalid-source' }),
      'degraded_data'
    )
  })

  it('never lets a surplus field on the input object reach the logger', () => {
    const withExtra = { source: 'queue-panel', reason: 'timeout', password: 'leak-me' } as never

    logDegradation(withExtra)

    const [record] = warn.mock.calls[0] as [Record<string, unknown>]
    expect(record).not.toHaveProperty('password')
  })

  it('suppresses repeats of the same source within the volume window', () => {
    logDegradation({ source: 'queue-panel', reason: 'upstream' })
    logDegradation({ source: 'queue-panel', reason: 'upstream' })
    logDegradation({ source: 'queue-panel', reason: 'upstream' })

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('logs distinct sources independently, not suppressed by each other', () => {
    logDegradation({ source: 'queue-panel', reason: 'upstream' })
    logDegradation({ source: 'audit-panel', reason: 'timeout' })

    expect(warn).toHaveBeenCalledTimes(2)
  })
})
