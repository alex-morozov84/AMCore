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
  it('logs a warn-level structured record with the given fields', () => {
    logDegradation({ event: 'secondary_data_degraded', source: 'queue-panel', reason: 'upstream' })

    expect(warn).toHaveBeenCalledWith(
      { event: 'secondary_data_degraded', source: 'queue-panel', reason: 'upstream' },
      'degraded_data'
    )
  })

  it('suppresses repeats of the same event+source within the volume window', () => {
    logDegradation({ event: 'secondary_data_degraded', source: 'queue-panel', reason: 'upstream' })
    logDegradation({ event: 'secondary_data_degraded', source: 'queue-panel', reason: 'upstream' })
    logDegradation({ event: 'secondary_data_degraded', source: 'queue-panel', reason: 'upstream' })

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('logs distinct sources independently, not suppressed by each other', () => {
    logDegradation({ event: 'secondary_data_degraded', source: 'queue-panel', reason: 'upstream' })
    logDegradation({ event: 'secondary_data_degraded', source: 'audit-panel', reason: 'timeout' })

    expect(warn).toHaveBeenCalledTimes(2)
  })
})
