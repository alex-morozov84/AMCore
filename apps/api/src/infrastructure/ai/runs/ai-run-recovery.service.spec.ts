import type { AiRunDispatchService } from './ai-run-dispatch.service'
import { AiRunRecoveryService } from './ai-run-recovery.service'

/**
 * Unit tests for the AI run recovery cron (Track C — ADR-054, Arc C.4). It drives a full dispatch
 * cycle every tick and must never let a rejection escape (the next tick retries).
 */
describe('AiRunRecoveryService', () => {
  let dispatch: { runDispatchCycle: jest.Mock }
  let service: AiRunRecoveryService
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    dispatch = { runDispatchCycle: jest.fn().mockResolvedValue(undefined) }
    service = new AiRunRecoveryService(dispatch as unknown as AiRunDispatchService, logger as never)
  })

  it('runs a full dispatch cycle each tick', async () => {
    await service.recover()
    expect(dispatch.runDispatchCycle).toHaveBeenCalledTimes(1)
  })

  it('swallows a cycle failure so the cron never throws', async () => {
    dispatch.runDispatchCycle.mockRejectedValue(new Error('boom'))
    await expect(service.recover()).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })
})
