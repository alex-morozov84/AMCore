import { mockDeep } from 'jest-mock-extended'

import { AiCredentialResolver } from '../gateway/credential-resolver'

import { AiModelRegistry } from './ai-model-registry.service'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'
import type { AppRedisClient } from '@/infrastructure/redis'
import type { PrismaService } from '@/prisma'

function row(slug = 'mock-default', type = 'MOCK', over = {}) {
  return {
    id: slug,
    slug,
    providerModelName: slug,
    capabilities: { text: true },
    contextLimit: null,
    maxOutputTokens: null,
    isDefault: true,
    enabled: true,
    provider: {
      id: type,
      slug: type.toLowerCase(),
      type,
      baseUrl: null,
      credentialSlot: type === 'MOCK' ? null : 'default',
      dataRetentionClass: 'provider_default',
      config: null,
      enabled: true,
    },
    ...over,
  }
}

function fixture(values = {}) {
  const prisma = mockDeep<PrismaService>()
  prisma.aiModel.findMany.mockResolvedValue([row()] as never)
  prisma.observedTransactions.mockReturnValue({
    start: (fn: (tx: unknown) => Promise<unknown>) => {
      const result = fn(prisma)
      return {
        result,
        physicalCompletion: result.then(
          () => undefined,
          () => undefined
        ),
      }
    },
  } as never)
  const evalCommand = jest.fn().mockResolvedValue(null)
  const redis = { withCommandOptions: () => ({ eval: evalCommand }) } as unknown as AppRedisClient
  const env = {
    get: (key: string) =>
      (({ AI_CATALOG_CACHE_TTL_SECONDS: 300, ...values }) as Record<string, unknown>)[key],
  } as EnvService
  const metrics = { incCacheOperation: jest.fn() } as unknown as MetricsService
  const registry = new AiModelRegistry(
    redis,
    prisma,
    env,
    new AiCredentialResolver(env),
    { setContext: jest.fn(), warn: jest.fn() } as never,
    metrics
  )
  return { prisma, registry, evalCommand }
}

describe('bounded catalogue registry', () => {
  it('falls back to one flat bounded PG read when Redis gives no snapshot', async () => {
    const { prisma, registry } = fixture()
    expect((await registry.resolveDefaultModel())?.id).toBe('mock-default')
    expect((await registry.resolveModel('mock-default'))?.provider.id).toBe('MOCK')
    expect(prisma.aiModel.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.aiModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1025, orderBy: { id: 'asc' } })
    )
  })

  it('gates the preferred provider credential, falling back to key-less mock', async () => {
    const { prisma, registry } = fixture()
    prisma.aiModel.findMany.mockResolvedValue([row('claude', 'ANTHROPIC'), row()] as never)
    expect((await registry.resolveDefaultModel())?.slug).toBe('mock-default')
    const configured = fixture({ ANTHROPIC_API_KEY: 'fake-key' })
    configured.prisma.aiModel.findMany.mockResolvedValue([
      row('claude', 'ANTHROPIC'),
      row(),
    ] as never)
    expect((await configured.registry.resolveDefaultModel())?.slug).toBe('claude')
  })

  it('rejects overflow without silent truncation; skips schema-invalid rows', async () => {
    const { prisma, registry } = fixture()
    prisma.aiModel.findMany.mockResolvedValue(Array.from({ length: 1025 }, () => row()) as never)
    await expect(registry.resolveDefaultModel()).rejects.toMatchObject({
      code: 'catalogue_unavailable',
      retryable: true,
      status: 503,
    })
    const invalid = fixture()
    invalid.prisma.aiModel.findMany.mockResolvedValue([
      row('bad', 'MOCK', { capabilities: 42 }),
    ] as never)
    expect(await invalid.registry.resolveDefaultModel()).toBeNull()
  })

  it('starts no cache or PG work for an already-aborted caller', async () => {
    const { prisma, registry, evalCommand } = fixture()
    await expect(registry.resolveDefaultModel(AbortSignal.abort())).rejects.toBeDefined()
    expect(evalCommand).not.toHaveBeenCalled()
    expect(prisma.aiModel.findMany).not.toHaveBeenCalled()
  })

  it('a live permission read refuses disabled providers and never reuses the cache', async () => {
    const { prisma, registry } = fixture()
    prisma.aiModel.findUnique.mockResolvedValue(row() as never)
    expect((await registry.resolveLiveModel('mock-default'))?.id).toBe('mock-default')
    prisma.aiModel.findUnique.mockResolvedValue({ ...row(), enabled: false } as never)
    expect(await registry.resolveLiveModel('mock-default')).toBeNull()
    expect(prisma.aiModel.findUnique).toHaveBeenCalledTimes(2)
  })
})
