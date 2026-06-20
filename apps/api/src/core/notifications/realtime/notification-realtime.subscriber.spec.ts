import type { PinoLogger } from 'nestjs-pino'

import type { NotificationRealtimeHub } from './notification-realtime.hub'
import { NotificationRealtimeSubscriber } from './notification-realtime.subscriber'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'
import type { AppRedisClient } from '@/infrastructure/redis'

function makeSubscriber(opts: { isReady?: boolean; delivered?: number } = {}) {
  const calls: string[] = []
  const handlers: Record<string, (arg?: unknown) => void> = {}
  let onMessage: ((message: string) => void) | undefined
  const sub = {
    on: jest.fn((event: string, handler: (arg?: unknown) => void) => {
      calls.push(`on:${event}`)
      handlers[event] = handler
    }),
    connect: jest.fn(async () => void calls.push('connect')),
    subscribe: jest.fn(async (_channel: string, listener: (m: string) => void) => {
      calls.push('subscribe')
      onMessage = listener
    }),
    unsubscribe: jest.fn(async () => void calls.push('unsubscribe')),
    close: jest.fn(async () => void calls.push('close')),
    destroy: jest.fn(() => calls.push('destroy')),
    isReady: opts.isReady ?? true,
  }
  const redis = { duplicate: jest.fn(() => sub) } as unknown as AppRedisClient
  const vals: Record<string, string> = { NODE_ENV: 'test', NOTIFICATIONS_REALTIME_NAMESPACE: '' }
  const env = { get: jest.fn((k: string) => vals[k]) } as unknown as EnvService
  const hub = { routeToUser: jest.fn().mockReturnValue(opts.delivered ?? 1) }
  const metrics = { incNotificationRealtimeEvent: jest.fn(), incRedisClientEvent: jest.fn() }
  const logger = { setContext: jest.fn(), error: jest.fn() }
  const subscriber = new NotificationRealtimeSubscriber(
    redis,
    env,
    hub as unknown as NotificationRealtimeHub,
    metrics as unknown as MetricsService,
    logger as unknown as PinoLogger
  )
  return { subscriber, sub, hub, metrics, calls, handlers, emit: (m: string) => onMessage?.(m) }
}

const VALID = JSON.stringify({
  v: 1,
  recipientUserId: 'user-cuid',
  eventId: 'evt-1',
  reason: 'created',
  notificationId: 'n1',
})

describe('NotificationRealtimeSubscriber — message handling', () => {
  it('routes a valid envelope to the hub and counts received + routed', async () => {
    const { subscriber, hub, metrics, emit } = makeSubscriber({ delivered: 2 })
    await subscriber.onModuleInit()
    emit(VALID)
    expect(hub.routeToUser).toHaveBeenCalledWith('user-cuid', {
      eventId: 'evt-1',
      reason: 'created',
      notificationId: 'n1',
    })
    expect(metrics.incNotificationRealtimeEvent).toHaveBeenCalledWith('received')
    expect(metrics.incNotificationRealtimeEvent).toHaveBeenCalledWith('routed')
  })

  it('counts no_local_target when no local stream holds the user', async () => {
    const { subscriber, metrics, emit } = makeSubscriber({ delivered: 0 })
    await subscriber.onModuleInit()
    emit(VALID)
    expect(metrics.incNotificationRealtimeEvent).toHaveBeenCalledWith('no_local_target')
  })

  it.each([
    ['malformed JSON', 'not json'],
    ['unknown reason', JSON.stringify({ v: 1, recipientUserId: 'u', eventId: 'e', reason: 'no' })],
    [
      'oversized',
      JSON.stringify({ v: 1, recipientUserId: 'u', eventId: 'x'.repeat(600), reason: 'created' }),
    ],
  ])('drops %s as an invalid envelope without routing', async (_label, message) => {
    const { subscriber, hub, metrics, emit } = makeSubscriber()
    await subscriber.onModuleInit()
    emit(message)
    expect(metrics.incNotificationRealtimeEvent).toHaveBeenCalledWith('invalid_envelope')
    expect(hub.routeToUser).not.toHaveBeenCalled()
  })

  it('logs + counts a subscriber error event', async () => {
    const { subscriber, metrics, handlers } = makeSubscriber()
    await subscriber.onModuleInit()
    handlers.error?.(new Error('redis down'))
    expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('notif_subscriber', 'error')
  })
})
