import { AiProviderType } from '@prisma/client'
import { z } from 'zod'

import type { AiModelRegistry } from '../registry/ai-model-registry.service'
import type { ResolvedAiModel } from '../registry/ai-registry.types'

import type { AiAdapterCall, AiProviderAdapter } from './ai-gateway.types'
import type { AiCredentialResolver } from './credential-resolver'
import { ModelGateway } from './model-gateway.service'
import { MockAiAdapter } from './providers/mock.adapter'

import type { EnvService } from '@/env/env.service'

/**
 * Unit tests for the ModelGateway seam (Track C — ADR-054, Arc B): model resolution, the central
 * credential gate, adapter dispatch, and error normalization into the bounded taxonomy.
 */

function model(over: Partial<ResolvedAiModel> = {}): ResolvedAiModel {
  return {
    slug: 'mock-default',
    providerModelName: 'mock',
    capabilities: { text: true },
    contextLimit: null,
    maxOutputTokens: null,
    isDefault: true,
    provider: {
      slug: 'mock',
      type: AiProviderType.MOCK,
      baseUrl: null,
      credentialSlot: null,
      dataRetentionClass: 'provider_default',
      config: null,
    },
    ...over,
  }
}

const env = { get: () => 60000 } as unknown as EnvService
const logger = { setContext: jest.fn(), warn: jest.fn() }
const usageLedger = { record: jest.fn() }
const metrics = { incAiGeneration: jest.fn(), incAiTokens: jest.fn() }

beforeEach(() => jest.clearAllMocks())

function makeGateway(
  registry: Partial<AiModelRegistry>,
  adapters: AiProviderAdapter[] = [new MockAiAdapter()]
): ModelGateway {
  const credentials = { getCredential: () => null } as unknown as AiCredentialResolver
  return new ModelGateway(
    adapters,
    registry as AiModelRegistry,
    credentials,
    env,
    logger as never,
    usageLedger as never,
    metrics as never
  )
}

