import type { PinoLogger } from 'nestjs-pino'

import { AiRunRealtimePublisher } from './ai-run-realtime.publisher'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'
import type { AppRedisClient } from '@/infrastructure/redis'

/**
 * Unit tests for the AI run realtime publisher (Track C — ADR-054, Arc C.5): a content-free bounded
 * envelope, the composed channel, the in-flight budget, and never throwing on a Redis failure.
 */

interface Harness {
  publisher: AiRunRealtimePublisher
  publish: jest.Mock
  metrics: { incAiRunRealtimePublish: jest.Mock }
  logger: { warn: jest.Mock }
}

function build(maxInFlight = 1000, publishImpl?: jest.Mock): Harness {
  const publish = publishImpl ?? jest.fn().mockResolvedValue(1)
  const redis = {
    withCommandOptions: jest.fn().mockReturnValue({ publish }),
  } as unknown as AppRedisClient

  const envValues: Record<string, unknown> = {
    NODE_ENV: 'test',
    AI_REALTIME_NAMESPACE: '',
    AI_REALTIME_PUBLISH_TIMEOUT_MS: 1000,
    AI_REALTIME_MAX_INFLIGHT_PUBLISH: maxInFlight,
  }
  const env = { get: jest.fn((key: string) => envValues[key]) } as unknown as EnvService
  const metrics = { incAiRunRealtimePublish: jest.fn() }
  const logger = { setContext: jest.fn(), warn: jest.fn() }

  const publisher = new AiRunRealtimePublisher(
    redis,
    env,
    metrics as unknown as MetricsService,
    logger as unknown as PinoLogger
  )
  return { publisher, publish, metrics, logger }
}

describe('AiRunRealtimePublisher', () => {
  it('publishes a content-free bounded envelope to the composed channel and counts published', async () => {
    const { publisher, publish, metrics } = build()

    await publisher.publish('user-cuid', 'run-1', 'completed', 'status_changed')

    expect(publish).toHaveBeenCalledTimes(1)
    const [channel, message] = publish.mock.calls[0] as [string, string]
    expect(channel).toBe('test:ai:run:rt:v1')
    const parsed = JSON.parse(message)
    expect(parsed).toMatchObject({
      v: 1,
      recipientUserId: 'user-cuid',
      runId: 'run-1',
      status: 'completed',
      reason: 'status_changed',
    })
    expect(typeof parsed.eventId).toBe('string')
    // Content-free: only the routing + status fields ride the envelope, nothing else.
    expect(Object.keys(parsed).sort()).toEqual([
      'eventId',
      'reason',
      'recipientUserId',
      'runId',
      'status',
      'v',
    ])
    expect(metrics.incAiRunRealtimePublish).toHaveBeenCalledWith('published')
  })

  it('swallows a publish failure into a warn + failed metric (never throws)', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('redis down'))
    const { publisher, metrics, logger } = build(1000, failing)

    await expect(
      publisher.publish('user-cuid', 'run-1', 'failed', 'status_changed')
    ).resolves.toBeUndefined()

    expect(metrics.incAiRunRealtimePublish).toHaveBeenCalledWith('failed')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('drops a publish once the in-flight budget is exhausted', async () => {
    let release!: () => void
    const hanging = jest
      .fn()
      .mockImplementationOnce(() => new Promise<number>((resolve) => (release = () => resolve(1))))
    const { publisher, metrics } = build(1, hanging)

    const pending = publisher.publish('user-cuid', 'run-1', 'running', 'status_changed')
    await publisher.publish('user-cuid', 'run-1', 'running', 'status_changed')

    expect(hanging).toHaveBeenCalledTimes(1)
    expect(metrics.incAiRunRealtimePublish).toHaveBeenCalledWith('dropped')

    release()
    await pending
    expect(metrics.incAiRunRealtimePublish).toHaveBeenCalledWith('published')
  })
})
