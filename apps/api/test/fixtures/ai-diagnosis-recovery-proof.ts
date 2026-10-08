import { jest } from '@jest/globals'
import type { PrismaPg } from '@prisma/adapter-pg'
import type { Pool } from 'pg'

import type { Prisma } from '../../src/generated/prisma/client'
import { AiQueuedRestrictionDiagnosis } from '../../src/infrastructure/ai/runs/ai-queued-restriction-diagnosis'
import { AiRunDispatchService } from '../../src/infrastructure/ai/runs/ai-run-dispatch.service'
import { AI_RUN_SHUTDOWN_LATCH } from '../../src/infrastructure/ai/runs/ai-run-shutdown'
import type { ShutdownLatch } from '../../src/infrastructure/worker-lifecycle'
import type { ObservedPgAdapter, PhysicalTransaction } from '../../src/prisma/observed-pg-adapter'
import { ObservedTransactionRunner } from '../../src/prisma/observed-transaction'
import type { E2ETestContext } from '../helpers'

import { consistencyRepository, queuedConsistencyRun } from './ai-consistency-context'
import { controls } from './ai-run-controls'

function barrier(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/** Actual private adapter startup on the main pool; no wake, token reset or anomalous execution. */
export function diagnosisRecoveryProof(getContext: () => E2ETestContext): void {
  it.each(['held', 'quarantine'] as const)(
    'ordinary PG recovery survives %s diagnosis startup and retains its physical token',
    async (failure) => {
      const context = getContext()
      const quarantined = barrier()
      const runner = new ObservedTransactionRunner(
        Reflect.get(context.prisma, 'pool') as Pool,
        quarantined.release
      )
      const originalObserved = context.prisma.observedTransactions.bind(context.prisma)
      const capability = jest
        .spyOn(context.prisma, 'observedTransactions')
        .mockImplementation((name) => (name === 'ai-diagnosis' ? runner : originalObserved(name)))
      const adapter = Reflect.get(runner, 'adapter') as ObservedPgAdapter
      const delegate = Reflect.get(adapter, 'delegate') as PrismaPg
      const originalConnect = delegate.connect.bind(delegate)
      const entered = barrier()
      const releaseStartup = barrier()
      const cleanup = barrier()
      let starts = 0
      let tick = 100_000
      const connect = jest.spyOn(delegate, 'connect').mockImplementation(async () => {
        const actual = await originalConnect()
        return new Proxy(actual, {
          get(target, key) {
            if (key === 'startTransaction')
              return async (level: Parameters<typeof actual.startTransaction>[0]) => {
                starts++
                const tx = await actual.startTransaction(level)
                entered.release()
                await releaseStartup.promise
                if (failure === 'quarantine') {
                  // The delegate is cleaned up, but its failed public startup carries no disposition.
                  await tx.executeRaw({ sql: 'ROLLBACK', args: [], argTypes: [] })
                  await tx.rollback()
                  cleanup.release()
                  throw new Error('fixture uncertain startup sentinel')
                }
                return tx
              }
            const value = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
      })
      const repository = consistencyRepository(context)
      const latch = context.app.get<ShutdownLatch>(AI_RUN_SHUTDOWN_LATCH)
      const diagnosis = new AiQueuedRestrictionDiagnosis(context.prisma, latch)
      const sweep = jest
        .spyOn(repository, 'diagnoseQueuedRestrictions')
        .mockImplementation(async () => {
          // Advance only the diagnosis scheduling clock; catalogue reuse stays on its real clock.
          const clock = jest.spyOn(performance, 'now').mockImplementation(() => tick)
          try {
            return await diagnosis.sweep()
          } finally {
            clock.mockRestore()
          }
        })
      try {
        const restriction = {
          version: 1,
          kind: 'unknown_until',
          observedAt: '2026-10-07T00:00:00.000Z',
          reason: 'overflow',
        }
        const anomalous = await queuedConsistencyRun(context, {
          providerRetryRestriction: restriction as Prisma.InputJsonValue,
        })
        const eligible = await queuedConsistencyRun(context)
        const dispatch = context.app.get(AiRunDispatchService)
        const cycle = dispatch.runDispatchCycle()
        await entered.promise
        const token = Reflect.get(runner, 'active') as PhysicalTransaction
        await cycle // Real Prisma maxWait settles; the held physical startup is still occupied.
        expect(
          (await context.prisma.aiRun.findUniqueOrThrow({ where: { id: eligible.run.id } })).status
        ).toBe('COMPLETED')
        expect(starts).toBe(1)
        expect(token.released).toBe(false)
        tick = 131_001
        const whileHeld = await queuedConsistencyRun(context)
        await dispatch.runDispatchCycle()
        expect(
          (await context.prisma.aiRun.findUniqueOrThrow({ where: { id: whileHeld.run.id } })).status
        ).toBe('COMPLETED')
        expect(starts).toBe(1)
        expect(token.released).toBe(false)
        releaseStartup.release()
        if (failure === 'held') await token.completed
        else {
          await cleanup.promise
          // Observe the actual adapter quarantine callback, not an elapsed-time guess.
          await quarantined.promise
          expect(token.quarantined).toBe(true)
          expect(() => runner.start(async () => undefined)).toThrow(
            'observed_transaction_unavailable'
          )
        }
        if (failure === 'held') expect(token.released).toBe(true)
        else
          for (const nextTick of [162_002, 193_003]) {
            tick = nextTick
            const next = await queuedConsistencyRun(context)
            await dispatch.runDispatchCycle()
            expect(
              (await context.prisma.aiRun.findUniqueOrThrow({ where: { id: next.run.id } })).status
            ).toBe('COMPLETED')
            expect(starts).toBe(1)
          }
        const retained = await context.prisma.aiRun.findUniqueOrThrow({
          where: { id: anomalous.run.id },
          include: { attempts: true, steps: true },
        })
        expect(retained.status).toBe('QUEUED')
        expect(retained.providerRetryRestriction).toEqual(restriction)
        expect(retained.attempts).toHaveLength(0)
        expect(retained.steps).toHaveLength(0)
        expect(controls.providerCalls).toBe(failure === 'held' ? 2 : 4)
        expect(controls.effects).toHaveLength(0)
        expect((await context.prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`)[0]!.ok).toBe(1)
      } finally {
        releaseStartup.release()
        connect.mockRestore()
        sweep.mockRestore()
        capability.mockRestore()
        await runner.disconnect()
      }
    }
  )
}
