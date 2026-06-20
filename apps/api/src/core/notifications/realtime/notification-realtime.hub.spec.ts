import { NotificationRealtimeHub } from './notification-realtime.hub'
import type { StreamWritable } from './notification-stream.connection'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'

function fakeRes(writable = { value: true }) {
  const writes: string[] = []
  const res = {
    write: jest.fn((chunk: string) => {
      writes.push(chunk)
      return writable.value
    }),
    end: jest.fn(),
    destroy: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
  }
  return { res: res as unknown as StreamWritable, writes, writable }
}

function makeHub(overrides: Record<string, number> = {}) {
  const values: Record<string, number> = {
    NOTIFICATIONS_REALTIME_MAX_CONNECTIONS: 100,
    NOTIFICATIONS_REALTIME_MAX_PER_USER: 5,
    NOTIFICATIONS_REALTIME_HEARTBEAT_MS: 20000,
    NOTIFICATIONS_REALTIME_QUEUE_DEPTH: 16,
    ...overrides,
  }
  const env = { get: jest.fn((key: string) => values[key]) } as unknown as EnvService
  const metrics = {
    incNotificationRealtimeConnections: jest.fn(),
    decNotificationRealtimeConnections: jest.fn(),
    incNotificationRealtimeEvent: jest.fn(),
  }
  const hub = new NotificationRealtimeHub(env, metrics as unknown as MetricsService)
  tracked.push(hub)
  return { hub, metrics }
}

const tracked: NotificationRealtimeHub[] = []
const SSE = { eventId: 'evt-1', reason: 'created', notificationId: 'n1' } as const

describe('NotificationRealtimeHub', () => {
  afterEach(() => {
    for (const hub of tracked) hub.closeAll()
    tracked.length = 0
  })

  it('registers a stream, counts it, and routes a hint to it', () => {
    const { hub, metrics } = makeHub()
    const f = fakeRes()

    const result = hub.register(f.res, 'user-1', 60000)
    expect(result.ok).toBe(true)
    expect(metrics.incNotificationRealtimeConnections).toHaveBeenCalledTimes(1)

    const delivered = hub.routeToUser('user-1', SSE)
    expect(delivered).toBe(1)
    expect(f.writes).toContain(`data: ${JSON.stringify(SSE)}\n\n`)
  })

  it('rejects past the per-user cap with reason user', () => {
    const { hub } = makeHub({ NOTIFICATIONS_REALTIME_MAX_PER_USER: 1 })
    hub.register(fakeRes().res, 'user-1', 60000)

    expect(hub.register(fakeRes().res, 'user-1', 60000)).toEqual({ ok: false, reason: 'user' })
  })

  it('rejects past the global cap with reason global', () => {
    const { hub } = makeHub({ NOTIFICATIONS_REALTIME_MAX_CONNECTIONS: 1 })
    hub.register(fakeRes().res, 'user-1', 60000)

    expect(hub.register(fakeRes().res, 'user-2', 60000)).toEqual({ ok: false, reason: 'global' })
  })

  it('does not route one user’s hint to another user’s stream', () => {
    const { hub } = makeHub()
    const other = fakeRes()
    hub.register(other.res, 'user-2', 60000)

    expect(hub.routeToUser('user-1', SSE)).toBe(0)
    expect(other.writes).not.toContain(`data: ${JSON.stringify(SSE)}\n\n`)
  })

  it('balances the gauge and forgets the stream when it closes', () => {
    const { hub, metrics } = makeHub()
    const result = hub.register(fakeRes().res, 'user-1', 60000)
    if (!result.ok) throw new Error('expected ok')

    result.connection.close('client')

    expect(metrics.decNotificationRealtimeConnections).toHaveBeenCalledTimes(1)
    expect(hub.routeToUser('user-1', SSE)).toBe(0) // removed from the registry
  })

  it('counts a slow-consumer overflow close', () => {
    const { hub, metrics } = makeHub({ NOTIFICATIONS_REALTIME_QUEUE_DEPTH: 1 })
    const f = fakeRes()
    const result = hub.register(f.res, 'user-1', 60000)
    if (!result.ok) throw new Error('expected ok')
    result.connection.open()

    f.writable.value = false
    result.connection.sendData(SSE) // backpressured
    result.connection.sendData(SSE) // queued
    result.connection.sendData(SSE) // overflow → close('overflow')

    expect(metrics.incNotificationRealtimeEvent).toHaveBeenCalledWith('slow_close')
    expect(metrics.decNotificationRealtimeConnections).toHaveBeenCalledTimes(1)
  })

  it('closeAll ends every stream and empties the registry', () => {
    const { hub, metrics } = makeHub()
    const a = fakeRes()
    const b = fakeRes()
    hub.register(a.res, 'user-1', 60000)
    hub.register(b.res, 'user-2', 60000)

    hub.closeAll()

    expect(metrics.decNotificationRealtimeConnections).toHaveBeenCalledTimes(2)
    expect(hub.routeToUser('user-1', SSE)).toBe(0)
    expect(hub.routeToUser('user-2', SSE)).toBe(0)
  })

  it('runs a single heartbeat scheduler that ticks open streams', () => {
    jest.useFakeTimers()
    try {
      const { hub } = makeHub({ NOTIFICATIONS_REALTIME_HEARTBEAT_MS: 1000 })
      const f = fakeRes()
      const result = hub.register(f.res, 'user-1', 60000)
      if (!result.ok) throw new Error('expected ok')
      result.connection.open()

      jest.advanceTimersByTime(1000)
      expect(f.writes).toContain(': hb\n\n')

      hub.closeAll()
    } finally {
      jest.useRealTimers()
    }
  })
})
