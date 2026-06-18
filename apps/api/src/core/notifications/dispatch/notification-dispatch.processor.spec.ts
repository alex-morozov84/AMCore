import type { Job } from 'bullmq'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import { NotificationDispatchProcessor } from './notification-dispatch.processor'
import { NotificationDispatchService } from './notification-dispatch.service'

import type { MetricsService } from '@/infrastructure/observability'
import { JobName } from '@/infrastructure/queue/constants/queues.constant'

const job = (overrides: Partial<Job>): Job =>
  ({ id: 'j1', name: JobName.DISPATCH_DUE, data: {}, ...overrides }) as Job

describe('NotificationDispatchProcessor', () => {
  let dispatch: DeepMockProxy<NotificationDispatchService>
  let logger: DeepMockProxy<PinoLogger>
  let metrics: jest.Mocked<Pick<MetricsService, 'incQueueEvent' | 'incRedisClientEvent'>>
  let processor: NotificationDispatchProcessor

  beforeEach(() => {
    dispatch = mockDeep<NotificationDispatchService>()
    logger = mockDeep<PinoLogger>()
    metrics = { incQueueEvent: jest.fn(), incRedisClientEvent: jest.fn() }
    processor = new NotificationDispatchProcessor(
      dispatch,
      logger,
      metrics as unknown as MetricsService
    )
  })

  it('drains due deliveries for a DISPATCH_DUE job', async () => {
    await processor.process(job({ data: { notificationId: 'n1' } }))
    expect(dispatch.drainDueBatches).toHaveBeenCalledTimes(1)
  })

  it('skips an unknown job type without draining', async () => {
    await processor.process(job({ name: 'something-else' }))
    expect(dispatch.drainDueBatches).not.toHaveBeenCalled()
  })

  it('still drains when the wake payload is malformed (the drain is payload-independent)', async () => {
    await processor.process(job({ data: { notificationId: 42 } as never }))
    expect(dispatch.drainDueBatches).toHaveBeenCalledTimes(1)
  })

  it('emits a dead-letter signal when a wake job fails terminally', () => {
    processor.onFailed(job({}), new Error('drain failed'))
    expect(metrics.incQueueEvent).toHaveBeenCalledWith('notifications', 'dead_letter')
  })

  it('records a worker Redis/connection error', () => {
    processor.onError(new Error('redis down'))
    expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('queue_worker', 'error')
    expect(metrics.incQueueEvent).toHaveBeenCalledWith('notifications', 'worker_error')
  })
})
