import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import { fixtureToolContract } from '../../../../test/fixtures/extension-contracts/tool-registration'
import { AiGatewayException } from '../gateway/ai-gateway.error'
import type { AiTextResult, AiToolCall } from '../gateway/ai-gateway.types'
import type { ModelGateway } from '../gateway/model-gateway.service'
import { scanOutput } from '../guardrails/output-guard'
import { AI_TOOL_REJECTION_NOTICE } from '../tools/ai-tool.constants'
import type { AiTool } from '../tools/ai-tool.types'
import type { AiToolRegistry } from '../tools/ai-tool-registry.service'

import type { AiRunApprovalParker } from './ai-run-approval-parker.service'
import type { ClaimedRun, StopCause } from './ai-run-dispatch.types'
import type { AiRunGuard } from './ai-run-guard.service'
import { AiRunLoopExecutor } from './ai-run-loop-executor.service'
import type { AiRunLoopFinalizer } from './ai-run-loop-finalizer.service'
import type { RunPlan } from './ai-run-plan'
import type { AiRunTransitions } from './ai-run-transitions.service'
import type { AiToolActionService } from './ai-tool-action.service'
import type { AiToolRecoveryService } from './ai-tool-recovery.service'

import type { EnvService } from '@/env/env.service'
import { AiToolInvocationStatus, AiToolRiskClass } from '@/generated/prisma/client'
import type { MetricsService } from '@/infrastructure/observability'
import { type AttemptRuntime, ShutdownLatch } from '@/infrastructure/worker-lifecycle'
import type { PrismaService } from '@/prisma'

// The output guard runs each step; mock it so tests drive allow/block deterministically and can assert
// EVERY active marker is scanned (invariant 5) without depending on the random per-run tool marker.
jest.mock('../guardrails/output-guard', () => ({
  __esModule: true,
  scanOutput: jest.fn(() => ({ verdict: 'allow', categories: [] })),
}))
const scanOutputMock = scanOutput as jest.Mock

/**
 * Unit tests for the bounded tool loop's ORCHESTRATION (Track C — ADR-054, Arc E.4b/E.5). The durable
 * writes (guarded transactions, CAS, history) are proved in the guard/finalizer/store specs and against
 * real Postgres in the e2e suites; here guard, finalizer, action service and recovery are mocked so each
 * loop decision is exercised in isolation: pending-action recovery BEFORE the model is asked, admission
 * before EVERY provider call (stop causes, lost lease, shutdown), the provider call's abort wiring, the
 * decision per response (final / policy failure / park / execute), step bound, output guard, and mapping
 * of provider failures — a caller abort is never an ordinary retry.
 */

