import { jest } from '@jest/globals'

import { AI_PROVIDER_ADAPTERS } from '../src/infrastructure/ai/gateway/ai-gateway.types'
import { AiCredentialResolver } from '../src/infrastructure/ai/gateway/credential-resolver'
import { ModelGateway } from '../src/infrastructure/ai/gateway/model-gateway.service'
import { AiModelRegistry } from '../src/infrastructure/ai/registry/ai-model-registry.service'
import { MetricsService } from '../src/infrastructure/observability'

import {
  queuedConsistencyRun,
  resetConsistencyData,
  stopConsistencyWake,
} from './fixtures/ai-consistency-context'
import { ControllableAdapter } from './fixtures/ai-run-controls'
import {
  drainConsistency,
  sdkAdapters,
  sdkFixture,
  selectSdkModel,
} from './fixtures/ai-sdk-consistency'
import { type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

/** Existing provider registration recipe, primary catalog and real installed SDK with fake fetch. */
describe('Provider extension conformance (PostgreSQL + SDK)', () => {
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
    if (context) await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    sdkFixture.reset()
    await resetConsistencyData(context)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each(['OPENAI_COMPATIBLE', 'ANTHROPIC'] as const)(
    '%s preserves frozen wire identity, rotates the live credential and settles one receipt',
    async (family) => {
      const { provider, model, rotate } = await selectSdkModel(context, family)
      const { run } = await queuedConsistencyRun(context)
      await context.prisma.aiModel.update({
        where: { id: model.id },
        data: {
          providerModelName: 'changed-wire-model',
          maxOutputTokens: 999,
        },
      })
      rotate()
      await drainConsistency(context)
      expect(sdkFixture.calls).toHaveLength(1)
      const call = sdkFixture.calls[0]!
      expect(call.body.model).toBe('wire-a')
      expect(call.url).toBe(
        family === 'ANTHROPIC'
          ? 'https://api.anthropic.com/v1/messages'
          : 'https://fixture.example/v1/chat/completions'
      )
      expect(call.headers.get(family === 'ANTHROPIC' ? 'x-api-key' : 'authorization')).toBe(
        family === 'ANTHROPIC' ? '<fixture-credential-b>' : 'Bearer <fixture-credential-b>'
      )
      expect(call.redirect).toBe('error')
      const ledger = await context.prisma.aiUsageLedger.findMany({ where: { runId: run.id } })
      expect(ledger).toHaveLength(1)
      expect(ledger[0]).toMatchObject({ usageVersion: 2, modelSlug: 'fixture-model' })
      const stored = await context.prisma.aiRun.findUniqueOrThrow({
        where: { id: run.id },
        include: { steps: true },
      })
      expect(stored.status).toBe('COMPLETED')
      expect(stored.modelSnapshot).toMatchObject({
        providerType: family,
        providerId: provider.id,
        modelId: model.id,
      })
      expect(JSON.stringify({ stored, ledger })).not.toContain('<fixture-credential-')
      const metrics = await context.app.get(MetricsService).metrics()
      expect(metrics).not.toContain('<fixture-credential-')
      expect(metrics).not.toContain('fixture-provider')
      expect(metrics).not.toContain('fixture-model')
    }
  )

  it.each(['OPENAI_COMPATIBLE', 'ANTHROPIC'] as const)(
    '%s revocation after queueing refuses before SDK fetch',
    async (family) => {
      const { provider } = await selectSdkModel(context, family)
      const { run } = await queuedConsistencyRun(context)
      await context.prisma.aiProvider.update({
        where: { id: provider.id },
        data: { enabled: false },
      })
      await drainConsistency(context)
      expect(sdkFixture.calls).toHaveLength(0)
      expect((await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
        'FAILED'
      )
      expect(await context.prisma.aiUsageLedger.count({ where: { runId: run.id } })).toBe(0)
    }
  )

  it('does not turn a catalog credentialSlot into an arbitrary environment read', async () => {
    const { provider } = await selectSdkModel(context)
    await context.prisma.aiProvider.update({
      where: { id: provider.id },
      data: { credentialSlot: 'JWT_SECRET' },
    })
    const resolver = context.app.get(AiCredentialResolver)
    expect(resolver.resolveEnvKey('OPENAI_COMPATIBLE', 'JWT_SECRET')).toBeNull()
    await context.app.get(AiModelRegistry).invalidate()
    const registry = context.app.get(AiModelRegistry)
    const candidate = await registry.resolveModel('fixture-model')
    expect(candidate).not.toBeNull()
    expect(registry.hasCredential(candidate!)).toBe(false)
    expect((await registry.resolveDefaultModel())?.provider.type).toBe('MOCK')
    await expect(
      context.app.get(ModelGateway).generateText({
        modelSlug: 'fixture-model',
        messages: [{ role: 'user', content: 'fixture' }],
      })
    ).rejects.toThrow()
    expect(sdkFixture.calls).toHaveLength(0)
  })

  it('honors caller cancellation before any provider request', async () => {
    await selectSdkModel(context)
    const controller = new AbortController()
    controller.abort()
    await expect(
      context.app.get(ModelGateway).generateText({
        messages: [{ role: 'user', content: 'fixture' }],
        abortSignal: controller.signal,
      })
    ).rejects.toThrow()
    expect(sdkFixture.calls).toHaveLength(0)
  })
})
