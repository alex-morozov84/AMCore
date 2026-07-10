import { AiToolInvocationStatus, AiToolRiskClass, type PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import type { AiToolCall } from '../gateway/ai-gateway.types'
import type { AiTool } from '../tools/ai-tool.types'

import type { ClaimedRun } from './ai-run-dispatch.types'
import { AiToolDispatcher, type ToolDispatchContext } from './ai-tool-dispatcher.service'

import type { AuditLogService } from '@/core/audit'
import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'
import type { PrismaService } from '@/prisma'

const claim: ClaimedRun = {
  id: 'run1',
  conversationId: 'conv1',
  modelSnapshot: {},
  attemptNumber: 1,
  maxAttempts: 3,
  deadlineAt: null,
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
})
