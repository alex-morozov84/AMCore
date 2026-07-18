import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import type { AiToolCall } from '../gateway/ai-gateway.types'
import type { AiTool } from '../tools/ai-tool.types'

import type { ClaimedRun } from './ai-run-dispatch.types'
import { AiToolDispatcher, type ToolDispatchContext } from './ai-tool-dispatcher.service'

import type { AuditLogService } from '@/core/audit'
import type { EnvService } from '@/env/env.service'
import {
  AiToolInvocationStatus,
  AiToolRiskClass,
  type PrismaClient,
} from '@/generated/prisma/client'
import type { MetricsService } from '@/infrastructure/observability'
import type { PrismaService } from '@/prisma'

const claim: ClaimedRun = {
  id: 'run1',
  conversationId: 'conv1',
  modelSnapshot: {},
  attemptNumber: 1,
  maxAttempts: 3,
  deadlineAt: null,
  ownershipGeneration: 0,
  leaseToken: 'lease1',
}
const ctx: ToolDispatchContext = { claim, ownerUserId: 'u1', organizationId: null }
const toolCall: AiToolCall = { toolCallId: 'call1', toolName: 'current_time', input: {} }

function makeTool(over: Partial<AiTool> = {}): AiTool {
  return {
    toolId: 'current_time',
    displayName: 'Current time',
    description: 'time',
    parameters: z.object({}).strict(),
    riskClass: AiToolRiskClass.SAFE,
    idempotency: 'read_only',
    execute: jest.fn().mockResolvedValue({ output: 'now' }),
    ...over,
  }
}

