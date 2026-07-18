import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { AiCredentialResolver } from '../gateway/credential-resolver'

import { AiModelRegistry } from './ai-model-registry.service'

import type { EnvService } from '@/env/env.service'
import { AiProviderType } from '@/generated/prisma/client'
import type { MetricsService } from '@/infrastructure/observability'
import type { AppRedisClient } from '@/infrastructure/redis'
import type { PrismaService } from '@/prisma'

/**
 * Unit tests for the DB-backed model registry (Track C — ADR-054, Arc B): cache-aside snapshot
 * behavior and the credential-gated default selection with mock fallback (the A.3 requirement).
 */

function fakeRedis(): AppRedisClient & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v)
    }),
    del: jest.fn(async (k: string) => {
      store.delete(k)
    }),
  } as unknown as AppRedisClient & { store: Map<string, string> }
}

function makeEnv(values: Record<string, unknown>): EnvService {
  return { get: (k: string) => values[k] } as unknown as EnvService
}

const noopLogger = { setContext: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() }

function modelRow(over: Record<string, unknown>): unknown {
  return {
    slug: 'm',
    providerModelName: 'pm',
    capabilities: { text: true },
    contextLimit: null,
    maxOutputTokens: null,
    isDefault: false,
    enabled: true,
    ...over,
  }
}

function providerRow(type: AiProviderType, slug: string, models: unknown[], over = {}): unknown {
  return {
    slug,
    type,
    baseUrl: null,
    credentialSlot: type === AiProviderType.MOCK ? null : 'default',
    dataRetentionClass: 'provider_default',
    config: null,
    enabled: true,
    models,
    ...over,
  }
}

