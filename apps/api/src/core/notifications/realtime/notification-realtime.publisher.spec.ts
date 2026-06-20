import type { PinoLogger } from 'nestjs-pino'

import { NotificationRealtimePublisher } from './notification-realtime.publisher'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'
import type { AppRedisClient } from '@/infrastructure/redis'

interface Harness {
  publisher: NotificationRealtimePublisher
  publish: jest.Mock
  metrics: { incNotificationRealtimePublish: jest.Mock }
  logger: { warn: jest.Mock }
}

function build(maxInFlight = 1000, publishImpl?: jest.Mock): Harness {
  const publish = publishImpl ?? jest.fn().mockResolvedValue(1)
  const redis = {
    withCommandOptions: jest.fn().mockReturnValue({ publish }),
  } as unknown as AppRedisClient

  const envValues: Record<string, unknown> = {
    NODE_ENV: 'test',
    NOTIFICATIONS_REALTIME_NAMESPACE: '',
    NOTIFICATIONS_REALTIME_PUBLISH_TIMEOUT_MS: 1000,
    NOTIFICATIONS_REALTIME_MAX_INFLIGHT_PUBLISH: maxInFlight,
  }
  const env = { get: jest.fn((key: string) => envValues[key]) } as unknown as EnvService
  const metrics = { incNotificationRealtimePublish: jest.fn() }
  const logger = { setContext: jest.fn(), warn: jest.fn() }

  const publisher = new NotificationRealtimePublisher(
    redis,
    env,
    metrics as unknown as MetricsService,
    logger as unknown as PinoLogger
  )
  return { publisher, publish, metrics, logger }
}

describe('NotificationRealtimePublisher', () => {
  it('publishes a bounded envelope to the composed channel and counts published', async () => {
    const { publisher, publish, metrics } = build()

    await publisher.publish('user-cuid', 'created', 'ntf-1')

    expect(publish).toHaveBeenCalledTimes(1)
    const [channel, message] = publish.mock.calls[0] as [string, string]
    expect(channel).toBe('test:notif:rt:v1')
    expect(JSON.parse(message)).toMatchObject({
      v: 1,
      recipientUserId: 'user-cuid',
      reason: 'created',
      notificationId: 'ntf-1',
    })
    expect(typeof JSON.parse(message).eventId).toBe('string')
    expect(metrics.incNotificationRealtimePublish).toHaveBeenCalledWith('published')
  })

  it('omits notificationId for an aggregate hint', async () => {
    const { publisher, publish } = build()

    await publisher.publish('user-cuid', 'unread_changed')

    const message = (publish.mock.calls[0] as [string, string])[1]
    expect(JSON.parse(message)).not.toHaveProperty('notificationId')
  })

  it('swallows a publish failure into a warn + failed metric (never throws)', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('redis down'))
    const { publisher, metrics, logger } = build(1000, failing)

    await expect(publisher.publish('user-cuid', 'created')).resolves.toBeUndefined()

    expect(metrics.incNotificationRealtimePublish).toHaveBeenCalledWith('failed')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('drops a publish once the in-flight budget is exhausted', async () => {
    let release!: () => void
    const hanging = jest
      .fn()
      .mockImplementationOnce(() => new Promise<number>((resolve) => (release = () => resolve(1))))
    const { publisher, metrics } = build(1, hanging)

    // First publish occupies the only in-flight slot (still pending).
    const pending = publisher.publish('user-cuid', 'created')
    // Second publish exceeds the budget → dropped without issuing a command.
    await publisher.publish('user-cuid', 'created')

    expect(hanging).toHaveBeenCalledTimes(1)
    expect(metrics.incNotificationRealtimePublish).toHaveBeenCalledWith('dropped')

    release()
    await pending
    expect(metrics.incNotificationRealtimePublish).toHaveBeenCalledWith('published')
  })
})
