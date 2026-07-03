import type { AiRunSseEvent } from '@amcore/shared'

import { AiRunRealtimeHub } from './ai-run-realtime.hub'
import type { StreamWritable } from './ai-run-stream.connection'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'

/**
 * Unit tests for the AI run realtime hub (Track C — ADR-054, Arc C.5): routing by (runId, owner),
 * the global + per-user caps, and exact gauge/count balancing on unregister.
 */

function fakeRes() {
  const res = {
    write: jest.fn(() => true),
    end: jest.fn(),
    destroy: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
  }
  return { res: res as unknown as StreamWritable, raw: res }
}

function event(over: Partial<AiRunSseEvent> = {}): AiRunSseEvent {
  return { eventId: 'e1', runId: 'run-1', status: 'completed', reason: 'status_changed', ...over }
}

const ENV: Record<string, number> = {
  AI_REALTIME_MAX_CONNECTIONS: 3,
  AI_REALTIME_MAX_PER_USER: 2,
  AI_REALTIME_HEARTBEAT_MS: 20000,
  AI_REALTIME_QUEUE_DEPTH: 16,
}

function makeHub() {
  const env = { get: (k: string) => ENV[k] } as unknown as EnvService
  const metrics = {
    incAiRunRealtimeConnections: jest.fn(),
    decAiRunRealtimeConnections: jest.fn(),
    incAiRunRealtimeEvent: jest.fn(),
  }
  return { hub: new AiRunRealtimeHub(env, metrics as unknown as MetricsService), metrics }
}

describe('AiRunRealtimeHub', () => {
  it('routes an event only to streams of the matching run owned by the recipient', () => {
    const { hub } = makeHub()
    const a = fakeRes()
    hub.register(a.res, 'u1', 'run-1', 60000)
    hub.register(fakeRes().res, 'u1', 'run-2', 60000)

    const delivered = hub.routeToRun('run-1', 'u1', event({ runId: 'run-1' }))
    expect(delivered).toBe(1)
    expect(a.raw.write).toHaveBeenCalled()
  })

  it('does not deliver to a stream whose owner differs from the envelope recipient (defence in depth)', () => {
    const { hub } = makeHub()
    hub.register(fakeRes().res, 'u1', 'run-1', 60000)
    // Same runId but a different claimed recipient — must not fan out.
    const delivered = hub.routeToRun('run-1', 'someone-else', event())
    expect(delivered).toBe(0)
  })

  it('returns 0 when no local stream watches the run', () => {
    const { hub } = makeHub()
    expect(hub.routeToRun('run-x', 'u1', event({ runId: 'run-x' }))).toBe(0)
  })

  it('enforces the per-user cap', () => {
    const { hub } = makeHub()
    expect(hub.register(fakeRes().res, 'u1', 'run-1', 60000).ok).toBe(true)
    expect(hub.register(fakeRes().res, 'u1', 'run-2', 60000).ok).toBe(true)
    const third = hub.register(fakeRes().res, 'u1', 'run-3', 60000)
    expect(third).toEqual({ ok: false, reason: 'user' })
  })

  it('enforces the global cap across users', () => {
    const { hub } = makeHub()
    hub.register(fakeRes().res, 'u1', 'run-1', 60000)
    hub.register(fakeRes().res, 'u1', 'run-2', 60000)
    hub.register(fakeRes().res, 'u2', 'run-3', 60000)
    const overflow = hub.register(fakeRes().res, 'u3', 'run-4', 60000)
    expect(overflow).toEqual({ ok: false, reason: 'global' })
  })

  it('frees a user + global slot when a stream closes, and balances the gauge once', () => {
    const { hub, metrics } = makeHub()
    const a = hub.register(fakeRes().res, 'u1', 'run-1', 60000)
    hub.register(fakeRes().res, 'u1', 'run-2', 60000)
    if (!a.ok) throw new Error('expected admission')

    a.connection.close('client')
    a.connection.close('client') // idempotent

    expect(metrics.decAiRunRealtimeConnections).toHaveBeenCalledTimes(1)
    // The freed per-user slot is reusable.
    expect(hub.register(fakeRes().res, 'u1', 'run-3', 60000).ok).toBe(true)
  })

  it('closeAll gracefully closes every open stream', () => {
    const { hub } = makeHub()
    const a = fakeRes()
    const b = fakeRes()
    hub.register(a.res, 'u1', 'run-1', 60000)
    hub.register(b.res, 'u2', 'run-2', 60000)
    hub.closeAll()
    expect(a.raw.end).toHaveBeenCalled()
    expect(b.raw.end).toHaveBeenCalled()
  })
})
