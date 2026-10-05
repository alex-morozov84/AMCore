import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import type { AiTextResult } from '../gateway/ai-gateway.types'
import type { AiTool } from '../tools/ai-tool.types'
import { AiToolRejectedError, AiToolRetryableError } from '../tools/ai-tool-error'

import type { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun, StopCause } from './ai-run-dispatch.types'
import type { AiRunGuard } from './ai-run-guard.service'
import { RunLeaseLostError } from './ai-run-guard.service'
import type { RunPlan } from './ai-run-plan'
import type { AiRunTransitions } from './ai-run-transitions.service'
import { AiToolActionService, type ToolRunContext } from './ai-tool-action.service'
import type { InvocationRow } from './ai-tool-invocation.store'

import type { AuditLogService } from '@/core/audit'
import type { EnvService } from '@/env/env.service'
import { AiToolInvocationStatus, AiToolRiskClass } from '@/generated/prisma/client'
import type { MetricsService } from '@/infrastructure/observability'
import type { AttemptRuntime } from '@/infrastructure/worker-lifecycle'
import type { PrismaService } from '@/prisma'

/**
 * Unit tests for the durable tool action service (E12 minimal contract). The guard is scripted (it runs
 * the callback in a fake guarded transaction and reports a stop cause); the compare-and-set predicates are
 * pinned in the store spec and proved against real Postgres in e2e. Pinned here: intent identity and
 * reuse, frozen-input checks, start refusal, outcome classification (no-effect / read-only / UNKNOWN),
 * the stop-cause-wins rule, and that nothing is ever replayed.
 */

const CLAIM: ClaimedRun = {
  id: 'run-1',
  conversationId: 'conv-1',
  modelSnapshot: {},
  epoch: 3,
  attemptNumber: 1,
  maxAttempts: 3,
  deadlineAt: null,
  ownershipGeneration: 0,
  leaseToken: 'lease',
}

const PLAN = {
  modelSlug: 'm',
  attribution: { userId: 'u1', organizationId: null },
} as unknown as RunPlan
const RESULT: AiTextResult = {
  text: '',
  finishReason: 'tool_calls',
  toolCalls: [{ toolCallId: 'p1', toolName: 'archive_document', input: {} }],
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  modelSlug: 'm',
  providerType: 'MOCK' as AiTextResult['providerType'],
}

function makeTool(
  over: Partial<AiTool> = {},
  execute: AiTool['execute'] = async () => ({ output: 'archived' })
): AiTool {
  return {
    toolId: 'archive_document',
    displayName: 'Archive',
    description: 'archive',
    parameters: z.object({ documentId: z.string() }).strict(),
    riskClass: AiToolRiskClass.SAFE,
    idempotency: 'idempotent',
    execute,
    ...over,
  } as AiTool
}

function row(over: Partial<InvocationRow> = {}): InvocationRow {
  return {
    id: 'inv-1',
    toolId: 'archive_document',
    riskClass: 'SAFE',
    idempotency: 'idempotent',
    status: AiToolInvocationStatus.REQUESTED,
    executionEpoch: null,
    argsSnapshot: { documentId: 'd1' },
    originCall: 1,
    errorCode: null,
    appliedAt: null,
    ...over,
  } as InvocationRow
}