describe('ModelGateway.generateText', () => {
  it('resolves the gated default and dispatches to the mock adapter', async () => {
    const gateway = makeGateway({
      resolveDefaultModel: jest.fn(async () => model()),
      hasCredential: () => true,
    })
    const result = await gateway.generateText({ messages: [{ role: 'user', content: 'hi' }] })
    expect(result.text).toBe('[mock:mock] hi')
  })

  it('records usage and a success metric after a generation', async () => {
    const gateway = makeGateway({
      resolveDefaultModel: jest.fn(async () => model()),
      hasCredential: () => true,
    })
    await gateway.generateText({
      messages: [{ role: 'user', content: 'hi' }],
      context: { userId: 'u1' },
    })
    expect(usageLedger.record).toHaveBeenCalledWith(
      expect.objectContaining({ modelSlug: 'mock-default', context: { userId: 'u1' } })
    )
    expect(metrics.incAiGeneration).toHaveBeenCalledWith('mock', 'text', 'success')
    expect(metrics.incAiTokens).toHaveBeenCalledWith('mock', 'input', expect.any(Number))
  })

  it('records an error metric and skips usage recording on provider failure', async () => {
    const gateway = makeGateway({
      resolveDefaultModel: jest.fn(async () => model()),
      hasCredential: () => true,
    })
    await expect(
      gateway.generateText({ messages: [{ role: 'user', content: '__mock_error__' }] })
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
    expect(metrics.incAiGeneration).toHaveBeenCalledWith('mock', 'text', 'error')
    expect(usageLedger.record).not.toHaveBeenCalled()
  })

  it('never logs prompt content on a provider failure (only provider type + model slug)', async () => {
    const gateway = makeGateway({
      resolveDefaultModel: jest.fn(async () => model()),
      hasCredential: () => true,
    })
    await expect(
      gateway.generateText({ messages: [{ role: 'user', content: '__mock_error__' }] })
    ).rejects.toBeDefined()
    const warnArg = logger.warn.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(warnArg).sort()).toEqual(['modelSlug', 'providerType'])
  })

  it('resolves an explicit slug', async () => {
    const resolveModel = jest.fn(async () => model({ slug: 'mock-default' }))
    const gateway = makeGateway({ resolveModel, hasCredential: () => true })
    await gateway.generateText({
      modelSlug: 'mock-default',
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(resolveModel).toHaveBeenCalledWith('mock-default')
  })

  it('throws model_not_found for an unknown explicit slug', async () => {
    const gateway = makeGateway({ resolveModel: jest.fn(async () => null) })
    await expect(
      gateway.generateText({ modelSlug: 'nope', messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toMatchObject({ code: 'model_not_found', retryable: false })
  })

  it('throws no_default_model when no default resolves', async () => {
    const gateway = makeGateway({ resolveDefaultModel: jest.fn(async () => null) })
    await expect(
      gateway.generateText({ messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toMatchObject({ code: 'no_default_model' })
  })

  it('throws model_not_configured when the model has no usable credential (central gate)', async () => {
    const gateway = makeGateway({
      resolveModel: jest.fn(async () =>
        model({ provider: { ...model().provider, type: AiProviderType.ANTHROPIC } })
      ),
      hasCredential: () => false,
    })
    await expect(
      gateway.generateText({
        modelSlug: 'claude-default',
        messages: [{ role: 'user', content: 'x' }],
      })
    ).rejects.toMatchObject({ code: 'model_not_configured' })
  })

  it('throws model_not_configured when no adapter is registered for the provider type', async () => {
    const gateway = makeGateway(
      { resolveDefaultModel: jest.fn(async () => model()), hasCredential: () => true },
      [] // no adapters
    )
    await expect(
      gateway.generateText({ messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toMatchObject({ code: 'model_not_configured' })
  })

  it('normalizes a raw adapter failure to provider_unavailable (retryable)', async () => {
    const gateway = makeGateway({
      resolveDefaultModel: jest.fn(async () => model()),
      hasCredential: () => true,
    })
    await expect(
      gateway.generateText({ messages: [{ role: 'user', content: '__mock_error__' }] })
    ).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true })
  })

  it('passes a typed adapter refusal through unchanged', async () => {
    const gateway = makeGateway({
      resolveDefaultModel: jest.fn(async () => model()),
      hasCredential: () => true,
    })
    await expect(
      gateway.generateText({ messages: [{ role: 'user', content: '__mock_refusal__' }] })
    ).rejects.toMatchObject({ code: 'content_filtered' })
  })

  it('fails fast at construction if two adapters claim the same provider type', () => {
    expect(() => makeGateway({}, [new MockAiAdapter(), new MockAiAdapter()])).toThrow(
      /Duplicate AI provider adapter/
    )
  })
})

describe('ModelGateway.generateObject', () => {
  const schema = z.object({ ok: z.boolean() })

  it('rejects a model that does not declare the structured_output capability', async () => {
    const gateway = makeGateway({
      resolveDefaultModel: jest.fn(async () => model({ capabilities: { text: true } })),
      hasCredential: () => true,
    })
    await expect(
      gateway.generateObject({ messages: [{ role: 'user', content: 'x' }] }, schema)
    ).rejects.toMatchObject({ code: 'capability_unsupported' })
  })

  it('rejects when the adapter does not implement generateObject (mock)', async () => {
    const gateway = makeGateway({
      resolveDefaultModel: jest.fn(async () =>
        model({ capabilities: { text: true, structured_output: true } })
      ),
      hasCredential: () => true,
    })
    await expect(
      gateway.generateObject({ messages: [{ role: 'user', content: 'x' }] }, schema)
    ).rejects.toMatchObject({ code: 'capability_unsupported' })
  })

  it('dispatches to an adapter that supports structured output', async () => {
    const objectAdapter = {
      supportedTypes: [AiProviderType.MOCK],
      generateText: jest.fn(),
      generateObject: jest.fn(async (_call: AiAdapterCall) => ({
        object: { ok: true },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        modelSlug: 'mock-default',
        providerType: AiProviderType.MOCK,
      })),
    } as unknown as AiProviderAdapter
    const gateway = makeGateway(
      {
        resolveDefaultModel: jest.fn(async () =>
          model({ capabilities: { text: true, structured_output: true } })
        ),
        hasCredential: () => true,
      },
      [objectAdapter]
    )
    const result = await gateway.generateObject(
      { messages: [{ role: 'user', content: 'x' }] },
      schema
    )
    expect(result.object).toEqual({ ok: true })
  })
})
