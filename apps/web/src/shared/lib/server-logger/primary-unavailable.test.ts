import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getServerLogger } from './logger'
import { logPrimaryUnavailable } from './primary-unavailable'
import { resetSuppressionRegistryForTests } from './suppression'

vi.mock('server-only', () => ({}))
vi.mock('./logger', () => ({ getServerLogger: vi.fn() }))

const error = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  resetSuppressionRegistryForTests()
  vi.mocked(getServerLogger).mockReturnValue({ error } as never)
})

describe('logPrimaryUnavailable', () => {
  it('logs an error-level structured record owning its own event name', () => {
    logPrimaryUnavailable({ source: 'product-detail', reason: 'upstream', correlationId: 'corr-1' })

    expect(error).toHaveBeenCalledWith(
      {
        event: 'primary_data_unavailable',
        source: 'product-detail',
        reason: 'upstream',
        correlationId: 'corr-1',
      },
      'primary_data_unavailable'
    )
  })

  it('suppresses repeats of the same source within the volume window', () => {
    logPrimaryUnavailable({ source: 'product-detail', reason: 'upstream' })
    logPrimaryUnavailable({ source: 'product-detail', reason: 'upstream' })

    expect(error).toHaveBeenCalledTimes(1)
  })
})