function claim(over: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    modelSnapshot: { modelSlug: 'claude-default' },
    epoch: 1,
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
    assistantId: null,
    execution: {
      version: 1,
      modelId: 'model-fixture',
      providerId: 'provider-fixture',
      modelSlug: 'claude-default',
      providerSlug: 'anthropic',
      providerType: 'ANTHROPIC',
      providerModelName: 'claude',
      capabilities: {},
      contextLimit: null,
      maxOutputTokens: null,
      credentialSlot: 'default',
      endpoint: { kind: 'built_in' },
    },
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

function toolCall(toolName = 'current_time', input: unknown = {}): AiToolCall {
  return { toolCallId: 'call1', toolName, input }
}

const KNOWN_TOOLS: Record<string, AiTool> = {
  current_time: {
    toolId: 'current_time',
    displayName: 'Current time',
    description: 'time',
    parameters: z.object({}).strict(),
    ...fixtureToolContract(z.object({}).strict()),
    riskClass: AiToolRiskClass.SAFE,
    idempotency: 'read_only',
    execute: jest.fn(),
  },
  danger: {
    toolId: 'danger',
    displayName: 'Danger',
    description: 'danger',
    parameters: z.object({}).strict(),
    ...fixtureToolContract(z.object({}).strict()),
    riskClass: AiToolRiskClass.SENSITIVE,
    idempotency: 'idempotent',
    execute: jest.fn(),
  },
}

const ADMITTED = { kind: 'ok', value: undefined, stop: null }

describe('AiRunLoopExecutor', () => {
  let prisma: DeepMockProxy<PrismaService>
  let gateway: { generateText: jest.Mock }
  let guard: { admit: jest.Mock }
  let transitions: { stop: jest.Mock; retry: jest.Mock }
  let registry: { describeAllowed: jest.Mock; get: jest.Mock; requiresApproval: jest.Mock }
  let actions: { requestAction: jest.Mock; execute: jest.Mock }
  let recovery: { recover: jest.Mock }
  let finalizer: {
    success: jest.Mock
    afterProviderFailure: jest.Mock
    exhausted: jest.Mock
    outputBlocked: jest.Mock
    gatewayError: jest.Mock
    callerAborted: jest.Mock
  }
  let parker: { park: jest.Mock }
  let env: { get: jest.Mock }
  let metrics: { incAiGuardrailCheck: jest.Mock }
  let runtime: AttemptRuntime
  let sealController: AbortController
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
    prisma.aiRunStep.count.mockResolvedValue(0 as never)

    sealController = new AbortController()
    runtime = {
      attempt: { signal: sealController.signal, abort: jest.fn(), dispose: jest.fn() },
      onTransportStarted: jest.fn(),
    } as unknown as AttemptRuntime

    gateway = { generateText: jest.fn().mockResolvedValue(textResult()) }
    guard = { admit: jest.fn().mockResolvedValue(ADMITTED) }
    transitions = { stop: jest.fn().mockResolvedValue('applied'), retry: jest.fn() }
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
    actions = {
      requestAction: jest.fn().mockResolvedValue({ kind: 'ready', action: { id: 'inv-1' } }),
      execute: jest.fn().mockResolvedValue({
        status: 'succeeded',
        toolCallId: 'call1',
        input: {},
        output: '2026-01-01T00:00:00Z',
      }),
    }
    recovery = { recover: jest.fn().mockResolvedValue('proceed') }
    finalizer = {
      success: jest.fn().mockResolvedValue(undefined),
      afterProviderFailure: jest.fn().mockResolvedValue(undefined),
      exhausted: jest.fn().mockResolvedValue(undefined),
      outputBlocked: jest.fn().mockResolvedValue(undefined),
      gatewayError: jest.fn().mockResolvedValue(undefined),
      callerAborted: jest.fn().mockResolvedValue(undefined),
    }
    parker = { park: jest.fn().mockResolvedValue('parked') }
    env = {
      get: jest.fn((key: string) => (key === 'AI_REQUEST_TIMEOUT_MS' ? 60_000 : maxSteps)),
    }
    metrics = { incAiGuardrailCheck: jest.fn() }

    loop = new AiRunLoopExecutor(
      prisma,
      gateway as unknown as ModelGateway,
      guard as unknown as AiRunGuard,
      new ShutdownLatch({ warn: jest.fn() }, 'ai.run'),
      transitions as unknown as AiRunTransitions,
      registry as unknown as AiToolRegistry,
      actions as unknown as AiToolActionService,
      recovery as unknown as AiToolRecoveryService,
      finalizer as unknown as AiRunLoopFinalizer,
      parker as unknown as AiRunApprovalParker,
      env as unknown as EnvService,
      metrics as unknown as MetricsService,
      logger as never
    )
  })

  const run = (p: RunPlan = plan(), c: ClaimedRun = claim()) => loop.run(c, p, runtime)

  describe('shutdown seal', () => {
    it('a sealed dispatcher starts no transcript read and no provider call', async () => {
      const sealed = new ShutdownLatch({ warn: jest.fn() }, 'ai.run')
      sealed.seal()
      const sealedLoop = new AiRunLoopExecutor(
        prisma,
        gateway as unknown as ModelGateway,
        guard as unknown as AiRunGuard,
        sealed,
        transitions as unknown as AiRunTransitions,
        registry as unknown as AiToolRegistry,
        actions as unknown as AiToolActionService,
        recovery as unknown as AiToolRecoveryService,
        finalizer as unknown as AiRunLoopFinalizer,
        parker as unknown as AiRunApprovalParker,
        env as unknown as EnvService,
        metrics as unknown as MetricsService,
        logger as never
      )

      await sealedLoop.run(claim(), plan(), runtime)

      expect(prisma.aiRunStep.findMany).not.toHaveBeenCalled()
      expect(prisma.aiRunStep.count).not.toHaveBeenCalled()
      expect(gateway.generateText).not.toHaveBeenCalled()
    })
  })

  describe('final-text path (Arc C single-shot behavior when no tools apply)', () => {
    it('admits early, delegates final dispatch admission to the gateway, then finalizes', async () => {
      await run()

      expect(guard.admit).toHaveBeenCalledWith(expect.anything(), expect.any(Function), {})
      expect(gateway.generateText).toHaveBeenCalledTimes(1)
      expect(gateway.generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          modelSlug: 'claude-default',
          execution: expect.objectContaining({ version: 1 }),
          beforeDispatch: expect.any(Function),
          tools: undefined,
          recordUsage: false,
          abortSignal: expect.any(AbortSignal),
        })
      )
      expect(finalizer.success).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'run-1' }),
        expect.anything(),
        expect.objectContaining({ text: 'hello' }),
        expect.any(Number),
        1
      )
      expect(actions.requestAction).not.toHaveBeenCalled()
    })

    it('registers the physical provider call with the lane runtime (its slot is held until it settles)', async () => {
      await run()

      expect(runtime.onTransportStarted).toHaveBeenCalledTimes(1)
    })
  })

  describe('pending tool action is resolved BEFORE the model is asked again (E12)', () => {
    it('stops with no provider call when recovery terminalized the run', async () => {
      recovery.recover.mockResolvedValue('done')

      await run()

      expect(recovery.recover).toHaveBeenCalledTimes(1)
      expect(guard.admit).not.toHaveBeenCalled()
      expect(gateway.generateText).not.toHaveBeenCalled()
    })

    it('proceeds to the normal loop when nothing is pending or the action was applied', async () => {
      recovery.recover.mockResolvedValue('proceed')

      await run()

      expect(gateway.generateText).toHaveBeenCalledTimes(1)
    })
  })

  describe('admission before EVERY provider call', () => {
    it.each(['cancelled', 'superseded', 'expired'] as const)(
      '%s: terminalizes the stop and never calls the provider',
      async (cause: StopCause) => {
        guard.admit.mockResolvedValue({ kind: 'stopped', cause })

        await run()

        expect(transitions.stop).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'run-1' }),
          cause
        )
        expect(gateway.generateText).not.toHaveBeenCalled()
      }
    )

    it.each(['lease_lost', 'cutoff'] as const)(
      '%s: stops with no provider call and no write',
      async (kind) => {
        guard.admit.mockResolvedValue({ kind })

        await run()

        expect(gateway.generateText).not.toHaveBeenCalled()
        expect(transitions.stop).not.toHaveBeenCalled()
        expect(finalizer.success).not.toHaveBeenCalled()
      }
    )

    it('admits again before the NEXT provider call after a tool round (cancel between steps stops it)', async () => {
      registry.describeAllowed.mockImplementation(() => [])
      KNOWN_TOOLS.current_time!.parameters
      gateway.generateText
        .mockResolvedValueOnce(textResult({ toolCalls: [toolCall()], finishReason: 'tool_calls' }))
        .mockResolvedValueOnce(textResult())
      guard.admit
        .mockResolvedValueOnce(ADMITTED)
        .mockResolvedValueOnce({ kind: 'stopped', cause: 'cancelled' })

      await run(plan({ toolAllowlist: ['current_time'] }))

      expect(guard.admit).toHaveBeenCalledTimes(2)
      expect(gateway.generateText).toHaveBeenCalledTimes(1) // the second provider call never started
      expect(transitions.stop).toHaveBeenCalledWith(expect.anything(), 'cancelled')
    })
  })

  describe('provider-call abort wiring', () => {
    it('folds the REMAINING run lifetime into the abort signal: the call is aborted when the deadline passes', async () => {
      let signal: AbortSignal | undefined
      gateway.generateText.mockImplementation(async (request: { abortSignal: AbortSignal }) => {
        signal = request.abortSignal
        expect(signal.aborted).toBe(false) // still within its lifetime when the call starts
        await new Promise((resolve) => setTimeout(resolve, 60))
        return textResult()
      })

      await run(plan(), claim({ deadlineAt: new Date(Date.now() + 25) }))

      expect(signal?.aborted).toBe(true) // the deadline passed while the call was in flight
    })

    it('does not abort a healthy call (no deadline, not sealed)', async () => {
      let signal: AbortSignal | undefined
      gateway.generateText.mockImplementation(async (request: { abortSignal: AbortSignal }) => {
        signal = request.abortSignal
        return textResult()
      })

      await run()

      expect(signal?.aborted).toBe(false)
    })

    it('aborts the call when the shutdown seal fires', async () => {
      let signal: AbortSignal | undefined
      gateway.generateText.mockImplementation(async (request: { abortSignal: AbortSignal }) => {
        signal = request.abortSignal
        return textResult()
      })
      sealController.abort()

      await run()

      expect(signal?.aborted).toBe(true)
    })
  })

  describe('one tool call → durable action → loop → final text', () => {
    beforeEach(() => {
      gateway.generateText
        .mockResolvedValueOnce(textResult({ toolCalls: [toolCall()], finishReason: 'tool_calls' }))
        .mockResolvedValueOnce(textResult({ text: 'it is noon' }))
    })

    it('records the intent with the provider-call ordinal, executes it, then completes', async () => {
      await run(plan({ toolAllowlist: ['current_time'] }))

      expect(gateway.generateText).toHaveBeenCalledTimes(2)
      expect(gateway.generateText.mock.calls[0]![0].tools).toEqual([
        expect.objectContaining({ name: 'current_time' }),
      ])
      expect(gateway.generateText.mock.calls[0]![0].system).toContain('GUARD INSTRUCTION')
      expect(actions.requestAction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'run-1' }),
        expect.anything(),
        expect.objectContaining({ finishReason: 'tool_calls' }),
        expect.any(Number),
        1, // ordinal of the provider call that requested the action
        KNOWN_TOOLS.current_time,
        {} // the VALIDATED, normalized args = the frozen action input
      )
      expect(actions.execute).toHaveBeenCalledWith(
        expect.objectContaining({ claim: expect.objectContaining({ id: 'run-1' }) }),
        { id: 'inv-1' },
        KNOWN_TOOLS.current_time,
        'call1',
        {}
      )
      expect(finalizer.success).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ text: 'it is noon' }),
        expect.any(Number),
        2
      )
    })

    it('feeds the executed round back, echoing the action VALIDATED args (resume-identical transcript)', async () => {
      await run(plan({ toolAllowlist: ['current_time'] }))

      const second = gateway.generateText.mock.calls[1]![0].messages
      expect(second.some((m: { role: string }) => m.role === 'tool')).toBe(true)
      const assistant = second.find(
        (m: { role: string; toolCalls?: unknown[] }) => m.role === 'assistant' && m.toolCalls
      )
      expect(assistant.toolCalls[0]).toMatchObject({
        toolCallId: 'call1',
        toolName: 'current_time',
        input: {},
      })
    })

    it.each([
      ['terminal', { status: 'terminal' }],
      ['exit', { status: 'exit' }],
    ])('stops (no further provider call) when the action ends %s', async (_name, step) => {
      actions.execute.mockResolvedValue(step)

      await run(plan({ toolAllowlist: ['current_time'] }))

      expect(gateway.generateText).toHaveBeenCalledTimes(1)
      expect(finalizer.success).not.toHaveBeenCalled()
    })

    it.each([
      ['terminal', { kind: 'terminal' }],
      ['exit', { kind: 'exit' }],
    ])('does not execute when recording the intent ends %s', async (_name, intent) => {
      actions.requestAction.mockResolvedValue(intent)

      await run(plan({ toolAllowlist: ['current_time'] }))

      expect(actions.execute).not.toHaveBeenCalled()
      expect(gateway.generateText).toHaveBeenCalledTimes(1)
    })
  })

  describe('policy failures (non-retryable, one provider call recorded)', () => {
    it.each([
      ['too_many_tool_calls', [toolCall(), toolCall()], ['current_time']],
      ['tool_not_allowed', [toolCall('rm_rf')], ['current_time']],
      ['tool_not_allowed', [toolCall('current_time')], []], // registered but not on the allowlist
    ])(
      'fails %s without recording an action or executing',
      async (reason, toolCalls, allowlist) => {
        gateway.generateText.mockResolvedValue(
          textResult({ toolCalls, finishReason: 'tool_calls' })
        )

        await run(plan({ toolAllowlist: allowlist }))

        expect(finalizer.afterProviderFailure).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.any(Number),
          reason,
          1
        )
        expect(actions.requestAction).not.toHaveBeenCalled()
        expect(parker.park).not.toHaveBeenCalled()
      }
    )

    it('fails tool_args_invalid (no action, no park) when the call arguments do not parse', async () => {
      gateway.generateText.mockResolvedValue(
        textResult({
          toolCalls: [toolCall('current_time', { nope: 1 })],
          finishReason: 'tool_calls',
        })
      )

      await run(plan({ toolAllowlist: ['current_time'] }))

      expect(finalizer.afterProviderFailure).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.any(Number),
        'tool_args_invalid',
        1
      )
      expect(actions.requestAction).not.toHaveBeenCalled()
    })
  })

  describe('approval park (Arc E.5)', () => {
    it('PARKS an allowed non-SAFE call with its provider-call ordinal; never executes it inline', async () => {
      gateway.generateText.mockResolvedValue(
        textResult({ toolCalls: [toolCall('danger')], finishReason: 'tool_calls' })
      )

      await run(plan({ toolAllowlist: ['danger'] }))

      expect(parker.park).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'run-1' }),
        expect.anything(),
        expect.anything(),
        expect.any(Number),
        1,
        KNOWN_TOOLS.danger,
        {}
      )
      expect(actions.requestAction).not.toHaveBeenCalled()
      expect(actions.execute).not.toHaveBeenCalled()
      expect(gateway.generateText).toHaveBeenCalledTimes(1)
    })

    it('fails tool_args_invalid (not park) when a non-SAFE call has invalid arguments', async () => {
      gateway.generateText.mockResolvedValue(
        textResult({ toolCalls: [toolCall('danger', { x: 1 })], finishReason: 'tool_calls' })
      )

      await run(plan({ toolAllowlist: ['danger'] }))

      expect(parker.park).not.toHaveBeenCalled()
      expect(finalizer.afterProviderFailure).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.any(Number),
        'tool_args_invalid',
        1
      )
    })
  })

  describe('bounds', () => {
    it('fails tool_loop_exhausted once the provider-step bound is hit mid-loop', async () => {
      maxSteps = 2
      gateway.generateText.mockResolvedValue(
        textResult({ toolCalls: [toolCall()], finishReason: 'tool_calls' })
      )

      await run(plan({ toolAllowlist: ['current_time'] }))

      expect(gateway.generateText).toHaveBeenCalledTimes(2)
      expect(finalizer.exhausted).toHaveBeenCalledWith(expect.anything(), 2)
    })

    it('exhausts immediately (no provider call) when persisted PROVIDER_CALL steps already meet the bound', async () => {
      maxSteps = 3
      prisma.aiRunStep.count.mockResolvedValue(3 as never)

      await run()

      expect(gateway.generateText).not.toHaveBeenCalled()
      expect(finalizer.exhausted).toHaveBeenCalledWith(expect.anything(), 3)
    })
  })

  describe('output guard (each step, every active marker)', () => {
    it('scans BOTH the user-input marker and the tool-result marker when tools are offered', async () => {
      await run(plan({ toolAllowlist: ['current_time'] }))

      const markers = scanOutputMock.mock.calls[0]![1].markers as string[]
      expect(markers).toHaveLength(2)
      expect(markers[0]).toBe('amcore:user-data-x')
      expect(markers[1]).toContain('tool-')
    })

    it('scans only the user marker when no tools apply', async () => {
      await run()

      expect(scanOutputMock.mock.calls[0]![1].markers).toEqual(['amcore:user-data-x'])
    })

    it('discards the output and finalizes a safe refusal on a block verdict', async () => {
      scanOutputMock.mockReturnValue({
        verdict: 'block',
        categories: [{ category: 'envelope_marker_abuse', count: 1 }],
      })

      await run()

      expect(finalizer.outputBlocked).toHaveBeenCalledWith(
        expect.anything(),
        [{ category: 'envelope_marker_abuse', count: 1 }],
        1,
        expect.objectContaining({ modelSlug: 'claude-default' }),
        expect.objectContaining({ modelId: 'model-fixture', usage: expect.any(Object) })
      )
      expect(finalizer.success).not.toHaveBeenCalled()
    })
  })

  describe('crash-safe resume reconstruction', () => {
    it('replays only APPLIED (SUCCEEDED/REJECTED) invocations, in step order (invariant 7)', async () => {
      prisma.aiRunStep.findMany.mockResolvedValue([
        { detail: { invocationId: 'inv-ok', toolCallId: 'c-ok' } },
        { detail: { invocationId: 'inv-missing', toolCallId: 'c-missing' } },
      ] as never)
      prisma.aiToolInvocation.findMany.mockResolvedValue([
        {
          id: 'inv-ok',
          toolId: 'current_time',
          status: AiToolInvocationStatus.SUCCEEDED,
          argsSnapshot: {},
          resultSummary: { output: 'noon' },
        },
      ] as never)

      await run(plan({ toolAllowlist: ['current_time'] }))

      const messages = gateway.generateText.mock.calls[0]![0].messages
      expect(messages.filter((m: { role: string }) => m.role === 'tool')).toHaveLength(1)
    })

    it('replays a REJECTED invocation as the fixed rejection notice (Arc E.5)', async () => {
      prisma.aiRunStep.findMany.mockResolvedValue([
        { detail: { invocationId: 'inv-rej', toolCallId: 'c-rej' } },
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

      await run(plan({ toolAllowlist: ['danger'] }))

      const tool = gateway.generateText.mock.calls[0]![0].messages.find(
        (m: { role: string }) => m.role === 'tool'
      )
      expect(tool.toolResults[0].output).toContain(AI_TOOL_REJECTION_NOTICE)
    })

    it('keeps the tool-result boundary + marker for prior rounds even when the allowlist is now empty', async () => {
      prisma.aiRunStep.findMany.mockResolvedValue([
        { detail: { invocationId: 'inv-ok', toolCallId: 'c-ok' } },
      ] as never)
      prisma.aiToolInvocation.findMany.mockResolvedValue([
        {
          id: 'inv-ok',
          toolId: 'current_time',
          status: AiToolInvocationStatus.SUCCEEDED,
          argsSnapshot: {},
          resultSummary: { output: 'noon' },
        },
      ] as never)

      await run(plan({ toolAllowlist: [] }))

      const request = gateway.generateText.mock.calls[0]![0]
      expect(request.tools).toBeUndefined()
      expect(request.system).toContain('amcore:user-data-tool-')
      expect(scanOutputMock.mock.calls[0]![1].markers).toHaveLength(2)
    })
  })

  describe('provider failures (Arc C mapping preserved; a caller abort is never an ordinary retry)', () => {
    it('hands a gateway error to the finalizer mapping (retryable / permanent / unknown)', async () => {
      const error = AiGatewayException.providerUnavailable('MOCK' as never)
      gateway.generateText.mockRejectedValue(error)

      await run()

      expect(finalizer.gatewayError).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'run-1' }),
        error,
        expect.objectContaining({ modelSlug: 'claude-default' })
      )
      expect(finalizer.success).not.toHaveBeenCalled()
    })

    it('a deadline abort terminalizes via the stop path, NOT as a provider retry', async () => {
      gateway.generateText.mockRejectedValue(AiGatewayException.aborted('MOCK' as never))

      await run()

      expect(finalizer.callerAborted).toHaveBeenCalledWith(expect.anything(), 'deadline')
      expect(finalizer.gatewayError).not.toHaveBeenCalled()
      expect(transitions.retry).not.toHaveBeenCalled()
    })

    it('a shutdown-seal abort is reported as shutdown (the finalizer writes nothing)', async () => {
      sealController.abort()
      gateway.generateText.mockRejectedValue(AiGatewayException.aborted('MOCK' as never))

      await run()

      expect(finalizer.callerAborted).toHaveBeenCalledWith(expect.anything(), 'shutdown')
    })

    it('an adapter that ignores abort is bounded locally and retried as a provider timeout', async () => {
      jest.useFakeTimers()
      try {
        gateway.generateText.mockReturnValue(new Promise(() => undefined)) // never settles
        transitions.retry.mockResolvedValue({ state: 'retry_scheduled' })

        const pending = run()
        await jest.advanceTimersByTimeAsync(60_000 + 2_001)
        await pending

        expect(transitions.retry).toHaveBeenCalledWith(expect.anything(), 'provider_timeout')
        expect(runtime.onTransportStarted).toHaveBeenCalledTimes(1) // the slot stays held until it settles
      } finally {
        jest.useRealTimers()
      }
    })
  })
})
