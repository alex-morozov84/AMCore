import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import { NotificationDispatchService } from './notification-dispatch.service'
import { NotificationRecoveryService } from './notification-recovery.service'

describe('NotificationRecoveryService', () => {
  let dispatch: DeepMockProxy<NotificationDispatchService>
  let logger: DeepMockProxy<PinoLogger>
  let service: NotificationRecoveryService

  beforeEach(() => {
    dispatch = mockDeep<NotificationDispatchService>()
    logger = mockDeep<PinoLogger>()
    service = new NotificationRecoveryService(dispatch, logger)
  })

  it('runs a full dispatch cycle (reap + drain) on each tick', async () => {
    await service.recover()
    expect(dispatch.runDispatchCycle).toHaveBeenCalledTimes(1)
  })

  it('never lets a cycle error escape the cron (logs and returns)', async () => {
    dispatch.runDispatchCycle.mockRejectedValue(new Error('db down'))
    await expect(service.recover()).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notification.recovery_failed' }),
      expect.any(String)
    )
  })
})
