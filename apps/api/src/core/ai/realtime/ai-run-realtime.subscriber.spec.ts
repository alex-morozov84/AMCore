import type { PinoLogger } from 'nestjs-pino'

import type { AiRunRealtimeHub } from './ai-run-realtime.hub'
import { AiRunRealtimeSubscriber } from './ai-run-realtime.subscriber'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'
import type { AppRedisClient } from '@/infrastructure/redis'

/**
 * Unit tests for the AI run realtime subscriber (Track C — ADR-054, Arc C.5): byte-guarded + strict
 * parse of the Pub/Sub envelope, routing by (runId, recipientUserId), and subscriber observability.
 */

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
  const vals: Record<string, string> = { NODE_ENV: 'test', AI_REALTIME_NAMESPACE: '' }
  const env = { get: jest.fn((k: string) => vals[k]) } as unknown as EnvService
  const hub = { routeToRun: jest.fn().mockReturnValue(opts.delivered ?? 1) }
  const metrics = { incAiRunRealtimeEvent: jest.fn(), incRedisClientEvent: jest.fn() }
  const logger = { setContext: jest.fn(), error: jest.fn() }
  const subscriber = new AiRunRealtimeSubscriber(
    redis,
    env,
    hub as unknown as AiRunRealtimeHub,
    metrics as unknown as MetricsService,
    logger as unknown as PinoLogger
  )
  return { subscriber, sub, hub, metrics, calls, handlers, emit: (m: string) => onMessage?.(m) }
}

const VALID = JSON.stringify({
  v: 1,
  recipientUserId: 'user-cuid',
  eventId: 'evt-1',
  runId: 'run-1',
  status: 'completed',
  reason: 'status_changed',
})

describe('AiRunRealtimeSubscriber — message handling', () => {
  it('routes a valid envelope to the hub by (runId, owner) and counts received + routed', async () => {
    const { subscriber, hub, metrics, emit } = makeSubscriber({ delivered: 1 })
    await subscriber.onModuleInit()
    emit(VALID)
    expect(hub.routeToRun).toHaveBeenCalledWith('run-1', 'user-cuid', {
      eventId: 'evt-1',
      runId: 'run-1',
      status: 'completed',
      reason: 'status_changed',
    })
    expect(metrics.incAiRunRealtimeEvent).toHaveBeenCalledWith('received')
    expect(metrics.incAiRunRealtimeEvent).toHaveBeenCalledWith('routed')
  })

  it('counts no_local_target when no local stream holds the run', async () => {
    const { subscriber, metrics, emit } = makeSubscriber({ delivered: 0 })
    await subscriber.onModuleInit()
    emit(VALID)
    expect(metrics.incAiRunRealtimeEvent).toHaveBeenCalledWith('no_local_target')
  })

  it.each([
    ['malformed JSON', 'not json'],
    [
      'unknown status',
      JSON.stringify({
        v: 1,
        recipientUserId: 'u',
        eventId: 'e',
        runId: 'r',
        status: 'nope',
        reason: 'status_changed',
      }),
    ],
    [
      'extra field (strict)',
      JSON.stringify({
        v: 1,
        recipientUserId: 'u',
        eventId: 'e',
        runId: 'r',
        status: 'completed',
        reason: 'status_changed',
        leak: 'x',
      }),
    ],
    [
      'oversized',
      JSON.stringify({
        v: 1,
        recipientUserId: 'u',
        eventId: 'x'.repeat(600),
        runId: 'r',
        status: 'completed',
        reason: 'status_changed',
      }),
    ],
  ])('drops %s as an invalid envelope without routing', async (_label, message) => {
    const { subscriber, hub, metrics, emit } = makeSubscriber()
    await subscriber.onModuleInit()
    emit(message)
    expect(metrics.incAiRunRealtimeEvent).toHaveBeenCalledWith('invalid_envelope')
    expect(hub.routeToRun).not.toHaveBeenCalled()
  })

  it('logs + counts a subscriber error event', async () => {
    const { subscriber, metrics, handlers } = makeSubscriber()
    await subscriber.onModuleInit()
    handlers.error?.(new Error('redis down'))
    expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('ai_run_subscriber', 'error')
  })
})
