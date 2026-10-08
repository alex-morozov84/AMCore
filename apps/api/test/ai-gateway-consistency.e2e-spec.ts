import { jest } from '@jest/globals'

import { EnvService } from '../src/env/env.service'
import { AiRunStatus, Prisma } from '../src/generated/prisma/client'
import { AI_PROVIDER_ADAPTERS } from '../src/infrastructure/ai/gateway/ai-gateway.types'
import { parseProviderRetryHint } from '../src/infrastructure/ai/gateway/providers/provider-retry-hint'
import { AiQueuedRestrictionDiagnosis } from '../src/infrastructure/ai/runs/ai-queued-restriction-diagnosis'
import { AiRunTransitions } from '../src/infrastructure/ai/runs/ai-run-transitions.service'
import { providerRetryRestrictionSchema } from '../src/infrastructure/ai/runs/provider-retry-restriction'
import { MetricsService } from '../src/infrastructure/observability'
import { ShutdownLatch } from '../src/infrastructure/worker-lifecycle'
import { PrismaService } from '../src/prisma/prisma.service'

import { gatewayBindingProof } from './fixtures/ai-binding-proof'
import {
  consistencyRepository,
  queuedConsistencyRun,
  resetConsistencyData,
  stopConsistencyWake,
} from './fixtures/ai-consistency-context'
import { diagnosisHistoryProof } from './fixtures/ai-diagnosis-history-proof'
import { diagnosisRecoveryProof } from './fixtures/ai-diagnosis-recovery-proof'
import { retryClockProof } from './fixtures/ai-retry-clock-proof'
import { ControllableAdapter, controls } from './fixtures/ai-run-controls'
import { sdkAdapters } from './fixtures/ai-sdk-consistency'
import { type E2ETestContext, noopPinoLogger, setupE2ETest, teardownE2ETest } from './helpers'

const observedAt = '2026-10-07T00:00:00.000Z'
const until = (notBefore: string) => ({
  version: 1,
  kind: 'until',
  observedAt,
  notBefore,
  source: 'relative',
})
const unknown = { version: 1, kind: 'unknown_until', observedAt, reason: 'overflow' }
const invalids: unknown[] = [
  unknown,
  { ...unknown, version: 2 },
  [],
  { ...until('bad'), source: 'relative' },
  until('2026-02-31T00:00:00.000Z'),
  { ...unknown, extra: true },
  { ...until('9999-01-01T00:00:00.000Z'), kind: null },
]