describe('AiModelRegistry', () => {
  let prisma: DeepMockProxy<PrismaService>
  let redis: AppRedisClient & { store: Map<string, string> }
  let metrics: MetricsService
  let registry: AiModelRegistry

  function build(envValues: Record<string, unknown>): AiModelRegistry {
    const env = makeEnv({ AI_CATALOG_CACHE_TTL_SECONDS: 300, ...envValues })
    const resolver = new AiCredentialResolver(env)
    return new AiModelRegistry(
      redis,
      prisma as unknown as PrismaService,
      env,
      resolver,
      noopLogger as never,
      metrics
    )
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    redis = fakeRedis()
    metrics = { incCacheOperation: jest.fn() } as unknown as MetricsService
  })

  describe('resolveModel + cache-aside', () => {
    it('loads from DB on miss and serves the second call from cache', async () => {
      prisma.aiProvider.findMany.mockResolvedValue([
        providerRow(AiProviderType.ANTHROPIC, 'anthropic', [
          modelRow({ slug: 'claude-default', providerModelName: 'claude-opus-4-8' }),
        ]),
      ] as never)
      registry = build({ ANTHROPIC_API_KEY: 'sk-aB0_-Zz9' })

      const first = await registry.resolveModel('claude-default')
      const second = await registry.resolveModel('claude-default')

      expect(first?.providerModelName).toBe('claude-opus-4-8')
      expect(second?.slug).toBe('claude-default')
      expect(prisma.aiProvider.findMany).toHaveBeenCalledTimes(1)
      expect(metrics.incCacheOperation).toHaveBeenCalledWith('ai_catalog', 'hit')
    })

    it('returns null for an unknown slug', async () => {
      prisma.aiProvider.findMany.mockResolvedValue([] as never)
      registry = build({})
      expect(await registry.resolveModel('nope')).toBeNull()
    })
  })

  describe('resolveDefaultModel — credential gating', () => {
    const catalog = [
      providerRow(AiProviderType.ANTHROPIC, 'anthropic', [
        modelRow({ slug: 'claude-default', isDefault: true }),
      ]),
      providerRow(AiProviderType.MOCK, 'mock', [modelRow({ slug: 'mock-default' })]),
    ]

    it('returns the default model when its provider has a key', async () => {
      prisma.aiProvider.findMany.mockResolvedValue(catalog as never)
      registry = build({ ANTHROPIC_API_KEY: 'sk-aB0_-Zz9' })
      expect((await registry.resolveDefaultModel())?.slug).toBe('claude-default')
    })

    it('falls back to the key-less mock when the default provider has no key', async () => {
      prisma.aiProvider.findMany.mockResolvedValue(catalog as never)
      registry = build({})
      expect((await registry.resolveDefaultModel())?.slug).toBe('mock-default')
    })

    it('returns null when neither a credentialed default nor a mock exists', async () => {
      prisma.aiProvider.findMany.mockResolvedValue([
        providerRow(AiProviderType.ANTHROPIC, 'anthropic', [
          modelRow({ slug: 'claude-default', isDefault: true }),
        ]),
      ] as never)
      registry = build({})
      expect(await registry.resolveDefaultModel()).toBeNull()
    })
  })

  describe('invalidate + corrupt cache', () => {
    beforeEach(() => {
      prisma.aiProvider.findMany.mockResolvedValue([
        providerRow(AiProviderType.MOCK, 'mock', [modelRow({ slug: 'mock-default' })]),
      ] as never)
    })

    it('re-queries the DB after invalidate()', async () => {
      registry = build({})
      await registry.resolveModel('mock-default')
      await registry.invalidate()
      await registry.resolveModel('mock-default')
      expect(prisma.aiProvider.findMany).toHaveBeenCalledTimes(2)
    })

    it('reloads and records a metric on a corrupt cache entry', async () => {
      registry = build({})
      redis.store.set('ai:catalog:v1', '{not json')
      const result = await registry.resolveModel('mock-default')
      expect(result?.slug).toBe('mock-default')
      expect(metrics.incCacheOperation).toHaveBeenCalledWith('ai_catalog', 'corrupt')
    })

    it('treats a structurally invalid (wrong-shape) cached snapshot as corrupt and reloads', async () => {
      registry = build({})
      // Valid JSON, but not a valid catalog snapshot (capabilities is not a bounded map).
      redis.store.set('ai:catalog:v1', JSON.stringify([{ slug: 'x', capabilities: 42 }]))
      const result = await registry.resolveModel('mock-default')
      expect(result?.slug).toBe('mock-default')
      expect(metrics.incCacheOperation).toHaveBeenCalledWith('ai_catalog', 'corrupt')
      expect(prisma.aiProvider.findMany).toHaveBeenCalledTimes(1)
    })
  })

  describe('fail-closed DB-row validation', () => {
    it('skips a model whose capabilities are not a bounded boolean map', async () => {
      prisma.aiProvider.findMany.mockResolvedValue([
        providerRow(AiProviderType.MOCK, 'mock', [
          modelRow({ slug: 'good' }),
          modelRow({ slug: 'bad', capabilities: { text: 'yes' } }),
        ]),
      ] as never)
      registry = build({})

      expect(await registry.resolveModel('good')).not.toBeNull()
      expect(await registry.resolveModel('bad')).toBeNull()
    })

    it('skips a provider whose config carries a forbidden secret-looking key', async () => {
      prisma.aiProvider.findMany.mockResolvedValue([
        providerRow(AiProviderType.OPENAI, 'openai', [modelRow({ slug: 'gpt' })], {
          config: { apiKey: 'leaked' },
        }),
      ] as never)
      registry = build({ OPENAI_API_KEY: 'sk-aB0_-Zz9' })

      expect(await registry.resolveModel('gpt')).toBeNull()
    })

    it('skips a provider whose config nests an object (no depth allowed)', async () => {
      prisma.aiProvider.findMany.mockResolvedValue([
        providerRow(AiProviderType.OPENAI, 'openai', [modelRow({ slug: 'gpt' })], {
          config: { nested: { a: 1 } },
        }),
      ] as never)
      registry = build({ OPENAI_API_KEY: 'sk-aB0_-Zz9' })

      expect(await registry.resolveModel('gpt')).toBeNull()
    })
  })
})