describe('AiToolActionService', () => {
  let tx: DeepMockProxy<PrismaService>
  let stop: StopCause | null
  let admitKind: 'ok' | 'stopped' | 'lease_lost' | 'cutoff'
  let admitCause: StopCause
  let recordKind: 'ok' | 'lease_lost' | 'cutoff'
  let guard: { admit: jest.Mock; record: jest.Mock }
  let repository: DeepMockProxy<AiRunRepository>
  let transitions: { stop: jest.Mock }
  let metrics: { incAiToolInvocation: jest.Mock }
  let audit: { record: jest.Mock }
  let service: AiToolActionService
  let ctx: ToolRunContext
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    stop = null
    admitKind = 'ok'
    admitCause = 'cancelled'
    recordKind = 'ok'
    tx = mockDeep<PrismaService>()
    tx.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 0 } } as never)
    tx.aiRunStep.count.mockResolvedValue(0 as never)
    tx.aiToolInvocation.findFirst.mockResolvedValue(null as never)
    tx.aiToolInvocation.create.mockResolvedValue(row() as never)
    tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)
    repository = mockDeep<AiRunRepository>()
    repository.finalizeFailed.mockResolvedValue(true)
    repository.finalizeCancelled.mockResolvedValue(true)
    repository.finalizeSuperseded.mockResolvedValue(true)
    repository.finalizeExpired.mockResolvedValue(true)
    guard = {
      admit: jest.fn(async (_c: ClaimedRun, fn: (t: unknown, g: object) => Promise<unknown>) => {
        if (admitKind === 'stopped') return { kind: 'stopped', cause: admitCause }
        if (admitKind !== 'ok') return { kind: admitKind }
        return { kind: 'ok', value: await fn(tx, { stop: null, epoch: 3 }), stop: null }
      }),
      record: jest.fn(async (_c: ClaimedRun, fn: (t: unknown, g: object) => Promise<unknown>) => {
        if (recordKind !== 'ok') return { kind: recordKind }
        try {
          return { kind: 'ok', value: await fn(tx, { stop, epoch: 3 }), stop }
        } catch (error) {
          if (error instanceof RunLeaseLostError) return { kind: 'lease_lost' }
          throw error
        }
      }),
    }
    transitions = { stop: jest.fn().mockResolvedValue('applied') }
    metrics = { incAiToolInvocation: jest.fn() }
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    const env = { get: jest.fn(() => 200) } as unknown as EnvService
    service = new AiToolActionService(
      guard as unknown as AiRunGuard,
      repository,
      transitions as unknown as AiRunTransitions,
      env,
      metrics as unknown as MetricsService,
      audit as unknown as AuditLogService,
      logger as never
    )
    ctx = {
      claim: CLAIM,
      ownerUserId: 'u1',
      organizationId: null,
      runtime: {
        attempt: { signal: new AbortController().signal, abort: jest.fn(), dispose: jest.fn() },
        onTransportStarted: jest.fn(),
      } as unknown as AttemptRuntime,
    }
  })

  describe('requestAction — durable intent BEFORE any effect', () => {
    const request = (tool = makeTool(), args: unknown = { documentId: 'd1' }) =>
      service.requestAction(CLAIM, PLAN, RESULT, 5, 1, tool, args)

    it('records the provider call, its usage and a REQUESTED invocation carrying the action identity', async () => {
      const outcome = await request()

      expect(outcome.kind).toBe('ready')
      expect(tx.aiUsageLedger.create).toHaveBeenCalledTimes(1)
      expect(tx.aiRunStep.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [expect.objectContaining({ type: 'PROVIDER_CALL' })] })
      )
      expect(tx.aiToolInvocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runId: 'run-1',
            status: 'REQUESTED',
            originCall: 1,
            idempotency: 'idempotent',
            argsSnapshot: { documentId: 'd1' },
          }),
        })
      )
    })

    it('REUSES the original invocation when the same action is requested again (same input): no second row/step/ledger', async () => {
      tx.aiToolInvocation.findFirst.mockResolvedValue(row() as never)

      const outcome = await request()

      expect(outcome).toEqual({ kind: 'ready', action: expect.objectContaining({ id: 'inv-1' }) })
      expect(tx.aiToolInvocation.create).not.toHaveBeenCalled()
      expect(tx.aiUsageLedger.create).not.toHaveBeenCalled()
      expect(tx.aiRunStep.createMany).not.toHaveBeenCalled()
    })

    it('fails CLOSED (action_input_conflict) when the same requested action reappears with different input', async () => {
      tx.aiToolInvocation.findFirst.mockResolvedValue(row() as never)

      const outcome = await request(makeTool(), { documentId: 'other' })

      expect(outcome).toEqual({ kind: 'terminal' })
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        tx,
        CLAIM,
        'tool_loop_failed',
        'action_input_conflict'
      )
      expect(tx.aiToolInvocation.create).not.toHaveBeenCalled()
    })

    it('exits without writing when the ordinal was already recorded by another continuation', async () => {
      tx.aiRunStep.count.mockResolvedValue(1 as never)

      expect(await request()).toEqual({ kind: 'exit' })
      expect(tx.aiUsageLedger.create).not.toHaveBeenCalled()
      expect(tx.aiToolInvocation.create).not.toHaveBeenCalled()
    })

    it.each(['cancelled', 'superseded', 'expired'] as const)(
      'a visible %s stop keeps the call + usage, creates NO invocation, and terminalizes',
      async (cause) => {
        stop = cause

        expect(await request()).toEqual({ kind: 'terminal' })
        expect(tx.aiUsageLedger.create).toHaveBeenCalledTimes(1)
        expect(tx.aiToolInvocation.create).not.toHaveBeenCalled()
      }
    )

    it('exits when the guard refuses (lease lost / shutdown): nothing written', async () => {
      recordKind = 'lease_lost'

      expect(await request()).toEqual({ kind: 'exit' })
    })
  })

  describe('execute — start, run, record', () => {
    const start = (action = row(), tool = makeTool(), args?: unknown) =>
      service.execute(ctx, action, tool, 'call-1', args)

    it('runs the tool once, applies the SUCCEEDED result, and returns the round to continue', async () => {
      const execute = jest.fn(async (..._args: unknown[]) => ({ output: 'archived' }))

      const step = await start(row(), makeTool({}, execute), { documentId: 'd1' })

      expect(step).toEqual({
        status: 'succeeded',
        toolCallId: 'call-1',
        input: { documentId: 'd1' },
        output: 'archived',
      })
      expect(execute).toHaveBeenCalledTimes(1)
      // The idempotency key is the stable action identity, constant across any later resume.
      expect(execute.mock.calls[0]![1]).toMatchObject({
        idempotencyKey: 'ai-tool:inv-1',
        invocationId: 'inv-1',
      })
      expect(ctx.runtime.onTransportStarted).toHaveBeenCalledTimes(1)
      expect(guard.admit.mock.calls[0]![2]).toEqual({ markIoStarted: true })
      expect(metrics.incAiToolInvocation).toHaveBeenCalledWith(
        'archive_document',
        'safe',
        'succeeded'
      )
    })

    it.each(['cancelled', 'superseded', 'expired'] as const)(
      'a %s stop refuses the START: the tool never runs and the run terminalizes',
      async (cause) => {
        admitKind = 'stopped'
        admitCause = cause
        const execute = jest.fn()

        const step = await start(row(), makeTool({}, execute), { documentId: 'd1' })

        expect(step).toEqual({ status: 'terminal' })
        expect(execute).not.toHaveBeenCalled()
        expect(transitions.stop).toHaveBeenCalledWith(CLAIM, cause)
      }
    )

    it.each(['lease_lost', 'cutoff'] as const)(
      'exits without running the tool when admission is %s',
      async (kind) => {
        admitKind = kind
        const execute = jest.fn()

        expect(await start(row(), makeTool({}, execute), { documentId: 'd1' })).toEqual({
          status: 'exit',
        })
        expect(execute).not.toHaveBeenCalled()
      }
    )

    it('never runs a tool whose start CAS says in_progress (a same-epoch competing continuation owns it)', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)
      tx.aiToolInvocation.findUnique.mockResolvedValue({
        status: 'EXECUTING',
        executionEpoch: 3,
        idempotency: 'idempotent',
      } as never)
      const execute = jest.fn()

      expect(await start(row(), makeTool({}, execute), { documentId: 'd1' })).toEqual({
        status: 'exit',
      })
      expect(execute).not.toHaveBeenCalled()
    })

    describe('outcome classification (conservative: only an explicit no-effect error proves nothing happened)', () => {
      it('explicit rejected-no-effect → invocation FAILED, run FAILED (terminal, no replay)', async () => {
        const tool = makeTool({}, async () => {
          throw new AiToolRejectedError()
        })

        const step = await start(row(), tool, { documentId: 'd1' })

        expect(step).toEqual({ status: 'terminal' })
        expect(tx.aiToolInvocation.updateMany).toHaveBeenLastCalledWith(
          expect.objectContaining({
            where: { id: 'inv-1', status: 'EXECUTING', executionEpoch: 3 },
            data: expect.objectContaining({
              status: 'FAILED',
              errorCode: 'tool_rejected_no_effect',
            }),
          })
        )
        expect(repository.finalizeFailed).toHaveBeenCalledWith(
          tx,
          CLAIM,
          'tool_loop_failed',
          'tool_execution_failed'
        )
      })

      it('explicit retryable-no-effect is recorded as such (retry mechanics are a later extension)', async () => {
        const tool = makeTool({}, async () => {
          throw new AiToolRetryableError()
        })

        await start(row(), tool, { documentId: 'd1' })

        expect(tx.aiToolInvocation.updateMany).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'FAILED',
              errorCode: 'tool_retryable_no_effect',
            }),
          })
        )
      })

      it('a read_only tool failure is FAILED (no effect to be unsure about)', async () => {
        const tool = makeTool({ idempotency: 'read_only' }, async () => {
          throw new Error('db blip')
        })

        await start(row({ idempotency: 'read_only' }), tool, { documentId: 'd1' })

        expect(tx.aiToolInvocation.updateMany).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'FAILED', errorCode: 'tool_execution_failed' }),
          })
        )
      })

      it('an UNCLASSIFIED throw of a side-effecting tool is OUTCOME_UNKNOWN: the run stops uncertain', async () => {
        const tool = makeTool({}, async () => {
          throw new Error('connection reset after the request was sent')
        })

        const step = await start(row(), tool, { documentId: 'd1' })

        expect(step).toEqual({ status: 'terminal' })
        expect(tx.aiToolInvocation.updateMany).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'OUTCOME_UNKNOWN',
              errorCode: 'tool_effect_unknown',
            }),
          })
        )
        expect(repository.finalizeFailed).toHaveBeenCalledWith(
          tx,
          CLAIM,
          'tool_loop_failed',
          'tool_effect_unknown'
        )
        expect(metrics.incAiToolInvocation).toHaveBeenCalledWith(
          'archive_document',
          'safe',
          'effect_unknown'
        )
      })

      it('a TIMEOUT of a side-effecting tool is OUTCOME_UNKNOWN even though the tool may later succeed (late result discarded)', async () => {
        let finish!: (value: { output: string }) => void
        const tool = makeTool({}, () => new Promise((resolve) => (finish = resolve)))

        const step = await start(row(), tool, { documentId: 'd1' }) // env timeout is 200 ms

        expect(step).toEqual({ status: 'terminal' })
        expect(tx.aiToolInvocation.updateMany).toHaveBeenLastCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'OUTCOME_UNKNOWN' }) })
        )
        finish({ output: 'too late' }) // the physical call settles later: nothing consumes it
        expect(ctx.runtime.onTransportStarted).toHaveBeenCalledTimes(1) // its slot is held until then
      })
    })

    describe('a stop observed WHILE the tool ran never erases its known outcome', () => {
      it('success: the result is recorded (not applied to the transcript) and the run terminalizes as the stop', async () => {
        stop = 'cancelled'

        const step = await start(row(), makeTool(), { documentId: 'd1' })

        expect(step).toEqual({ status: 'terminal' })
        const [{ data }] = tx.aiToolInvocation.updateMany.mock.calls.at(-1) as unknown as [
          { data: Record<string, unknown> },
        ]
        expect(data.status).toBe('SUCCEEDED')
        expect(data).not.toHaveProperty('appliedAt')
        expect(tx.aiRunStep.create).not.toHaveBeenCalled() // no ordering step: nothing continues
        expect(repository.finalizeCancelled).toHaveBeenCalledTimes(1)
      })

      it('uncertain failure: OUTCOME_UNKNOWN is recorded and the run ends as the stop (precedence)', async () => {
        stop = 'superseded'
        const tool = makeTool({}, async () => {
          throw new Error('boom')
        })

        await start(row(), tool, { documentId: 'd1' })

        expect(tx.aiToolInvocation.updateMany).toHaveBeenLastCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'OUTCOME_UNKNOWN' }) })
        )
        expect(repository.finalizeSuperseded).toHaveBeenCalledTimes(1)
        expect(repository.finalizeFailed).not.toHaveBeenCalled()
      })
    })

    it('a stale holder cannot record: a lost lease at result time exits and leaves the action to recovery', async () => {
      recordKind = 'lease_lost'

      const step = await start(row(), makeTool(), { documentId: 'd1' })

      expect(step).toEqual({ status: 'exit' })
      expect(metrics.incAiToolInvocation).not.toHaveBeenCalled()
    })

    describe('frozen input on recovery (no args supplied)', () => {
      it('re-parses the stored snapshot and runs it when it parses to ITSELF', async () => {
        const execute = jest.fn(async (..._args: unknown[]) => ({ output: 'ok' }))

        const step = await start(row(), makeTool({}, execute))

        expect(step.status).toBe('succeeded')
        expect(execute.mock.calls[0]![0]).toEqual({ documentId: 'd1' })
      })

      it('fails CLOSED (tool_schema_incompatible) when the stored input no longer parses to itself — never executed', async () => {
        const execute = jest.fn()
        // A schema whose transform is not idempotent under re-parse (parse(parse(x)) !== parse(x)).
        const transforming = makeTool(
          { parameters: z.object({ documentId: z.string().transform((v) => `${v}!`) }) as never },
          execute
        )

        const step = await start(row(), transforming)

        expect(step).toEqual({ status: 'terminal' })
        expect(execute).not.toHaveBeenCalled()
        expect(repository.finalizeFailed).toHaveBeenCalledWith(
          tx,
          CLAIM,
          'tool_loop_failed',
          'tool_schema_incompatible'
        )
      })

      it('does not second-guess a side-effecting EXECUTING row with the schema check (it goes to the uncertainty path)', async () => {
        tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)
        tx.aiToolInvocation.findUnique.mockResolvedValue({
          status: 'EXECUTING',
          executionEpoch: 1,
          idempotency: 'idempotent',
        } as never)
        const execute = jest.fn()

        const step = await start(
          row({ status: AiToolInvocationStatus.EXECUTING, executionEpoch: 1 }),
          makeTool({ parameters: z.object({ other: z.string() }) as never }, execute)
        )

        expect(step).toEqual({ status: 'terminal' })
        expect(execute).not.toHaveBeenCalled()
        expect(repository.finalizeFailed).toHaveBeenCalledWith(
          tx,
          CLAIM,
          'tool_loop_failed',
          'tool_effect_unknown'
        )
      })
    })
  })

  describe('applyRejected', () => {
    it('applies an owner rejection once and returns the fixed notice as the round (no tool runs)', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)

      const step = await service.applyRejected(ctx, row({ status: 'REJECTED' as never }))

      expect(step).toMatchObject({ status: 'succeeded', toolCallId: 'ai-tool-inv:inv-1' })
      expect(metrics.incAiToolInvocation).toHaveBeenCalledWith(
        'archive_document',
        'safe',
        'rejected'
      )
    })

    it('exits when already applied (nothing written twice)', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)

      expect(await service.applyRejected(ctx, row({ status: 'REJECTED' as never }))).toEqual({
        status: 'exit',
      })
    })

    it('a stop refuses the application and terminalizes', async () => {
      admitKind = 'stopped'
      admitCause = 'expired'

      expect(await service.applyRejected(ctx, row({ status: 'REJECTED' as never }))).toEqual({
        status: 'terminal',
      })
      expect(transitions.stop).toHaveBeenCalledWith(CLAIM, 'expired')
    })
  })
})
