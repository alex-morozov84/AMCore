import type { PinoLogger } from 'nestjs-pino'

import { NOTIFICATION_REALTIME_SHUTDOWN_DEADLINE_MS } from './notification-realtime.constants'
import type { NotificationRealtimeHub } from './notification-realtime.hub'
import { NotificationRealtimeSubscriber } from './notification-realtime.subscriber'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'
import type { AppRedisClient } from '@/infrastructure/redis'

// Harness duplicated from the message-handling spec: `jest/no-export` forbids sharing
// it across test files, and a non-spec helper would land in the production build.
function makeSubscriber(opts: { isReady?: boolean } = {}) {
  const calls: string[] = []
  const sub = {
    on: jest.fn((event: string) => void calls.push(`on:${event}`)),
    connect: jest.fn(async () => void calls.push('connect')),
    subscribe: jest.fn(async () => void calls.push('subscribe')),
    unsubscribe: jest.fn(async () => void calls.push('unsubscribe')),
    close: jest.fn(async () => void calls.push('close')),
    destroy: jest.fn(() => calls.push('destroy')),
    isReady: opts.isReady ?? true,
  }
  const redis = { duplicate: jest.fn(() => sub) } as unknown as AppRedisClient
  const vals: Record<string, string> = { NODE_ENV: 'test', NOTIFICATIONS_REALTIME_NAMESPACE: '' }
  const env = { get: jest.fn((k: string) => vals[k]) } as unknown as EnvService
  const hub = { routeToUser: jest.fn().mockReturnValue(1) }
  const metrics = { incNotificationRealtimeEvent: jest.fn(), incRedisClientEvent: jest.fn() }
  const logger = { setContext: jest.fn(), error: jest.fn() }
  const subscriber = new NotificationRealtimeSubscriber(
    redis,
    env,
    hub as unknown as NotificationRealtimeHub,
    metrics as unknown as MetricsService,
    logger as unknown as PinoLogger
  )
  return { subscriber, sub, calls }
}

describe('NotificationRealtimeSubscriber — lifecycle', () => {
  it('attaches error/reconnecting listeners before connecting, then subscribes', async () => {
    const { subscriber, sub, calls } = makeSubscriber()
    await subscriber.onModuleInit()
    expect(sub.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(calls.indexOf('on:error')).toBeLessThan(calls.indexOf('connect'))
    expect(calls.indexOf('on:reconnecting')).toBeLessThan(calls.indexOf('connect'))
    expect(calls.indexOf('connect')).toBeLessThan(calls.indexOf('subscribe'))
  })

  it('destroys the dedicated client and rethrows when connect fails', async () => {
    const { subscriber, sub } = makeSubscriber()
    sub.connect.mockRejectedValueOnce(new Error('no redis'))
    await expect(subscriber.onModuleInit()).rejects.toThrow('no redis')
    expect(sub.destroy).toHaveBeenCalledTimes(1)
    await subscriber.onModuleDestroy() // cleared → no second destroy
    expect(sub.destroy).toHaveBeenCalledTimes(1)
  })

  it('shuts down a healthy subscriber with unsubscribe before close (not destroy)', async () => {
    const { subscriber, sub, calls } = makeSubscriber({ isReady: true })
    await subscriber.onModuleInit()
    await subscriber.onModuleDestroy()
    // unsubscribe must precede close: the ACK empties the queue so close() can finish.
    expect(calls.indexOf('unsubscribe')).toBeLessThan(calls.indexOf('close'))
    expect(sub.destroy).not.toHaveBeenCalled()
  })

  it('force-destroys a not-ready subscriber on shutdown', async () => {
    const { subscriber, sub } = makeSubscriber({ isReady: false })
    await subscriber.onModuleInit()
    await subscriber.onModuleDestroy()
    expect(sub.destroy).toHaveBeenCalled()
    expect(sub.unsubscribe).not.toHaveBeenCalled()
  })

  it('force-destroys when unsubscribe rejects (client still open)', async () => {
    const { subscriber, sub } = makeSubscriber({ isReady: true })
    sub.unsubscribe.mockRejectedValueOnce(new Error('boom'))
    await subscriber.onModuleInit()
    await subscriber.onModuleDestroy()
    expect(sub.destroy).toHaveBeenCalled()
  })

  it('force-destroys after the deadline when unsubscribe hangs', async () => {
    jest.useFakeTimers()
    try {
      const { subscriber, sub } = makeSubscriber({ isReady: true })
      sub.unsubscribe.mockReturnValue(new Promise<undefined>(() => undefined))
      await subscriber.onModuleInit()
      const done = subscriber.onModuleDestroy()
      await jest.advanceTimersByTimeAsync(NOTIFICATION_REALTIME_SHUTDOWN_DEADLINE_MS)
      await done
      expect(sub.destroy).toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })
})