describe('AI durable restriction and queued diagnosis (PG)', () => {
  let context: E2ETestContext
  beforeAll(async () => {
    context = await setupE2ETest((builder) =>
      builder
        .overrideProvider(AI_PROVIDER_ADAPTERS)
        .useValue([new ControllableAdapter(), ...sdkAdapters()])
    )
    await stopConsistencyWake(context)
  }, 180000)
  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    controls.reset()
    await resetConsistencyData(context)
  })

  gatewayBindingProof(() => context)
  diagnosisHistoryProof(() => context)
  retryClockProof(() => context)

  function sweep(latch = new ShutdownLatch({ warn: () => undefined }, 'fixture')) {
    return new AiQueuedRestrictionDiagnosis(context.prisma, latch)
  }

  it.each(invalids)(
    'diagnoses non-executable JSON without deadline, lease, history fabrication or external I/O: %j',
    async (restriction) => {
      const { run } = await queuedConsistencyRun(context, {
        deadlineAt: null,
        providerRetryRestriction: restriction as Prisma.InputJsonValue,
      })
      expect(await consistencyRepository(context).claimDueBatch()).toHaveLength(0)
      expect(await sweep().sweep()).toBe(1)
      const settled = await context.prisma.aiRun.findUniqueOrThrow({
        where: { id: run.id },
        include: { steps: true, attempts: true },
      })
      expect(settled.status).toBe(AiRunStatus.FAILED)
      expect(settled.providerRetryRestriction).toEqual(restriction)
      expect(settled.leaseEpoch).toBe(0)
      expect(settled.attempts).toHaveLength(0)
      expect(settled.steps.filter((step) => step.type === 'FINALIZATION')).toHaveLength(1)
      expect(controls.providerCalls).toBe(0)
      expect(controls.effects).toHaveLength(0)
      expect(await sweep().sweep()).toBe(0)
    }
  )

  it.each(['future', 'past', 'cancel', 'takeover'] as const)(
    'uses visible stop precedence with %s deadline/ownership and retains JSON',
    async (variant) => {
      const { run, conversation } = await queuedConsistencyRun(context, {
        providerRetryRestriction: unknown,
        deadlineAt: new Date(Date.now() + (variant === 'future' ? 60000 : -1000)),
      })
      if (variant === 'cancel')
        await context.prisma.aiRun.update({
          where: { id: run.id },
          data: { cancellationRequestedAt: new Date() },
        })
      if (variant === 'takeover' || variant === 'cancel')
        await context.prisma.aiConversation.update({
          where: { id: conversation.id },
          data: { ownershipGeneration: { increment: 1 }, controlledBy: 'HUMAN' },
        })
      expect(await sweep().sweep()).toBe(1)
      const settled = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
      expect(settled.status).toBe(
        variant === 'past' ? 'EXPIRED' : variant === 'future' ? 'FAILED' : 'CANCELLED'
      )
      expect(settled.terminalReasonCode).toBe(
        {
          cancel: 'cancelled_by_user',
          takeover: 'superseded_by_human',
          past: 'deadline_exceeded',
          future: 'permanent_failure',
        }[variant]
      )
      expect(settled.providerRetryRestriction).toEqual(unknown)
    }
  )

  it('classifies canonical JSON with SQL/TS parity and excludes valid future floors from claims', async () => {
    const now = new Date()
    for (const value of [
      null,
      ...invalids,
      until(new Date(now.getTime() - 10000).toISOString()),
      until(new Date(now.getTime() + 60000).toISOString()),
    ]) {
      const json = value === null ? null : JSON.stringify(value)
      const rows = await context.prisma.$queryRaw<{ classification: string }[]>(
        Prisma.sql`SELECT classification FROM ai.classify_provider_retry_restriction(${json}::jsonb, ${now})`
      )
      const parsed = value === null ? null : providerRetryRestrictionSchema.safeParse(value)
      expect(rows[0]!.classification === 'invalid').toBe(value !== null && !parsed?.success)
    }
    const { run } = await queuedConsistencyRun(context, {
      providerRetryRestriction: until(new Date(Date.now() + 60000).toISOString()),
    })
    expect(await sweep().sweep()).toBe(0)
    expect(await consistencyRepository(context).claimDueBatch()).toHaveLength(0)
    expect((await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      'QUEUED'
    )
  })

  it('preserves last-attempt relative restriction beyond horizon without clamping', async () => {
    const { run } = await queuedConsistencyRun(context, { maxAttempts: 1, deadlineAt: null })
    const [claim] = await consistencyRepository(context).claimDueBatch()
    await context.app
      .get(AiRunTransitions, { strict: false })
      .retry(claim!, 'provider_unavailable', parseProviderRetryHint('86401'))
    const settled = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(settled.status).toBe('FAILED')
    expect(settled.errorCode).toBe('provider_retry_after_exceeds_horizon')
    const parsed = providerRetryRestrictionSchema.parse(settled.providerRetryRestriction)
    expect(parsed.kind).toBe('until')
    if (parsed.kind !== 'until') throw new Error('expected until')
    expect(
      new Date(parsed.notBefore).getTime() - new Date(parsed.observedAt).getTime()
    ).toBeGreaterThanOrEqual(86401000)
  })

  it('one committed diagnosis under concurrent sweepers and claim; due/backlog semantics agree', async () => {
    await queuedConsistencyRun(context, { providerRetryRestriction: unknown, deadlineAt: null })
    await queuedConsistencyRun(context, {
      providerRetryRestriction: until(new Date(Date.now() + 60000).toISOString()),
    })
    await queuedConsistencyRun(context, {
      providerRetryRestriction: until(new Date(Date.now() - 10000).toISOString()),
    })
    const metrics = context.app.get(MetricsService, { strict: false })
    // Collector is already registered by the application; inspect its public exposition.
    expect(await metrics.metrics()).toMatch(/amcore_ai_run_due\{[^}]*\} 1/)
    const other = new PrismaService(context.app.get(EnvService), noopPinoLogger, metrics)
    await other.$connect()
    let results: [number, number, unknown[]]
    try {
      results = await Promise.all([
        sweep().sweep(),
        new AiQueuedRestrictionDiagnosis(
          other,
          new ShutdownLatch({ warn: () => undefined }, 'other')
        ).sweep(),
        consistencyRepository(context).claimDueBatch(),
      ])
    } finally {
      await other.onModuleDestroy()
    }
    expect(Number(results[0]) + Number(results[1])).toBe(1)
    expect(results[2]).toHaveLength(1)
    expect(await context.prisma.aiRunStep.count({ where: { type: 'FINALIZATION' } })).toBe(1)
    expect(controls.providerCalls).toBe(0)
  })
  it.each(['86400', '86401', '2147483648'] as const)(
    'relative %s has exact horizon/exhaustion persistence',
    async (header) => {
      const { run } = await queuedConsistencyRun(context, { maxAttempts: 3, deadlineAt: null })
      const [claim] = await consistencyRepository(context).claimDueBatch()
      await context.app
        .get(AiRunTransitions, { strict: false })
        .retry(claim!, 'provider_unavailable', parseProviderRetryHint(header))
      const settled = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
      expect(settled.status).toBe(header === '86400' ? 'QUEUED' : 'FAILED')
      const restriction = providerRetryRestrictionSchema.parse(settled.providerRetryRestriction)
      expect(restriction.kind).toBe(header === '2147483648' ? 'unknown_until' : 'until')
      expect(
        header === '86400' && restriction.kind === 'until'
          ? settled.nextAttemptAt!.getTime() >= new Date(restriction.notBefore).getTime()
          : settled.nextAttemptAt === null
      ).toBe(true)
    }
  )

  it('JSON null is malformed, unlike SQL NULL; future scheduling cannot hide diagnosis', async () => {
    const { run } = await queuedConsistencyRun(context, {
      providerRetryRestriction: Prisma.JsonNull,
      availableAt: new Date(Date.now() + 86400000),
      nextAttemptAt: new Date(Date.now() + 86400000),
      deadlineAt: null,
    })
    expect(await sweep().sweep()).toBe(1)
    expect(
      (await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).errorCode
    ).toBe('provider_retry_restriction_invalid')
  })

  it.each(['rollback', 'seal'] as const)(
    'rolls back terminal/invocation/history writes on %s after update',
    async (boundary) => {
      const { run } = await queuedConsistencyRun(context, {
        providerRetryRestriction: unknown,
        deadlineAt: null,
      })
      const latch = new ShutdownLatch({ warn: () => undefined }, 'injected')
      const original = context.prisma.observedTransactions('ai-diagnosis')
      const spy = jest.spyOn(context.prisma, 'observedTransactions').mockReturnValue({
        $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          original.$transaction(async (tx) => {
            const wrapped = new Proxy(tx, {
              get(target, key) {
                if (key === 'aiRun')
                  return new Proxy(target.aiRun, {
                    get(model, method) {
                      if (method === 'updateMany')
                        return async (args: Parameters<typeof model.updateMany>[0]) => {
                          const value = await model.updateMany(args)
                          if (boundary === 'seal') latch.seal()
                          else throw new Error('injected rollback')
                          return value
                        }
                      const value = Reflect.get(model, method)
                      return typeof value === 'function' ? value.bind(model) : value
                    },
                  })
                const value = Reflect.get(target, key)
                return typeof value === 'function' ? value.bind(target) : value
              },
            })
            return fn(wrapped)
          }),
      } as never)
      try {
        const pending = sweep(latch).sweep()
        const error = await pending.then(
          () => null,
          (value: unknown) => value
        )
        expect(error instanceof Error ? error.message : null).toBe(
          boundary === 'rollback' ? 'injected rollback' : null
        )
      } finally {
        spy.mockRestore()
      }
      // The latch's CUTOFF is a logical boundary; wait for the real engine rollback through a PG lock.
      await context.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai.ai_runs WHERE id=${run.id} FOR UPDATE`)
      })
      expect((await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
        'QUEUED'
      )
      expect(
        await context.prisma.aiRunStep.count({ where: { runId: run.id, type: 'FINALIZATION' } })
      ).toBe(0)
      expect(await context.prisma.aiRunAttempt.count({ where: { runId: run.id } })).toBe(0)
    }
  )
  diagnosisRecoveryProof(() => context)
})
