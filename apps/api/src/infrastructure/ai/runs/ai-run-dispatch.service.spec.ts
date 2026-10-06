import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import { AI_RUN_MAX_DRAIN_CYCLES } from './ai-run.constants'
import type { AiRunRepository } from './ai-run.repository'
import { AiRunDispatchService } from './ai-run-dispatch.service'
import type { ClaimedRun } from './ai-run-dispatch.types'
import type { AiRunExecutorService } from './ai-run-executor.service'
import { AiRunCapacityGate, AiRunShutdownLatch } from './ai-run-shutdown'

import type { AttemptRuntime } from '@/infrastructure/worker-lifecycle'
import type { PrismaService } from '@/prisma'

/**
 * Unit tests for the AI run dispatcher (Track C — ADR-054, ADR-052 pattern): the reap + lane-drain loop that
 * both the wake job and the recovery cron drive, under one per-process capacity gate and one shutdown latch.
 * It owns no provider I/O; each lane claims ONE run and hands it to the executor with an attempt runtime.
 */

function claim(id: string): ClaimedRun {
  return {
    id,
    conversationId: 'conv-1',
    modelSnapshot: { modelSlug: 'm' },
    epoch: 1,
    attemptNumber: 1,
    maxAttempts: 3,
    deadlineAt: null,
    ownershipGeneration: 0,
    leaseToken: 'lease',
  }
}

