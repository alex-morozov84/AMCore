import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import { fakeJobs } from '../../../infrastructure/schedule/scheduled-job.test-support'

import { NotificationDispatchService } from './notification-dispatch.service'
import { NotificationRecoveryService } from './notification-recovery.service'

describe('NotificationRecoveryService', () => {
  let dispatch: DeepMockProxy<NotificationDispatchService>
  let logger: DeepMockProxy<PinoLogger>
  let service: NotificationRecoveryService
  let scheduled: ReturnType<typeof fakeJobs>

  beforeEach(() => {
    dispatch = mockDeep<NotificationDispatchService>()
    logger = mockDeep<PinoLogger>()
    scheduled = fakeJobs()
    dispatch.runDispatchCycle.mockResolvedValue({ status: 'completed', isolatedFailures: 0 })
    service = new NotificationRecoveryService(dispatch, scheduled.jobs, logger)
  })

  it('runs a full dispatch cycle (reap + drain) on each tick', async () => {
    await service.recover()
    expect(dispatch.runDispatchCycle).toHaveBeenCalledTimes(1)
    expect(scheduled.results).toEqual([{ outcome: 'success' }])
  })

  it.each([
    ['not_ready', { skipped: 'not_ready' }],
    ['shutdown', { skipped: 'shutdown' }],
    ['busy', { skipped: 'busy' }],
  ] as const)('records a %s pass as a skip, never as a success', async (status, expected) => {
    dispatch.runDispatchCycle.mockResolvedValue({ status, isolatedFailures: 0 })
    await service.recover()
    expect(scheduled.results).toEqual([expected])
  })

  it('records a pass whose lanes caught an error as partial', async () => {
    dispatch.runDispatchCycle.mockResolvedValue({ status: 'completed', isolatedFailures: 2 })
    await service.recover()
    expect(scheduled.results[0]).toEqual(
      expect.objectContaining({ outcome: 'partial', code: 'isolated_failure' })
    )
  })

  it('never lets a cycle error escape the cron (logs and returns)', async () => {
    dispatch.runDispatchCycle.mockRejectedValue(new Error('db down'))
    await expect(service.recover()).resolves.toBeUndefined()
    expect(scheduled.results[0]).toEqual({ outcome: 'failed', code: 'unexpected' })
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notification.recovery_failed' }),
      expect.any(String)
    )
  })
})
