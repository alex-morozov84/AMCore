import { fakeJobs } from '../../schedule/scheduled-job.test-support'

import type { AiRunDispatchService } from './ai-run-dispatch.service'
import { AiRunRecoveryService } from './ai-run-recovery.service'

/**
 * Unit tests for the AI run recovery cron (Track C — ADR-054, Arc C.4). It drives a full dispatch
 * cycle every tick and must never let a rejection escape (the next tick retries).
 */
describe('AiRunRecoveryService', () => {
  let dispatch: { runDispatchCycle: jest.Mock }
  let service: AiRunRecoveryService
  let scheduled: ReturnType<typeof fakeJobs>
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    dispatch = {
      runDispatchCycle: jest.fn().mockResolvedValue({ status: 'completed', isolatedFailures: 0 }),
    }
    scheduled = fakeJobs()
    service = new AiRunRecoveryService(
      dispatch as unknown as AiRunDispatchService,
      scheduled.jobs,
      logger as never
    )
  })

  it('runs a full dispatch cycle each tick', async () => {
    await service.recover()
    expect(dispatch.runDispatchCycle).toHaveBeenCalledTimes(1)
    expect(scheduled.results).toEqual([{ outcome: 'success' }])
  })

  it('records a pass with every lane taken as a skip, never as a success', async () => {
    dispatch.runDispatchCycle.mockResolvedValue({ status: 'busy', isolatedFailures: 0 })
    await service.recover()
    expect(scheduled.results).toEqual([{ skipped: 'busy' }])
  })

  it('records a degraded diagnosis as an isolated failure of a completed pass', async () => {
    dispatch.runDispatchCycle.mockResolvedValue({ status: 'completed', isolatedFailures: 1 })
    await service.recover()
    expect(scheduled.results[0]).toEqual(expect.objectContaining({ outcome: 'partial' }))
  })

  it('swallows a cycle failure so the cron never throws', async () => {
    dispatch.runDispatchCycle.mockRejectedValue(new Error('boom'))
    await expect(service.recover()).resolves.toBeUndefined()
    expect(scheduled.results[0]).toEqual({ outcome: 'failed', code: 'unexpected' })
    expect(logger.error).toHaveBeenCalled()
  })
})
