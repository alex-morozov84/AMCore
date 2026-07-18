import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import { AiGatewayException } from '../gateway/ai-gateway.error'
import type { AiTextResult, AiToolCall } from '../gateway/ai-gateway.types'
import type { ModelGateway } from '../gateway/model-gateway.service'
import { scanOutput } from '../guardrails/output-guard'
import { AI_TOOL_REJECTION_NOTICE, approvedToolCallId } from '../tools/ai-tool.constants'
import type { AiTool } from '../tools/ai-tool.types'
import type { AiToolRegistry } from '../tools/ai-tool-registry.service'

import type { AiRunRepository } from './ai-run.repository'
import type { AiRunApprovalParker } from './ai-run-approval-parker.service'
import type { ClaimedRun } from './ai-run-dispatch.types'
import { AiRunLoopExecutor } from './ai-run-loop-executor.service'
import { AiRunLoopFinalizer } from './ai-run-loop-finalizer.service'
import type { RunPlan } from './ai-run-plan'
import type { AiToolDispatcher } from './ai-tool-dispatcher.service'

import type { EnvService } from '@/env/env.service'
import { AiToolInvocationStatus, AiToolRiskClass } from '@/generated/prisma/client'
import type { MetricsService } from '@/infrastructure/observability'
import type { PrismaService } from '@/prisma'

// The output guard runs each step; mock it so tests drive allow/block deterministically and can assert
// EVERY active marker is scanned (invariant 5) without depending on the random per-run tool marker.
jest.mock('../guardrails/output-guard', () => ({
  __esModule: true,
  scanOutput: jest.fn(() => ({ verdict: 'allow', categories: [] })),
}))
const scanOutputMock = scanOutput as jest.Mock

/**
 * Unit tests for the bounded SAFE tool loop (Track C — ADR-054, Arc E.4b). A REAL `AiRunLoopFinalizer`
 * over a mocked Prisma/repository verifies the durable writes end-to-end (transcript + per-call ledger
 * + terminal CAS), while the registry/dispatcher/gateway are mocked to drive each loop branch: final
 * text, one SAFE call → loop, too-many/unknown/approval-gated failures, step exhaustion, output-guard
 * markers, lease renewal + loss, crash-resume reconstruction, and gateway-error mapping.
 */

function claim(over: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    modelSnapshot: { modelSlug: 'claude-default' },
    attemptNumber: 1,
    maxAttempts: 3,
    deadlineAt: null,
    ownershipGeneration: 0,
    leaseToken: 'lease-abc',
    ...over,
  }
}

function plan(over: Partial<RunPlan> = {}): RunPlan {
  return {
    modelSlug: 'claude-default',
    system: 'GUARD INSTRUCTION UNTRUSTED',
    userMessages: [
      { role: 'user', content: '<amcore:user-data-x>{"text":"hi"}</amcore:user-data-x>' },
    ],
    marker: 'amcore:user-data-x',
    toolAllowlist: [],
    inputFlagCategories: [],
    attribution: { userId: 'u1', organizationId: null },
    ...over,
  }
}

function textResult(over: Partial<AiTextResult> = {}): AiTextResult {
  return {
    text: 'hello',
    finishReason: 'stop',
    toolCalls: [],
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    modelSlug: 'claude-default',
    providerType: 'MOCK' as AiTextResult['providerType'],
    ...over,
  }
}

function toolCall(toolName = 'current_time'): AiToolCall {
  return { toolCallId: 'call1', toolName, input: {} }
}

const KNOWN_TOOLS: Record<string, AiTool> = {
  current_time: {
    toolId: 'current_time',
    displayName: 'Current time',
    description: 'time',
    parameters: z.object({}).strict(),
    riskClass: AiToolRiskClass.SAFE,
    idempotency: 'read_only',
    execute: jest.fn(),
  },
  danger: {
    toolId: 'danger',
    displayName: 'Danger',
    description: 'danger',
    parameters: z.object({}).strict(),
    riskClass: AiToolRiskClass.SENSITIVE,
    idempotency: 'idempotent',
    execute: jest.fn(),
  },
}