/** A controllable promise standing for a physical provider/tool call. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('AiRunDispatchService', () => {
  let repository: DeepMockProxy<AiRunRepository>
  let prisma: { registerShutdownBarrier: jest.Mock }
  let executor: { execute: jest.Mock }
  let latch: AiRunShutdownLatch
  let gate: AiRunCapacityGate
  let service: AiRunDispatchService
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  function build(capacity = 2): void {
    latch = new AiRunShutdownLatch(logger as unknown as PinoLogger)
    gate = new AiRunCapacityGate(latch, capacity)
    service = new AiRunDispatchService(
      prisma as unknown as PrismaService,
      repository,
      executor as unknown as AiRunExecutorService,
      latch,
      gate,
      logger as never
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    repository = mockDeep<AiRunRepository>()
    prisma = { registerShutdownBarrier: jest.fn() }
    executor = { execute: jest.fn().mockResolvedValue(undefined) }
    repository.reapExpiredLeases.mockResolvedValue({ rescheduled: 0, failed: 0 })
    repository.expireDeadlinedRuns.mockResolvedValue(0)
    repository.failEpochCappedRuns.mockResolvedValue(0)
    build()
  })

  describe('drainDueBatches', () => {
    it('claims ONE run per lane (never a batch) and executes it with an attempt runtime', async () => {
      repository.claimDueBatch
        .mockResolvedValueOnce([claim('run-1')])
        .mockResolvedValueOnce([claim('run-2')])
        .mockResolvedValue([])

      await service.drainDueBatches()

      expect(repository.claimDueBatch).toHaveBeenCalledWith(1)
      expect(executor.execute).toHaveBeenCalledTimes(2)
      const [, runtime] = executor.execute.mock.calls[0] as [ClaimedRun, AttemptRuntime]
      expect(runtime.attempt.signal).toBeInstanceOf(AbortSignal)
      expect(gate.free).toBe(2) // every slot is released once the lanes are done
    })

    it('a tail run is never claimed while its lane is busy (its lease cannot age in a batch)', async () => {
      const slow = deferred()
      executor.execute.mockImplementationOnce(() => slow.promise)
      repository.claimDueBatch
        .mockResolvedValueOnce([claim('run-1')])
        .mockResolvedValueOnce([claim('run-2')])
        .mockResolvedValueOnce([claim('run-3')])
        .mockResolvedValue([])
      build(1) // one lane
      executor.execute.mockImplementationOnce(() => slow.promise)

      const drain = service.drainDueBatches()
      await new Promise((resolve) => setImmediate(resolve))

      // Only the first run was claimed: the others stay QUEUED with zero attempts until a lane frees up.
      expect(repository.claimDueBatch).toHaveBeenCalledTimes(1)
      slow.resolve()
      await drain
      expect(repository.claimDueBatch.mock.calls.length).toBeGreaterThan(1)
    })

    it('shares ONE capacity gate between overlapping drains (wake + cron never exceed the cap)', async () => {
      const held = deferred()
      executor.execute.mockImplementation(() => held.promise)
      repository.claimDueBatch.mockImplementation(async () => [claim(`run-${Math.random()}`)])

      const first = service.drainDueBatches() // takes both lanes
      await new Promise((resolve) => setImmediate(resolve))
      await service.drainDueBatches() // gate full: reserves nothing, requests a rescan

      expect(executor.execute).toHaveBeenCalledTimes(2)
      repository.claimDueBatch.mockResolvedValue([])
      held.resolve()
      await first
      expect(gate.free).toBe(2)
    })

    it('holds the slot for a later pending tool after the provider settled and the lane finished', async () => {
      const physical = deferred()
      executor.execute.mockImplementationOnce(
        async (_claim: ClaimedRun, runtime: AttemptRuntime) => {
          runtime.onTransportStarted(Promise.resolve())
          await runtime.whenSettled()
          runtime.onTransportStarted(physical.promise) // a call the adapter keeps running after we gave up
        }
      )
      repository.claimDueBatch.mockResolvedValueOnce([claim('run-1')]).mockResolvedValue([])
      build(1)
      executor.execute.mockImplementationOnce(
        async (_claim: ClaimedRun, runtime: AttemptRuntime) => {
          runtime.onTransportStarted(Promise.resolve())
          await runtime.whenSettled()
          runtime.onTransportStarted(physical.promise)
        }
      )

      await service.drainDueBatches()
      expect(gate.free).toBe(0) // lane work is done, the call is not: the slot is NOT released

      physical.resolve()
      await new Promise((resolve) => setImmediate(resolve))
      expect(gate.free).toBe(1)
    })

    it('a failing executor neither rejects the drain nor strands a reservation', async () => {
      executor.execute.mockRejectedValue(new Error('boom'))
      repository.claimDueBatch.mockResolvedValueOnce([claim('run-1')]).mockResolvedValue([])

      await expect(service.drainDueBatches()).resolves.toBeUndefined()

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'ai.run.lane_failed' }),
        expect.any(String)
      )
      expect(gate.free).toBe(2)
    })

    it('bounds one drain by the shared run budget', async () => {
      repository.claimDueBatch.mockImplementation(async () => [claim(`run-${Math.random()}`)])

      await service.drainDueBatches()

      expect(executor.execute).toHaveBeenCalledTimes(AI_RUN_MAX_DRAIN_CYCLES * 2)
    })

    it('returns immediately when nothing is due', async () => {
      repository.claimDueBatch.mockResolvedValue([])
      await service.drainDueBatches()
      expect(executor.execute).not.toHaveBeenCalled()
    })

    it('starts nothing once the dispatcher is closed', async () => {
      latch.close()
      await service.drainDueBatches()
      expect(repository.claimDueBatch).not.toHaveBeenCalled()
    })
  })

  describe('runDispatchCycle', () => {
    it('reaps expired leases, overdue runs and over-attempted runs before draining', async () => {
      repository.claimDueBatch.mockResolvedValue([])
      await service.runDispatchCycle()
      expect(repository.reapExpiredLeases).toHaveBeenCalledTimes(1)
      expect(repository.expireDeadlinedRuns).toHaveBeenCalledTimes(1)
      expect(repository.failEpochCappedRuns).toHaveBeenCalledTimes(1)
      expect(repository.claimDueBatch).toHaveBeenCalled()
    })

    it('a reaper resumed after the seal starts NO later sweep (each sweep is its own bounded operation)', async () => {
      const first = deferred()
      repository.reapExpiredLeases.mockImplementation(async () => {
        await first.promise
        return { rescheduled: 1, failed: 0 }
      })

      const reap = service.reap()
      await new Promise((resolve) => setImmediate(resolve))
      await service.shutdown() // closes, then seals: the first sweep is still pending
      first.resolve()
      await reap

      expect(repository.reapExpiredLeases).toHaveBeenCalledTimes(1)
      expect(repository.expireDeadlinedRuns).not.toHaveBeenCalled()
      expect(repository.failEpochCappedRuns).not.toHaveBeenCalled()
    })

    it('a close between two sweeps stops the remaining sweeps', async () => {
      repository.reapExpiredLeases.mockImplementation(async () => {
        latch.close() // shutdown starts while the first sweep is running
        return { rescheduled: 0, failed: 0 }
      })

      await service.reap()

      expect(repository.expireDeadlinedRuns).not.toHaveBeenCalled()
      expect(repository.failEpochCappedRuns).not.toHaveBeenCalled()
    })

    it('does nothing once closed (no reap, no drain)', async () => {
      latch.close()
      await service.runDispatchCycle()
      expect(repository.reapExpiredLeases).not.toHaveBeenCalled()
      expect(repository.claimDueBatch).not.toHaveBeenCalled()
    })
  })

  describe('shutdown', () => {
    it('registers a bounded barrier BEFORE the database is torn down', () => {
      service.onModuleInit()
      expect(prisma.registerShutdownBarrier).toHaveBeenCalledTimes(1)
    })

    it('closes, waits for active lanes, then seals; repeated calls share one deadline', async () => {
      const slow = deferred()
      executor.execute.mockImplementationOnce(() => slow.promise)
      repository.claimDueBatch.mockResolvedValueOnce([claim('run-1')]).mockResolvedValue([])
      const drain = service.drainDueBatches()
      await new Promise((resolve) => setImmediate(resolve))

      const first = service.shutdown()
      const second = service.shutdown()
      expect(second).toBe(first)
      expect(latch.closed).toBe(true)
      expect(latch.sealed).toBe(false) // lane work still in flight inside the grace

      slow.resolve()
      await first
      await drain
      expect(latch.sealed).toBe(true)
    })

    it('seals at the grace deadline even if a lane never settles, and aborts its attempt signal', async () => {
      jest.useFakeTimers()
      try {
        const never = new Promise<void>(() => undefined)
        let signal: AbortSignal | undefined
        executor.execute.mockImplementationOnce((_claim: ClaimedRun, runtime: AttemptRuntime) => {
          signal = runtime.attempt.signal
          return never
        })
        repository.claimDueBatch.mockResolvedValueOnce([claim('run-1')]).mockResolvedValue([])
        service.shutdownGraceMs = 50
        void service.drainDueBatches()
        await jest.advanceTimersByTimeAsync(0)

        const shutdown = service.shutdown()
        await jest.advanceTimersByTimeAsync(60)
        await shutdown

        expect(latch.sealed).toBe(true)
        expect(signal?.aborted).toBe(true)
      } finally {
        jest.useRealTimers()
      }
    })
  })
})