describe('AiToolDispatcher', () => {
  let prisma: DeepMockProxy<PrismaClient>
  let metrics: { incAiToolInvocation: jest.Mock }
  let audit: { record: jest.Mock }
  let dispatcher: AiToolDispatcher

  function build(timeoutMs = 15000): void {
    prisma = mockDeep<PrismaClient>()
    ;(prisma.$transaction as unknown as jest.Mock).mockImplementation(
      (cb: (tx: unknown) => unknown) => cb(prisma)
    )
    prisma.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 2 } } as never)
    // Ownership fence reads (ADR-049, Arc F): default to fresh, bot-owned, active — the pre-execution
    // check (findUnique) and the in-tx result-commit fence ($queryRaw FOR UPDATE) both pass.
    prisma.aiConversation.findUnique.mockResolvedValue({
      ownershipGeneration: 0,
      controlledBy: 'BOT',
      state: 'ACTIVE',
    } as never)
    prisma.$queryRaw.mockResolvedValue([
      { ownershipGeneration: 0, controlledBy: 'BOT', state: 'ACTIVE' },
    ] as never)
    metrics = { incAiToolInvocation: jest.fn() }
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    const env = { get: jest.fn(() => timeoutMs) } as unknown as EnvService
    const logger = { setContext: jest.fn(), warn: jest.fn() }
    dispatcher = new AiToolDispatcher(
      prisma as unknown as PrismaService,
      env,
      metrics as unknown as MetricsService,
      audit as unknown as AuditLogService,
      logger as never
    )
  }

  beforeEach(() => build())

  it('executes a SAFE tool and finalizes the invocation SUCCEEDED with a TOOL_INVOCATION step', async () => {
    prisma.aiToolInvocation.create.mockResolvedValue({ id: 'inv1' } as never)

    const result = await dispatcher.dispatch(makeTool(), toolCall, ctx)

    expect(result).toEqual({
      status: 'succeeded',
      invocationId: 'inv1',
      toolCallId: 'call1',
      input: {},
      output: 'now',
    })
    expect(prisma.aiToolInvocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AiToolInvocationStatus.EXECUTING,
          toolId: 'current_time',
        }),
      })
    )
    expect(prisma.aiToolInvocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv1' },
        data: expect.objectContaining({
          status: AiToolInvocationStatus.SUCCEEDED,
          resultSummary: { output: 'now' },
        }),
      })
    )
    expect(prisma.aiRunStep.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'TOOL_INVOCATION',
          detail: { invocationId: 'inv1', toolCallId: 'call1' },
        }),
      })
    )
    expect(metrics.incAiToolInvocation).toHaveBeenCalledWith('current_time', 'safe', 'succeeded')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai.tool.invoked' })
    )
  })

  it('returns the VALIDATED args (defaults/transform applied), not the raw model input', async () => {
    // Crash-resume determinism (finding A2-1): the persisted argsSnapshot and the fed-back tool-call
    // input must both be the parsed value, so an uninterrupted transcript == a resumed one.
    prisma.aiToolInvocation.create.mockResolvedValue({ id: 'inv1' } as never)
    const parameters = z.object({ limit: z.number().default(10), keep: z.string() }).strict()
    const call = { toolCallId: 'call1', toolName: 'current_time', input: { keep: 'x' } }

    const result = await dispatcher.dispatch(makeTool({ parameters }), call, ctx)

    expect(result).toEqual(
      expect.objectContaining({ status: 'succeeded', input: { limit: 10, keep: 'x' } })
    )
    expect(prisma.aiToolInvocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ argsSnapshot: { limit: 10, keep: 'x' } }),
      })
    )
  })

  it('refuses when the resolved tool id does not match the requested tool name', async () => {
    prisma.aiToolInvocation.create.mockResolvedValue({ id: 'invF' } as never)
    const tool = makeTool({ toolId: 'other_tool' })

    const result = await dispatcher.dispatch(tool, toolCall, ctx)

    expect(result).toEqual({ status: 'failed', errorCode: 'tool_not_allowed' })
    expect(tool.execute).not.toHaveBeenCalled()
  })

  it('refuses a non-SAFE tool (approval-gated tools cannot execute before Arc E.5)', async () => {
    prisma.aiToolInvocation.create.mockResolvedValue({ id: 'invF' } as never)
    const tool = makeTool({ riskClass: AiToolRiskClass.SENSITIVE, idempotency: 'idempotent' })

    const result = await dispatcher.dispatch(tool, toolCall, ctx)

    expect(result).toEqual({ status: 'failed', errorCode: 'tool_not_allowed' })
    expect(tool.execute).not.toHaveBeenCalled()
  })

  it('rejects invalid tool arguments before executing (persists a FAILED invocation)', async () => {
    prisma.aiToolInvocation.create.mockResolvedValue({ id: 'invF' } as never)
    const tool = makeTool({ parameters: z.object({ n: z.number() }).strict() })

    const result = await dispatcher.dispatch(tool, toolCall, ctx)

    expect(result).toEqual({ status: 'failed', errorCode: 'tool_args_invalid' })
    expect(tool.execute).not.toHaveBeenCalled()
    expect(prisma.aiToolInvocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: AiToolInvocationStatus.FAILED }),
      })
    )
    expect(metrics.incAiToolInvocation).toHaveBeenCalledWith('current_time', 'safe', 'failed')
  })

  it('marks the invocation FAILED when the tool throws', async () => {
    prisma.aiToolInvocation.create.mockResolvedValue({ id: 'inv1' } as never)
    const tool = makeTool({ execute: jest.fn().mockRejectedValue(new Error('boom')) })

    const result = await dispatcher.dispatch(tool, toolCall, ctx)

    expect(result).toEqual({ status: 'failed', errorCode: 'tool_execution_failed' })
    expect(prisma.aiToolInvocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv1' },
        data: expect.objectContaining({
          status: AiToolInvocationStatus.FAILED,
          errorCode: 'tool_execution_failed',
        }),
      })
    )
  })

  it('fails the invocation when the tool exceeds the execution timeout', async () => {
    build(10)
    prisma.aiToolInvocation.create.mockResolvedValue({ id: 'inv1' } as never)
    const tool = makeTool({
      execute: jest.fn().mockReturnValue(
        new Promise(() => {
          /* never resolves — forces the timeout race */
        })
      ),
    })

    const result = await dispatcher.dispatch(tool, toolCall, ctx)

    expect(result).toEqual({ status: 'failed', errorCode: 'tool_execution_failed' })
  })

  describe('executeApproved (Arc E.5 resume — the sole non-SAFE execution gate)', () => {
    const approved = {
      id: 'inv-appr',
      toolId: 'danger',
      riskClass: AiToolRiskClass.SENSITIVE,
      status: AiToolInvocationStatus.APPROVED,
      argsSnapshot: {},
    }
    const dangerTool = () =>
      makeTool({
        toolId: 'danger',
        riskClass: AiToolRiskClass.SENSITIVE,
        idempotency: 'idempotent',
      })

    it('runs the tool ONLY after winning the {APPROVED,EXECUTING}→EXECUTING CAS, synthetic toolCallId', async () => {
      prisma.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)
      const tool = dangerTool()

      const result = await dispatcher.executeApproved(approved, tool, ctx)

      expect(prisma.aiToolInvocation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'inv-appr',
            status: { in: [AiToolInvocationStatus.APPROVED, AiToolInvocationStatus.EXECUTING] },
          },
          data: expect.objectContaining({ status: AiToolInvocationStatus.EXECUTING }),
        })
      )
      expect(tool.execute).toHaveBeenCalledTimes(1)
      expect(result).toEqual(
        expect.objectContaining({
          status: 'succeeded',
          invocationId: 'inv-appr',
          toolCallId: 'ai-tool-inv:inv-appr',
          input: {},
          output: 'now',
        })
      )
      expect(prisma.aiRunStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'TOOL_INVOCATION',
            detail: { invocationId: 'inv-appr', toolCallId: 'ai-tool-inv:inv-appr' },
          }),
        })
      )
    })

    it('re-applies a stranded EXECUTING invocation idempotently on reclaim (crash-recovery, A2-R2 #1)', async () => {
      // The CAS accepts EXECUTING too, so a worker crash after the gate but before SUCCEEDED re-runs it.
      prisma.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)
      const tool = dangerTool()

      const result = await dispatcher.executeApproved(
        { ...approved, status: AiToolInvocationStatus.EXECUTING },
        tool,
        ctx
      )

      expect(result).toEqual(expect.objectContaining({ status: 'succeeded' }))
      expect(tool.execute).toHaveBeenCalledTimes(1)
    })

    it('does NOT execute the tool when the execution CAS matches no row (lost race / terminal)', async () => {
      prisma.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)
      const tool = dangerTool()

      const result = await dispatcher.executeApproved(approved, tool, ctx)

      expect(result).toEqual({ status: 'failed', errorCode: 'tool_not_allowed' })
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('refuses (no CAS, no execution) when the resolved tool is not the invocation tool', async () => {
      const tool = makeTool({ toolId: 'other', riskClass: AiToolRiskClass.SENSITIVE })

      const result = await dispatcher.executeApproved(approved, tool, ctx)

      expect(result).toEqual({ status: 'failed', errorCode: 'tool_not_allowed' })
      expect(prisma.aiToolInvocation.updateMany).not.toHaveBeenCalled()
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('refuses when the current tool risk no longer matches the approved risk (A2-R2 #2)', async () => {
      // The owner approved a SENSITIVE call; the tool is now DESTRUCTIVE — never execute the escalation.
      const tool = dangerTool()
      ;(tool as { riskClass: AiToolRiskClass }).riskClass = AiToolRiskClass.DESTRUCTIVE

      const result = await dispatcher.executeApproved(approved, tool, ctx)

      expect(result).toEqual({ status: 'failed', errorCode: 'tool_not_allowed' })
      expect(prisma.aiToolInvocation.updateMany).not.toHaveBeenCalled()
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('refuses when the persisted args no longer satisfy the current schema (A2-R2 #2)', async () => {
      // The tool schema tightened after the approval was granted → the stale args are now invalid.
      const tool = dangerTool()
      ;(tool as { parameters: unknown }).parameters = z.object({ n: z.number() }).strict()

      const result = await dispatcher.executeApproved(approved, tool, ctx)

      expect(result).toEqual({ status: 'failed', errorCode: 'tool_args_invalid' })
      expect(prisma.aiToolInvocation.updateMany).not.toHaveBeenCalled()
      expect(tool.execute).not.toHaveBeenCalled()
    })
  })

  it('applyRejected writes the ordering TOOL_INVOCATION step + a rejected metric, runs no tool', async () => {
    const rejected = {
      id: 'inv-rej',
      toolId: 'danger',
      riskClass: AiToolRiskClass.SENSITIVE,
      status: AiToolInvocationStatus.REJECTED,
      argsSnapshot: {},
    }

    await dispatcher.applyRejected(rejected, ctx)

    expect(prisma.aiRunStep.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'TOOL_INVOCATION',
          detail: { invocationId: 'inv-rej', toolCallId: 'ai-tool-inv:inv-rej' },
        }),
      })
    )
    expect(metrics.incAiToolInvocation).toHaveBeenCalledWith('danger', 'sensitive', 'rejected')
  })

  describe('ownership fence (ADR-049, Arc F)', () => {
    it('does not start the tool (no invocation, no execute) when a human already took over', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({
        ownershipGeneration: 1,
        controlledBy: 'HUMAN',
        state: 'PAUSED_FOR_HUMAN',
      } as never)
      const tool = makeTool()

      const result = await dispatcher.dispatch(tool, toolCall, ctx)

      expect(result).toEqual({ status: 'superseded' })
      expect(tool.execute).not.toHaveBeenCalled()
      expect(prisma.aiToolInvocation.create).not.toHaveBeenCalled()
    })

    it('does not commit SUCCEEDED / the TOOL_INVOCATION step when takeover lands during execution', async () => {
      prisma.aiToolInvocation.create.mockResolvedValue({ id: 'inv1' } as never)
      // Pre-check passes (fresh), but the in-tx result-commit fence sees the generation moved.
      prisma.$queryRaw.mockResolvedValue([
        { ownershipGeneration: 1, controlledBy: 'HUMAN', state: 'ACTIVE' },
      ] as never)

      const result = await dispatcher.dispatch(makeTool(), toolCall, ctx)

      expect(result).toEqual({ status: 'superseded' })
      // The tool ran (at-least-once side effect), but no SUCCEEDED status or step was written.
      expect(prisma.aiRunStep.create).not.toHaveBeenCalled()
      expect(metrics.incAiToolInvocation).not.toHaveBeenCalledWith(
        'current_time',
        'safe',
        'succeeded'
      )
    })

    it('applyRejected does not write the ordering step when a human took over', async () => {
      const rejected = {
        id: 'inv-rej',
        toolId: 'danger',
        riskClass: AiToolRiskClass.SENSITIVE,
        argsSnapshot: {},
        status: AiToolInvocationStatus.REJECTED,
      }
      prisma.$queryRaw.mockResolvedValue([
        { ownershipGeneration: 1, controlledBy: 'HUMAN', state: 'PAUSED_FOR_HUMAN' },
      ] as never)

      const result = await dispatcher.applyRejected(rejected, ctx)

      expect(result).toBe('superseded')
      expect(prisma.aiRunStep.create).not.toHaveBeenCalled()
      expect(metrics.incAiToolInvocation).not.toHaveBeenCalled()
    })
  })
})