describe('AiRunLoopExecutor', () => {
  let prisma: DeepMockProxy<PrismaService>
  let gateway: { generateText: jest.Mock }
  let repository: DeepMockProxy<AiRunRepository>
  let registry: { describeAllowed: jest.Mock; get: jest.Mock; requiresApproval: jest.Mock }
  let dispatcher: { dispatch: jest.Mock; executeApproved: jest.Mock; applyRejected: jest.Mock }
  let parker: { park: jest.Mock }
  let env: { get: jest.Mock }
  let metrics: { incAiGuardrailCheck: jest.Mock; observeAiToolLoopSteps: jest.Mock }
  let loop: AiRunLoopExecutor
  let maxSteps: number

  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    scanOutputMock.mockReturnValue({ verdict: 'allow', categories: [] })
    maxSteps = 8
    prisma = mockDeep<PrismaService>()
    prisma.aiRunStep.findMany.mockResolvedValue([] as never)
    prisma.aiToolInvocation.findMany.mockResolvedValue([] as never)
    prisma.aiToolInvocation.findFirst.mockResolvedValue(null as never) // no pending approval by default
    prisma.aiRunStep.count.mockResolvedValue(0 as never)
    prisma.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 0 } } as never)
    prisma.aiMessage.aggregate.mockResolvedValue({ _max: { sequence: 0 } } as never)
    // The loop-top + in-tx ownership fence reads the conversation; default to fresh, bot-owned, active.
    prisma.aiConversation.findUnique.mockResolvedValue({
      ownershipGeneration: 0,
      controlledBy: 'BOT',
      state: 'ACTIVE',
    } as never)
    prisma.$queryRaw.mockResolvedValue([
      { ownershipGeneration: 0, controlledBy: 'BOT', state: 'ACTIVE' },
    ] as never)
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)

    gateway = { generateText: jest.fn().mockResolvedValue(textResult()) }
    repository = mockDeep<AiRunRepository>()
    repository.renewLease.mockResolvedValue(true)
    repository.finalizeCompleted.mockResolvedValue(true)
    repository.finalizeFailed.mockResolvedValue(true)
    repository.finalizeRefusal.mockResolvedValue(true)
    registry = {
      describeAllowed: jest.fn((allow: string[]) =>
        allow
          .filter((id) => KNOWN_TOOLS[id])
          .map((id) => {
            const t = KNOWN_TOOLS[id]!
            return {
              toolId: t.toolId,
              displayName: t.displayName,
              description: t.description,
              riskClass: t.riskClass,
              parameters: t.parameters,
            }
          })
      ),
      get: jest.fn((id: string) => KNOWN_TOOLS[id]),
      requiresApproval: jest.fn((t: AiTool) => t.riskClass !== AiToolRiskClass.SAFE),
    }
    dispatcher = { dispatch: jest.fn(), executeApproved: jest.fn(), applyRejected: jest.fn() }
    parker = { park: jest.fn().mockResolvedValue(true) }
    env = { get: jest.fn(() => maxSteps) }
    metrics = { incAiGuardrailCheck: jest.fn(), observeAiToolLoopSteps: jest.fn() }

    const finalizer = new AiRunLoopFinalizer(
      prisma,
      repository,
      metrics as unknown as MetricsService,
      logger as never
    )
    loop = new AiRunLoopExecutor(
      prisma,
      gateway as unknown as ModelGateway,
      repository,
      registry as unknown as AiToolRegistry,
      dispatcher as unknown as AiToolDispatcher,
      finalizer,
      parker as unknown as AiRunApprovalParker,
      env as unknown as EnvService,
      metrics as unknown as MetricsService,
      logger as never
    )
  })

  describe('final-text path (Arc C single-shot behavior when no tools apply)', () => {
    it('completes with an assistant turn + one ledger row + a terminal CAS, offering no tools', async () => {
      await loop.run(claim(), plan())

      expect(gateway.generateText).toHaveBeenCalledTimes(1)
      expect(gateway.generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          modelSlug: 'claude-default',
          tools: undefined,
          recordUsage: false,
        })
      )
      expect(prisma.aiMessage.create).toHaveBeenCalledTimes(1)
      expect(prisma.aiUsageLedger.create).toHaveBeenCalledTimes(1)
      expect(repository.finalizeCompleted).toHaveBeenCalledTimes(1)
      expect(metrics.observeAiToolLoopSteps).toHaveBeenCalledWith('completed', 1)
      expect(repository.renewLease).toHaveBeenCalledTimes(1)
      expect(dispatcher.dispatch).not.toHaveBeenCalled()
    })
  })

  describe('one SAFE tool call → loop → final text', () => {
    beforeEach(() => {
      gateway.generateText
        .mockResolvedValueOnce(
          textResult({ text: '', finishReason: 'tool_calls', toolCalls: [toolCall()] })
        )
        .mockResolvedValueOnce(textResult({ text: 'the time is now' }))
      dispatcher.dispatch.mockResolvedValue({
        status: 'succeeded',
        invocationId: 'inv1',
        toolCallId: 'call1',
        input: { validated: true },
        output: 'now',
      })
    })

    it('offers the allowlisted tool + augmented system, executes it, then completes', async () => {
      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))

      expect(gateway.generateText).toHaveBeenCalledTimes(2)
      const firstCall = gateway.generateText.mock.calls[0]![0]
      expect(firstCall.tools).toEqual([expect.objectContaining({ name: 'current_time' })])
      // The trusted instruction is augmented with the tool-result untrusted-boundary policy.
      expect(firstCall.system).toContain('Tool results are provided as JSON objects')
      expect(dispatcher.dispatch).toHaveBeenCalledTimes(1)
      expect(repository.finalizeCompleted).toHaveBeenCalledTimes(1)
      expect(metrics.observeAiToolLoopSteps).toHaveBeenCalledWith('completed', 2)
    })

    it('writes one run-attributed ledger row PER provider call, recording that call toolCalls count', async () => {
      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))
      expect(prisma.aiUsageLedger.create).toHaveBeenCalledTimes(2)
      // The tool-requesting call records toolCalls:1; the final-text call records toolCalls:0.
      expect(prisma.aiUsageLedger.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ data: expect.objectContaining({ toolCalls: 1 }) })
      )
      expect(prisma.aiUsageLedger.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ data: expect.objectContaining({ toolCalls: 0 }) })
      )
    })

    it('renews the lease once per provider step (invariant 9)', async () => {
      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))
      expect(repository.renewLease).toHaveBeenCalledTimes(2)
    })

    it('feeds the executed tool result back, echoing the dispatcher VALIDATED args (finding A2-1)', async () => {
      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))
      const secondMessages = gateway.generateText.mock.calls[1]![0].messages
      // user turn + assistant tool-call turn + tool-result turn
      expect(secondMessages).toHaveLength(3)
      // The assistant tool-call turn echoes the VALIDATED args returned by the dispatcher, not the
      // raw model input — so an uninterrupted transcript matches a crash-resumed one.
      expect(secondMessages[1]).toEqual(
        expect.objectContaining({
          role: 'assistant',
          toolCalls: [expect.objectContaining({ input: { validated: true } })],
        })
      )
      expect(secondMessages[2]).toEqual(expect.objectContaining({ role: 'tool' }))
    })
  })

  describe('policy failures (non-retryable, one provider call recorded)', () => {
    it('fails too_many_tool_calls when the model requests more than one tool in a step', async () => {
      gateway.generateText.mockResolvedValue(
        textResult({ toolCalls: [toolCall('current_time'), toolCall('current_time')] })
      )
      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))
      expect(dispatcher.dispatch).not.toHaveBeenCalled()
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ id: 'run-1' }),
        'tool_loop_failed',
        'too_many_tool_calls'
      )
      // The offending provider call is still recorded + ledgered (honest accounting).
      expect(prisma.aiUsageLedger.create).toHaveBeenCalledTimes(1)
      expect(metrics.observeAiToolLoopSteps).toHaveBeenCalledWith('failed', 1)
    })

    it('fails tool_not_allowed for an unknown / not-allowlisted tool, never executing it', async () => {
      gateway.generateText.mockResolvedValue(textResult({ toolCalls: [toolCall('unregistered')] }))
      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))
      expect(dispatcher.dispatch).not.toHaveBeenCalled()
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'tool_loop_failed',
        'tool_not_allowed'
      )
    })

    it('fails a registered tool that is NOT on the conversation allowlist', async () => {
      // The model requests current_time but the conversation binds only `danger`.
      gateway.generateText.mockResolvedValue(textResult({ toolCalls: [toolCall('current_time')] }))
      await loop.run(claim(), plan({ toolAllowlist: ['danger'] }))
      expect(dispatcher.dispatch).not.toHaveBeenCalled()
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'tool_loop_failed',
        'tool_not_allowed'
      )
    })

    it('fails the run when the SAFE tool fails host-side (mapping the dispatcher error code)', async () => {
      gateway.generateText.mockResolvedValue(textResult({ toolCalls: [toolCall()] }))
      dispatcher.dispatch.mockResolvedValue({
        status: 'failed',
        errorCode: 'tool_execution_failed',
      })
      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'tool_loop_failed',
        'tool_execution_failed'
      )
      expect(metrics.observeAiToolLoopSteps).toHaveBeenCalledWith('failed', 1)
    })
  })

  describe('approval park + resume (Arc E.5)', () => {
    it('PARKS an allowed non-SAFE call behind a durable approval (never executes it inline)', async () => {
      gateway.generateText.mockResolvedValue(textResult({ toolCalls: [toolCall('danger')] }))
      await loop.run(claim(), plan({ toolAllowlist: ['danger'] }))
      // The tool is NOT dispatched, the run is NOT terminally failed — it parks.
      expect(dispatcher.dispatch).not.toHaveBeenCalled()
      expect(repository.finalizeFailed).not.toHaveBeenCalled()
      expect(parker.park).toHaveBeenCalledTimes(1)
      const [, , , , tool, args] = parker.park.mock.calls[0]!
      expect(tool.toolId).toBe('danger')
      expect(args).toEqual({}) // validated args handed to the parker (not the raw call)
    })

    it('fails tool_args_invalid (not park) when a non-SAFE call has invalid arguments', async () => {
      const danger = { ...KNOWN_TOOLS.danger!, parameters: z.object({ n: z.number() }).strict() }
      registry.get.mockImplementation((id: string) => (id === 'danger' ? danger : KNOWN_TOOLS[id]))
      gateway.generateText.mockResolvedValue(textResult({ toolCalls: [toolCall('danger')] }))
      await loop.run(claim(), plan({ toolAllowlist: ['danger'] }))
      expect(parker.park).not.toHaveBeenCalled()
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'tool_loop_failed',
        'tool_args_invalid'
      )
    })

    it('resume-APPROVE: executes the approved invocation, then loops to final text', async () => {
      prisma.aiToolInvocation.findFirst.mockResolvedValue({
        id: 'inv-appr',
        toolId: 'danger',
        riskClass: AiToolRiskClass.SENSITIVE,
        status: AiToolInvocationStatus.APPROVED,
        argsSnapshot: {},
      } as never)
      dispatcher.executeApproved.mockResolvedValue({
        status: 'succeeded',
        invocationId: 'inv-appr',
        toolCallId: approvedToolCallId('inv-appr'),
        input: {},
        output: 'done deal',
      })
      gateway.generateText.mockResolvedValue(textResult({ text: 'all set' }))

      await loop.run(claim(), plan({ toolAllowlist: ['danger'] }))

      expect(dispatcher.executeApproved).toHaveBeenCalledTimes(1)
      // The executed approved round is fed back into the first (and only) provider step's transcript.
      const messages = gateway.generateText.mock.calls[0]![0].messages
      expect(messages).toHaveLength(3)
      expect(messages[1].toolCalls[0].toolCallId).toBe(approvedToolCallId('inv-appr'))
      expect(messages[2].toolResults[0].toolCallId).toBe(approvedToolCallId('inv-appr'))
      expect(repository.finalizeCompleted).toHaveBeenCalledTimes(1)
    })

    it('resume: re-applies a stranded EXECUTING invocation (crash-recovery), never re-parking', async () => {
      prisma.aiToolInvocation.findFirst.mockResolvedValue({
        id: 'inv-appr',
        toolId: 'danger',
        riskClass: AiToolRiskClass.SENSITIVE,
        status: AiToolInvocationStatus.EXECUTING,
        argsSnapshot: {},
      } as never)
      dispatcher.executeApproved.mockResolvedValue({
        status: 'succeeded',
        invocationId: 'inv-appr',
        toolCallId: approvedToolCallId('inv-appr'),
        input: {},
        output: 'recovered',
      })
      gateway.generateText.mockResolvedValue(textResult({ text: 'done' }))

      await loop.run(claim(), plan({ toolAllowlist: ['danger'] }))

      expect(dispatcher.executeApproved).toHaveBeenCalledTimes(1)
      expect(parker.park).not.toHaveBeenCalled()
      expect(repository.finalizeCompleted).toHaveBeenCalledTimes(1)
    })

    it('resume-APPROVE: an approved-tool host failure drives the run terminal (no provider call)', async () => {
      prisma.aiToolInvocation.findFirst.mockResolvedValue({
        id: 'inv-appr',
        toolId: 'danger',
        riskClass: AiToolRiskClass.SENSITIVE,
        status: AiToolInvocationStatus.APPROVED,
        argsSnapshot: {},
      } as never)
      dispatcher.executeApproved.mockResolvedValue({
        status: 'failed',
        errorCode: 'tool_execution_failed',
      })
      await loop.run(claim(), plan({ toolAllowlist: ['danger'] }))
      expect(gateway.generateText).not.toHaveBeenCalled()
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'tool_loop_failed',
        'tool_execution_failed'
      )
    })

    it('resume-REJECT: replays the fixed rejection notice and loops to final text (no execution)', async () => {
      prisma.aiToolInvocation.findFirst.mockResolvedValue({
        id: 'inv-rej',
        toolId: 'danger',
        riskClass: AiToolRiskClass.SENSITIVE,
        status: AiToolInvocationStatus.REJECTED,
        argsSnapshot: {},
      } as never)
      prisma.aiRunStep.findFirst.mockResolvedValue(null as never) // not applied yet → pending reject
      gateway.generateText.mockResolvedValue(textResult({ text: 'ok without the tool' }))

      await loop.run(claim(), plan({ toolAllowlist: ['danger'] }))

      expect(dispatcher.executeApproved).not.toHaveBeenCalled()
      expect(dispatcher.applyRejected).toHaveBeenCalledTimes(1)
      const messages = gateway.generateText.mock.calls[0]![0].messages
      expect(messages).toHaveLength(3)
      expect(messages[1].toolCalls[0].toolCallId).toBe(approvedToolCallId('inv-rej'))
      // The tool-result turn carries the fixed, content-free rejection notice.
      expect(messages[2].toolResults[0].output).toContain(AI_TOOL_REJECTION_NOTICE)
      expect(repository.finalizeCompleted).toHaveBeenCalledTimes(1)
    })
  })

  describe('bounds, lease, and deadline', () => {
    it('fails tool_loop_exhausted once the provider-step bound is hit mid-loop', async () => {
      maxSteps = 1
      gateway.generateText.mockResolvedValue(textResult({ toolCalls: [toolCall()] }))
      dispatcher.dispatch.mockResolvedValue({
        status: 'succeeded',
        invocationId: 'inv1',
        toolCallId: 'call1',
        output: 'now',
      })
      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))
      // One provider call (step 1) executed a tool; the 2nd iteration trips the bound before calling.
      expect(gateway.generateText).toHaveBeenCalledTimes(1)
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'tool_loop_failed',
        'tool_loop_exhausted'
      )
      expect(metrics.observeAiToolLoopSteps).toHaveBeenCalledWith('exhausted', 1)
    })

    it('exhausts immediately (no provider call) when persisted PROVIDER_CALL steps already meet the bound', async () => {
      maxSteps = 2
      prisma.aiRunStep.count.mockResolvedValue(2 as never)
      await loop.run(claim(), plan())
      expect(gateway.generateText).not.toHaveBeenCalled()
      expect(metrics.observeAiToolLoopSteps).toHaveBeenCalledWith('exhausted', 2)
    })

    it('renews the lease each step and STOPS safely (no finalize) when the lease was lost', async () => {
      repository.renewLease.mockResolvedValue(false)
      await loop.run(claim(), plan())
      expect(gateway.generateText).not.toHaveBeenCalled()
      expect(repository.finalizeCompleted).not.toHaveBeenCalled()
      expect(repository.finalizeFailed).not.toHaveBeenCalled()
      expect(metrics.observeAiToolLoopSteps).not.toHaveBeenCalled()
    })

    it('expires the run when its deadline has passed', async () => {
      await loop.run(claim({ deadlineAt: new Date(0) }), plan())
      expect(gateway.generateText).not.toHaveBeenCalled()
      expect(repository.finalizeExpired).toHaveBeenCalledTimes(1)
    })
  })

  describe('output guard (each step, every active marker)', () => {
    it('scans BOTH the user-input marker and the tool-result marker when tools are offered', async () => {
      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))
      expect(scanOutputMock).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({
          markers: ['amcore:user-data-x', expect.stringMatching(/^amcore:user-data-tool-/)],
        })
      )
    })

    it('scans only the user marker when no tools apply', async () => {
      await loop.run(claim(), plan())
      expect(scanOutputMock).toHaveBeenCalledWith('hello', { markers: ['amcore:user-data-x'] })
    })

    it('discards the output and finalizes a safe refusal on a block verdict', async () => {
      scanOutputMock.mockReturnValue({
        verdict: 'block',
        categories: [{ category: 'boundary_marker_leak', count: 1 }],
      })
      await loop.run(claim(), plan())
      expect(prisma.aiMessage.create).not.toHaveBeenCalled()
      expect(repository.finalizeCompleted).not.toHaveBeenCalled()
      expect(repository.finalizeRefusal).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'run-1' }),
        expect.objectContaining({
          reasonCode: 'guardrail_output_blocked',
          checkStepType: 'OUTPUT_VALIDATION',
        })
      )
      expect(metrics.observeAiToolLoopSteps).toHaveBeenCalledWith('failed', 1)
    })
  })

  describe('crash-safe resume reconstruction', () => {
    it('replays only APPLIED (SUCCEEDED/REJECTED) invocations, skipping incomplete ones (invariant 7)', async () => {
      // Two TOOL_INVOCATION steps persisted, but only inv1 is applied — inv2 must not be replayed.
      prisma.aiRunStep.findMany.mockResolvedValue([
        { detail: { invocationId: 'inv1', toolCallId: 'call1' } },
        { detail: { invocationId: 'inv2', toolCallId: 'call2' } },
      ] as never)
      prisma.aiToolInvocation.findMany.mockResolvedValue([
        {
          id: 'inv1',
          toolId: 'current_time',
          status: AiToolInvocationStatus.SUCCEEDED,
          argsSnapshot: {},
          resultSummary: { output: 'now' },
        },
      ] as never)
      prisma.aiRunStep.count.mockResolvedValue(1 as never)

      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))

      // The reconstruction join is scoped to applied statuses only, and exactly ONE round is replayed:
      expect(prisma.aiToolInvocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['SUCCEEDED', 'REJECTED'] } }),
        })
      )
      const messages = gateway.generateText.mock.calls[0]![0].messages
      expect(messages).toHaveLength(3) // 1 user + (1 assistant tool-call + 1 tool result) for inv1 only
    })

    it('replays a REJECTED invocation as the fixed rejection notice (Arc E.5)', async () => {
      prisma.aiRunStep.findMany.mockResolvedValue([
        { detail: { invocationId: 'inv-rej', toolCallId: approvedToolCallId('inv-rej') } },
      ] as never)
      prisma.aiToolInvocation.findMany.mockResolvedValue([
        {
          id: 'inv-rej',
          toolId: 'danger',
          status: AiToolInvocationStatus.REJECTED,
          argsSnapshot: {},
          resultSummary: null,
        },
      ] as never)
      prisma.aiRunStep.count.mockResolvedValue(1 as never)

      await loop.run(claim(), plan({ toolAllowlist: [] }))

      const messages = gateway.generateText.mock.calls[0]![0].messages
      expect(messages).toHaveLength(3)
      expect(messages[2].toolResults[0].output).toContain(AI_TOOL_REJECTION_NOTICE)
    })

    it('keeps the tool-result boundary + marker for prior rounds even when the allowlist is now empty (finding A2-2)', async () => {
      // A prior SUCCEEDED tool round exists, but the conversation now offers NO tools.
      prisma.aiRunStep.findMany.mockResolvedValue([
        { detail: { invocationId: 'inv1', toolCallId: 'call1' } },
      ] as never)
      prisma.aiToolInvocation.findMany.mockResolvedValue([
        { id: 'inv1', toolId: 'current_time', argsSnapshot: {}, resultSummary: { output: 'now' } },
      ] as never)
      prisma.aiRunStep.count.mockResolvedValue(1 as never)

      await loop.run(claim(), plan({ toolAllowlist: [] }))

      const call = gateway.generateText.mock.calls[0]![0]
      // No current tools are offered to the model, but the tool-result boundary policy IS applied…
      expect(call.tools).toBeUndefined()
      expect(call.system).toContain('Tool results are provided as JSON objects')
      // …and BOTH markers are scanned by the output guard — never an empty tool marker.
      expect(scanOutputMock).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({
          markers: ['amcore:user-data-x', expect.stringMatching(/^amcore:user-data-tool-/)],
        })
      )
      // The reconstructed tool-result turn is wrapped under that non-empty tool marker.
      const toolTurn = call.messages[2]
      expect(toolTurn.toolResults[0].output).toMatch(/amcore:user-data-tool-/)
    })
  })

  describe('gateway failures (Arc C mapping preserved)', () => {
    it('schedules a retry on a retryable gateway error', async () => {
      gateway.generateText.mockRejectedValue(AiGatewayException.providerUnavailable('MOCK'))
      await loop.run(claim(), plan())
      expect(repository.finalizeRetry).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'provider_unavailable'
      )
      expect(repository.finalizeFailed).not.toHaveBeenCalled()
    })

    it('terminally fails on a permanent gateway error', async () => {
      gateway.generateText.mockRejectedValue(AiGatewayException.providerRejected('MOCK'))
      await loop.run(claim(), plan())
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'provider_rejected'
      )
    })

    it('retries defensively on an unexpected non-gateway error', async () => {
      gateway.generateText.mockRejectedValue(new Error('boom'))
      await loop.run(claim(), plan())
      expect(repository.finalizeRetry).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'unknown_error'
      )
    })
  })

  describe('finalization atomicity', () => {
    it('rolls back the transcript and does not re-finalize when the terminal CAS loses the lease', async () => {
      repository.finalizeCompleted.mockResolvedValue(false)
      await loop.run(claim(), plan())
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'ai.run.finalize_lease_lost' }),
        expect.any(String)
      )
      expect(metrics.observeAiToolLoopSteps).not.toHaveBeenCalled()
    })

    it('leaves the run non-terminal for recovery when the finalize transaction fails', async () => {
      prisma.$transaction.mockRejectedValueOnce(new Error('db down') as never)
      await loop.run(claim(), plan())
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'ai.run.finalize_failed' }),
        expect.any(String)
      )
      expect(metrics.observeAiToolLoopSteps).not.toHaveBeenCalled()
    })
  })

  describe('ownership fence (ADR-049, Arc F)', () => {
    it('supersedes at the loop top — no provider call — when a human took over mid-loop', async () => {
      // The non-locking loop-top read sees the generation moved / control HUMAN.
      prisma.aiConversation.findUnique.mockResolvedValue({
        ownershipGeneration: 2,
        controlledBy: 'HUMAN',
        state: 'PAUSED_FOR_HUMAN',
      } as never)

      await loop.run(claim(), plan())

      expect(gateway.generateText).not.toHaveBeenCalled()
      expect(repository.finalizeSuperseded).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ id: 'run-1' })
      )
    })

    it('abandons the run superseded (no assistant turn, no COMPLETED) when takeover lands during the final write', async () => {
      // Loop-top read passes (fresh), but the in-tx FOR UPDATE fence sees the generation moved — the
      // success transaction rolls back and the run is CANCELLED/superseded instead of COMPLETED.
      prisma.$queryRaw.mockResolvedValue([
        { ownershipGeneration: 1, controlledBy: 'HUMAN', state: 'ACTIVE' },
      ] as never)

      await loop.run(claim(), plan())

      expect(gateway.generateText).toHaveBeenCalledTimes(1)
      expect(prisma.aiMessage.create).not.toHaveBeenCalled()
      expect(repository.finalizeCompleted).not.toHaveBeenCalled()
      expect(repository.finalizeSuperseded).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ id: 'run-1' })
      )
    })

    it('abandons superseded (not FAILED) when takeover lands during a policy-fail provider call', async () => {
      // > 1 tool call → the loop would normally FAIL too_many_tool_calls; a takeover during the call
      // fences the failure write → superseded instead, no stale FAILED terminal.
      gateway.generateText.mockResolvedValue(textResult({ toolCalls: [toolCall(), toolCall()] }))
      prisma.$queryRaw.mockResolvedValue([
        { ownershipGeneration: 1, controlledBy: 'HUMAN', state: 'ACTIVE' },
      ] as never)

      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))

      expect(repository.finalizeSuperseded).toHaveBeenCalled()
      expect(repository.finalizeFailed).not.toHaveBeenCalled()
    })

    it('stops before dispatching a SAFE tool when takeover lands during the provider call', async () => {
      // 1 SAFE call; the fenced recordProviderCall sees the takeover and stops the loop before dispatch.
      gateway.generateText.mockResolvedValue(textResult({ toolCalls: [toolCall()] }))
      prisma.$queryRaw.mockResolvedValue([
        { ownershipGeneration: 1, controlledBy: 'HUMAN', state: 'ACTIVE' },
      ] as never)

      await loop.run(claim(), plan({ toolAllowlist: ['current_time'] }))

      expect(dispatcher.dispatch).not.toHaveBeenCalled()
      expect(repository.finalizeSuperseded).toHaveBeenCalled()
    })
  })
})
