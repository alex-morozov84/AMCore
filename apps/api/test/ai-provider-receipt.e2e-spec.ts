import { jest } from '@jest/globals'
import { z } from 'zod'

import { Prisma } from '../src/generated/prisma/client'
import { AI_PROVIDER_ADAPTERS } from '../src/infrastructure/ai/gateway/ai-gateway.types'
import { ModelGateway } from '../src/infrastructure/ai/gateway/model-gateway.service'
import { providerReceipt } from '../src/infrastructure/ai/gateway/provider-receipt'
import { aiExecutionDescriptorSchema } from '../src/infrastructure/ai/registry/ai-execution-descriptor'
import { AiModelRegistry } from '../src/infrastructure/ai/registry/ai-model-registry.service'
import { AiRunLoopFinalizer } from '../src/infrastructure/ai/runs/ai-run-loop-finalizer.service'
import type { RunPlan } from '../src/infrastructure/ai/runs/ai-run-plan'
import { MetricsService } from '../src/infrastructure/observability'
import { type AppRedisClient, REDIS_CLIENT } from '../src/infrastructure/redis'

import {
  consistencyRepository,
  queuedConsistencyRun,
  resetConsistencyData,
  stopConsistencyWake,
} from './fixtures/ai-consistency-context'
import { ControllableAdapter, controls } from './fixtures/ai-run-controls'
import {
  drainConsistency,
  sdkAdapters,
  sdkFixture,
  selectSdkModel,
} from './fixtures/ai-sdk-consistency'
import { type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

describe('observed provider receipt and atomic durable accounting (PG + installed SDK)', () => {
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
    sdkFixture.reset()
    await resetConsistencyData(context)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('selects through bounded PG fallback during catalogue Redis outage without spending a retry', async () => {
    await selectSdkModel(context)
    await context.app.get(AiModelRegistry).invalidate()
    const redis = context.app.get<AppRedisClient>(REDIS_CLIENT, { strict: false })
    const originalOptions = redis.withCommandOptions.bind(redis)
    const cacheTransport = jest.fn(async () => {
      throw new Error('fixture catalogue Redis unavailable')
    })
    jest.spyOn(redis, 'withCommandOptions').mockImplementation(
      (options) =>
        new Proxy(originalOptions(options), {
          get(target, key): unknown {
            if (key === 'eval') return cacheTransport
            const value = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
    )
    const starts = jest.spyOn(context.prisma.observedTransactions('ai-catalogue'), 'start')
    const { run } = await queuedConsistencyRun(context)
    await drainConsistency(context)
    const settled = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(settled.status).toBe('COMPLETED')
    expect(settled.attemptCount).toBe(0)
    expect(starts).toHaveBeenCalledTimes(1)
    expect(cacheTransport).toHaveBeenCalledTimes(1)
    expect(sdkFixture.calls).toHaveLength(1)
    expect(await context.prisma.aiUsageLedger.count({ where: { runId: run.id } })).toBe(1)
  })

  it.each(['complete', 'partial', 'unavailable', 'estimated'] as const)(
    'blocked output settles one safe receipt, usage %s and canned refusal',
    async (availability) => {
      if (availability !== 'estimated') await selectSdkModel(context)
      const { run, conversation } = await queuedConsistencyRun(context)
      if (availability === 'estimated') {
        await context.prisma.aiMessage.updateMany({
          where: { runId: run.id, role: 'USER' },
          data: { content: [{ type: 'text', text: '__mock_leak__' }] },
        })
      } else {
        sdkFixture.finish = 'content_filter'
        sdkFixture.content = 'blocked-provider-sentinel'
        sdkFixture.usage =
          availability === 'complete'
            ? { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
            : availability === 'partial'
              ? { prompt_tokens: 0 }
              : undefined
      }
      await drainConsistency(context)
      const settled = await context.prisma.aiRun.findUniqueOrThrow({
        where: { id: run.id },
        include: { steps: true },
      })
      expect(settled.status).toBe('FAILED')
      expect(settled.steps.filter((step) => step.type === 'PROVIDER_CALL')).toHaveLength(1)
      const rows = await context.prisma.aiUsageLedger.findMany({ where: { runId: run.id } })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.usageVersion).toBe(2)
      expect(rows[0]!.providerReportedUsage).toMatchObject({
        source:
          availability === 'estimated'
            ? 'estimated'
            : availability === 'unavailable'
              ? 'unavailable'
              : 'reported',
        availability: availability === 'estimated' ? 'complete' : availability,
      })
      const messages = await context.prisma.aiMessage.findMany({
        where: { conversationId: conversation.id },
      })
      expect(messages.filter((message) => message.role === 'ASSISTANT')).toHaveLength(1)
      expect(JSON.stringify({ messages, rows, steps: settled.steps })).not.toContain(
        'blocked-provider-sentinel'
      )
      expect(JSON.stringify(messages)).not.toContain('amcore:user-data-leaked')
    }
  )

  it.each(['cancel', 'takeover', 'deadline'] as const)(
    'visible %s after response wins but observed spend remains',
    async (stop) => {
      await selectSdkModel(context)
      const { run, conversation } = await queuedConsistencyRun(context)
      sdkFixture.finish = 'content_filter'
      sdkFixture.afterResponse = async () => {
        if (stop === 'cancel')
          await context.prisma.aiRun.update({
            where: { id: run.id },
            data: { cancellationRequestedAt: new Date() },
          })
        if (stop === 'takeover')
          await context.prisma.aiConversation.update({
            where: { id: conversation.id },
            data: { ownershipGeneration: { increment: 1 }, controlledBy: 'HUMAN' },
          })
        if (stop === 'deadline')
          await context.prisma.aiRun.update({
            where: { id: run.id },
            data: { deadlineAt: new Date(Date.now() - 1000) },
          })
      }
      await drainConsistency(context)
      const settled = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
      expect(settled.status).toBe(stop === 'deadline' ? 'EXPIRED' : 'CANCELLED')
      expect(await context.prisma.aiUsageLedger.count({ where: { runId: run.id } })).toBe(1)
      expect(
        await context.prisma.aiMessage.count({ where: { runId: run.id, role: 'ASSISTANT' } })
      ).toBe(0)
    }
  )

  it.each(['text', 'object'] as const)(
    'direct gateway %s records observed refusal/validation usage-v2',
    async (operation) => {
      await selectSdkModel(context)
      sdkFixture.finish = operation === 'text' ? 'content_filter' : 'stop'
      sdkFixture.content = operation === 'text' ? 'blocked-sentinel' : 'not valid json'
      const request = {
        modelSlug: 'fixture-model',
        messages: [{ role: 'user' as const, content: 'hello' }],
      }
      const gateway = context.app.get(ModelGateway)
      const promise =
        operation === 'text'
          ? gateway.generateText(request)
          : gateway.generateObject(request, z.object({ answer: z.string() }))
      const error = await promise.catch((value: unknown) => value)
      expect(providerReceipt(error)).toMatchObject({ usage: { inputTokens: 8, outputTokens: 4 } })
      expect(JSON.stringify(error)).not.toContain('blocked-sentinel')
      const ledger = await context.prisma.aiUsageLedger.findMany()
      expect(ledger).toHaveLength(1)
      expect(ledger[0]!.usageVersion).toBe(2)
    }
  )

  it('direct structured gateway rejects valid filtered JSON with one safe usage row and error outcome', async () => {
    await selectSdkModel(context)
    const sentinel = 'filtered-schema-valid-object-sentinel'
    sdkFixture.content = JSON.stringify({ answer: sentinel })
    sdkFixture.finish = 'content_filter'
    const outcomes = jest.spyOn(context.app.get(MetricsService), 'incAiGeneration')
    const error = await context.app
      .get(ModelGateway)
      .generateObject(
        { modelSlug: 'fixture-model', messages: [{ role: 'user', content: 'hello' }] },
        z.object({ answer: z.string() })
      )
      .catch((value: unknown) => value)
    expect(error).toMatchObject({ code: 'content_filtered' })
    expect(providerReceipt(error)).toMatchObject({ finishReason: 'content_filtered' })
    expect(outcomes.mock.calls).toEqual([['openai_compatible', 'object', 'error']])
    const ledger = await context.prisma.aiUsageLedger.findMany()
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      usageVersion: 2,
      providerReportedUsage: {
        source: 'reported',
        availability: 'complete',
        inputTokens: 8,
        outputTokens: 4,
        totalTokens: 12,
      },
    })
    expect(sdkFixture.calls).toHaveLength(1)
    const messages = await context.prisma.aiMessage.findMany()
    const steps = await context.prisma.aiRunStep.findMany()
    expect(messages).toHaveLength(0)
    expect(steps).toHaveLength(0)
    expect(
      JSON.stringify({ error, receipt: providerReceipt(error), ledger, messages, steps })
    ).not.toContain(sentinel)
  })

  it.each(['duplicate', 'rollback', 'stale'] as const)(
    'receipt settlement handles %s without double spend or partial writes',
    async (boundary) => {
      await selectSdkModel(context)
      const { run } = await queuedConsistencyRun(context)
      const [claim] = await consistencyRepository(context).claimDueBatch()
      const execution = aiExecutionDescriptorSchema.parse(run.modelSnapshot)
      const plan: RunPlan = {
        execution,
        modelSlug: execution.modelSlug,
        assistantId: null,
        system: '',
        userMessages: [],
        marker: 'fixture',
        toolAllowlist: [],
        inputFlagCategories: [],
        attribution: { userId: null, organizationId: null },
      }
      sdkFixture.finish = 'content_filter'
      const error = await context.app
        .get(ModelGateway)
        .generateText({
          execution,
          messages: [{ role: 'user', content: 'hello' }],
          recordUsage: false,
        })
        .catch((value: unknown) => value)
      expect(providerReceipt(error)).toBeDefined()
      const finalizer = context.app.get(AiRunLoopFinalizer)
      if (boundary === 'rollback') {
        const original = context.prisma.$transaction.bind(context.prisma)
        const spy = jest.spyOn(context.prisma, '$transaction').mockImplementation((async (
          operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: unknown
        ) =>
          original(async (tx) => {
            await operation(tx)
            throw new Error('receipt rollback fixture')
          }, options as never)) as never)
        try {
          const failure = await finalizer.gatewayError(claim!, error, plan).then(
            () => null,
            (value: unknown) => value
          )
          if (!(failure instanceof Error) || failure.message !== 'receipt rollback fixture')
            throw new Error('missing injected rollback')
        } finally {
          spy.mockRestore()
        }
      }
      expect(await context.prisma.aiUsageLedger.count({ where: { runId: run.id } })).toBe(0)
      expect(await context.prisma.aiRunStep.count({ where: { runId: run.id } })).toBe(0)
      if (boundary === 'stale')
        await context.prisma.aiRun.update({
          where: { id: run.id },
          data: { leaseEpoch: { increment: 1 } },
        })
      await Promise.all([
        finalizer.gatewayError(claim!, error, plan),
        finalizer.gatewayError(claim!, error, plan),
      ])
      expect(await context.prisma.aiUsageLedger.count({ where: { runId: run.id } })).toBe(
        boundary === 'stale' ? 0 : 1
      )
      expect(
        await context.prisma.aiRunStep.count({ where: { runId: run.id, type: 'PROVIDER_CALL' } })
      ).toBe(boundary === 'stale' ? 0 : 1)
    }
  )
})
