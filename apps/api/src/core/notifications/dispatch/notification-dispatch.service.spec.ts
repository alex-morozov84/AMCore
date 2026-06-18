import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { PrismaService } from '../../../prisma'
import { ChannelDelivererRegistry } from '../channels/channel-deliverer.registry'
import type { ChannelDeliverer, DeliveryResult } from '../channels/channel-deliverer.types'
import { NotificationChannel } from '../notification.constants'
import { NOTIFICATION_CLAIM_BATCH_LIMIT } from '../notification-dispatch.constants'

import { NotificationDeliveryRepository } from './notification-delivery.repository'
import { NotificationDispatchService } from './notification-dispatch.service'
import type { ClaimedDelivery } from './notification-dispatch.types'

import type { MetricsService } from '@/infrastructure/observability'

const makeClaim = (id: string): ClaimedDelivery => ({
  id,
  notificationId: `n-${id}`,
  channel: NotificationChannel.EMAIL,
  targetKey: 'user@example.com',
  targetRef: null,
  destinationSnapshot: null,
  locale: 'en',
  attemptNumber: 1,
  maxAttempts: 5,
  leaseToken: 'lease-1',
})

describe('NotificationDispatchService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let repository: DeepMockProxy<NotificationDeliveryRepository>
  let metrics: jest.Mocked<Pick<MetricsService, 'incQueueEvent' | 'incRedisClientEvent'>>
  let logger: DeepMockProxy<PinoLogger>
  let deliver: jest.Mock<Promise<DeliveryResult>>
  let service: NotificationDispatchService

  const buildService = (deliverers: ChannelDeliverer[]): NotificationDispatchService =>
    new NotificationDispatchService(
      prisma,
      repository,
      new ChannelDelivererRegistry(deliverers),
      metrics as unknown as MetricsService,
      logger
    )

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    repository = mockDeep<NotificationDeliveryRepository>()
    metrics = { incQueueEvent: jest.fn(), incRedisClientEvent: jest.fn() }
    logger = mockDeep<PinoLogger>()
    deliver = jest.fn<Promise<DeliveryResult>, [unknown]>()

    prisma.notification.findUnique.mockResolvedValue({ id: 'n-d1', type: 'account.test' } as never)
    repository.finalizeDelivered.mockResolvedValue({ state: 'delivered' })
    repository.finalizeTransient.mockResolvedValue({
      state: 'retry_scheduled',
      nextAttemptAt: new Date(),
    })
    repository.finalizePermanent.mockResolvedValue({
      state: 'failed',
      reasonCode: 'x',
      deadLettered: true,
    })
    repository.reapExpiredLeases.mockResolvedValue({ rescheduled: 0, deadLettered: 0 })

    const deliverer: ChannelDeliverer = { channel: NotificationChannel.EMAIL, deliver }
    service = buildService([deliverer])
  })

  const drainOnce = async (claim: ClaimedDelivery): Promise<void> => {
    repository.claimDueBatch.mockResolvedValueOnce([claim]).mockResolvedValueOnce([])
    await service.drainDueBatches()
  }

  it('routes a delivered result to finalizeDelivered with provider id + duration', async () => {
    deliver.mockResolvedValue({ status: 'delivered', providerMessageId: 'prov-1' })
    await drainOnce(makeClaim('d1'))
    expect(repository.finalizeDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      'prov-1',
      expect.any(Number)
    )
  })

  it('routes a transient result to finalizeTransient', async () => {
    deliver.mockResolvedValue({ status: 'transient', errorCode: 'provider_transient' })
    await drainOnce(makeClaim('d1'))
    expect(repository.finalizeTransient).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      'provider_transient',
      expect.any(Number)
    )
  })

  it('routes a permanent result to finalizePermanent and emits one dead-letter signal', async () => {
    deliver.mockResolvedValue({ status: 'permanent', errorCode: 'provider_permanent' })
    await drainOnce(makeClaim('d1'))
    expect(repository.finalizePermanent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      'provider_permanent',
      expect.any(Number)
    )
    expect(metrics.incQueueEvent).toHaveBeenCalledWith('notifications', 'dead_letter')
  })

  it('treats a thrown deliverer as transient (provider_error), not a crash', async () => {
    deliver.mockRejectedValue(new Error('boom'))
    await drainOnce(makeClaim('d1'))
    expect(repository.finalizeTransient).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      'provider_error',
      expect.any(Number)
    )
  })

  it('fails permanently with no_adapter (and dead-letters) when the channel has no deliverer', async () => {
    const noDelivererService = buildService([]) // empty registry
    repository.claimDueBatch.mockResolvedValueOnce([makeClaim('d1')]).mockResolvedValueOnce([])
    await noDelivererService.drainDueBatches()
    expect(repository.finalizePermanent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      'no_adapter',
      0
    )
    expect(deliver).not.toHaveBeenCalled()
    expect(metrics.incQueueEvent).toHaveBeenCalledWith('notifications', 'dead_letter')
  })

  it('fails permanently with notification_missing when the notification row is gone', async () => {
    prisma.notification.findUnique.mockResolvedValue(null)
    await drainOnce(makeClaim('d1'))
    expect(deliver).not.toHaveBeenCalled()
    expect(repository.finalizePermanent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      'notification_missing',
      0
    )
  })

  it('keeps draining while a batch is full, then stops on a short batch', async () => {
    const fullBatch = Array.from({ length: NOTIFICATION_CLAIM_BATCH_LIMIT }, (_, i) =>
      makeClaim(`f${i}`)
    )
    deliver.mockResolvedValue({ status: 'delivered' })
    repository.claimDueBatch
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([makeClaim('tail')])
      .mockResolvedValueOnce([])
    await service.drainDueBatches()
    expect(repository.claimDueBatch).toHaveBeenCalledTimes(2)
  })

  it('runDispatchCycle reaps expired leases (emitting dead-letters) before draining', async () => {
    repository.reapExpiredLeases.mockResolvedValue({ rescheduled: 1, deadLettered: 2 })
    repository.claimDueBatch.mockResolvedValue([])
    await service.runDispatchCycle()
    expect(repository.reapExpiredLeases).toHaveBeenCalledTimes(1)
    expect(metrics.incQueueEvent).toHaveBeenCalledWith('notifications', 'dead_letter')
    expect(metrics.incQueueEvent).toHaveBeenCalledTimes(2) // one per dead-lettered row
  })
})
