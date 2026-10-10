import { performance } from 'node:perf_hooks'

import type { QueuedEmailProvider } from './queued-email-provider'
import {
  type QueuedTransportFence,
  sampleLocalClock,
  sendFrozenQueuedEmail,
} from './queued-email-transport'

describe('queued email actual transport admission', () => {
  const scope = 'a'.repeat(64)
  const fresh = (): QueuedTransportFence => ({
    redisTime: Date.now(),
    pgTime: Date.now(),
    nominalDeadline: Date.now() + 86400000,
    floorUpper: 0,
    beforeEval: sampleLocalClock(),
    beforePg: sampleLocalClock(),
  })
  function provider(transport: jest.Mock): QueuedEmailProvider {
    return {
      provider: 'mock',
      recipeVersion: 1,
      scope: () => scope,
      send: async (body, key, signal, beforeTransport) => {
        beforeTransport()
        return transport(body, key, signal)
      },
    }
  }

  it('refences one stale gate before one transport call with unchanged bytes and key', async () => {
    const transport = jest
      .fn()
      .mockResolvedValue({ certainty: 'accepted', retryable: false, code: 'COMPLETED' })
    const fence = fresh()
    const old = {
      ...fence.beforeEval,
      wall: fence.beforeEval.wall - 2000,
      monotonic: fence.beforeEval.monotonic - 2000,
    }
    const refresh = jest.fn(async () => fresh())
    expect(
      await sendFrozenQueuedEmail(
        provider(transport),
        '{"frozen":true}',
        'email:inc',
        scope,
        { ...fence, beforeEval: old },
        refresh
      )
    ).toMatchObject({ status: 'outcome', outcome: { certainty: 'accepted' } })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledWith('{"frozen":true}', 'email:inc', expect.any(AbortSignal))
  })

  it('makes zero calls after a stale refresh, with no second refresh', async () => {
    const transport = jest.fn()
    const fence = fresh()
    const old = {
      ...fence.beforePg,
      wall: fence.beforePg.wall - 2000,
      monotonic: fence.beforePg.monotonic - 2000,
    }
    const stale = { ...fence, beforePg: old }
    const refresh = jest.fn(async () => stale)
    expect(
      await sendFrozenQueuedEmail(provider(transport), '{}', 'email:inc', scope, stale, refresh)
    ).toEqual({ status: 'not-called', reason: 'CLOCK_UNCERTAIN' })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(transport).not.toHaveBeenCalled()
  })

  it('fails closed on an ambiguous refence without redispatch or transport', async () => {
    const transport = jest.fn()
    const fence = fresh()
    const old = { wall: fence.beforeEval.wall - 2000, monotonic: fence.beforeEval.monotonic - 2000 }
    const refresh = jest.fn().mockRejectedValue(new Error('LOST_FENCE_REPLY'))
    await expect(
      sendFrozenQueuedEmail(
        provider(transport),
        '{}',
        'email:inc',
        scope,
        { ...fence, beforeEval: old },
        refresh
      )
    ).rejects.toThrow('LOST_FENCE_REPLY')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(transport).not.toHaveBeenCalled()
  })

  it('retains unknown after a transport timeout rather than asserting no effect', async () => {
    const transport = jest.fn().mockRejectedValue(new Error('ABORTED_AFTER_ADMISSION'))
    const refresh = jest.fn()
    expect(
      await sendFrozenQueuedEmail(provider(transport), '{}', 'email:inc', scope, fresh(), refresh)
    ).toEqual({
      status: 'outcome',
      outcome: {
        certainty: 'unknown',
        retryable: true,
        code: 'TRANSIENT_FAILURE',
      },
    })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not refence a changed provider scope or send', async () => {
    const transport = jest.fn()
    const changed = { ...provider(transport), scope: () => 'b'.repeat(64) }
    const refresh = jest.fn()
    expect(
      await sendFrozenQueuedEmail(changed, '{}', 'email:inc', scope, fresh(), refresh)
    ).toEqual({ status: 'not-called', reason: 'PROVIDER_CHANGED' })
    expect(transport).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
  it.each([
    { name: 'strict horizon minus 1ms', deadlineGap: 93999, elapsed: 0, called: false },
    { name: 'strict horizon equality', deadlineGap: 94000, elapsed: 0, called: false },
    { name: 'strict horizon plus 1ms', deadlineGap: 94001, elapsed: 0, called: true },
    { name: 'freshness 999ms', deadlineGap: 94001, elapsed: 999, called: true },
    { name: 'freshness 1000ms', deadlineGap: 94001, elapsed: 1000, called: true },
    { name: 'stale 1001ms after refence', deadlineGap: 200000, elapsed: 1001, called: false },
    {
      name: 'floor one millisecond too early',
      deadlineGap: 200000,
      elapsed: 0,
      floorDelta: 1,
      called: false,
    },
    {
      name: 'inclusive floor equality',
      deadlineGap: 200000,
      elapsed: 0,
      floorDelta: 0,
      called: true,
    },
    {
      name: 'floor one millisecond late',
      deadlineGap: 200000,
      elapsed: 0,
      floorDelta: -1,
      called: true,
    },
  ])('checks $name synchronously at the actual transport callback', async (example) => {
    const wall = 10000000
    const date = jest.spyOn(Date, 'now').mockReturnValue(wall)
    const monotonic = jest.spyOn(performance, 'now').mockReturnValue(10000 + example.elapsed)
    try {
      const transport = jest
        .fn()
        .mockResolvedValue({ certainty: 'accepted', retryable: false, code: 'COMPLETED' })
      const gate: QueuedTransportFence = {
        redisTime: wall - example.elapsed,
        pgTime: wall - example.elapsed,
        nominalDeadline: wall + example.deadlineGap,
        floorUpper: example.floorDelta === undefined ? 0 : wall - 2000 + example.floorDelta,
        beforeEval: { wall: wall - example.elapsed, monotonic: 10000 },
        beforePg: { wall: wall - example.elapsed, monotonic: 10000 },
      }
      const refresh = jest.fn(async () => gate)
      const result = await sendFrozenQueuedEmail(
        provider(transport),
        '{"frozen":true}',
        'email:inc',
        scope,
        gate,
        refresh
      )
      expect(transport).toHaveBeenCalledTimes(example.called ? 1 : 0)
      expect(result.status).toBe(example.called ? 'outcome' : 'not-called')
      if (!example.called) return
      {
        // Worst permitted current +2s and initial -2s offsets, then the complete
        // scheduling1s/transport30s allowance still leave the reserved59s margin.
        const latestFinish = wall + 2000 + 1000 + 30000
        const earliestExpiry = gate.nominalDeadline - 2000
        expect(earliestExpiry - latestFinish).toBeGreaterThan(59000)
      }
    } finally {
      date.mockRestore()
      monotonic.mockRestore()
    }
  })

  it('records a local pre-transport capacity refusal without remote uncertainty', async () => {
    const refused: QueuedEmailProvider = {
      provider: 'mock',
      recipeVersion: 1,
      scope: () => scope,
      send: async () => {
        throw new Error('CONTROL_CONNECTION_LIMIT')
      },
    }
    const refresh = jest.fn()
    expect(
      await sendFrozenQueuedEmail(refused, '{}', 'email:inc', scope, fresh(), refresh)
    ).toEqual({ status: 'not-called', reason: 'WORK_UNAVAILABLE' })
    expect(refresh).not.toHaveBeenCalled()
  })
})
