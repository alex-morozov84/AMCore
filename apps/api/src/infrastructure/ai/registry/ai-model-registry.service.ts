import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AiGatewayException } from '../gateway/ai-gateway.error'
import { AiCredentialResolver } from '../gateway/credential-resolver'

import { AiCatalogCache } from './ai-catalog-cache'
import { AiCatalogLoad } from './ai-catalog-load'
import type { AiExecutionDescriptor } from './ai-execution-descriptor'
import {
  type AiCatalogSnapshot,
  aiCatalogSnapshotSchema,
  type ResolvedAiModel,
  resolvedAiModelSchema,
} from './ai-registry.types'

import { EnvService } from '@/env/env.service'
import { AiProviderType, Prisma } from '@/generated/prisma/client'
import { MetricsService } from '@/infrastructure/observability'
import { type AppRedisClient, REDIS_CLIENT } from '@/infrastructure/redis'
import { PrismaService } from '@/prisma'
import type { ObservedTransactionRunner } from '@/prisma/observed-transaction'

/** Bounded cache-aside selection; fresh primary permission remains separate. */
@Injectable()
export class AiModelRegistry {
  private readonly cache: AiCatalogCache
  private readonly load: AiCatalogLoad<AiCatalogSnapshot>
  private remoteGeneration: string | undefined
  private readonly runner: ObservedTransactionRunner
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly credentials: AiCredentialResolver,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService
  ) {
    this.logger.setContext(AiModelRegistry.name)
    this.runner = this.prisma.observedTransactions('ai-catalogue')
    this.cache = new AiCatalogCache(redis, env.get('AI_CATALOG_CACHE_TTL_SECONDS'))
    this.load = new AiCatalogLoad((canQuery) =>
      this.runner.start((tx) => this.loadFromDb(tx, canQuery))
    )
    this.prisma.registerShutdownBarrier(async () => {
      this.load.close()
      this.cache.close()
    })
  }

  /** An enabled model by logical slug, or `null`. No credential gating — an explicit choice. */
  async resolveModel(slug: string, signal?: AbortSignal): Promise<ResolvedAiModel | null> {
    const snapshot = await this.getSnapshot(signal)
    return snapshot.find((model) => model.slug === slug) ?? null
  }

  /**
   * The selectable default model: the `isDefault` row when its provider has a usable credential,
   * else the key-less `mock` provider's model, else `null` (empty/unconfigured catalog).
   */
  async resolveDefaultModel(signal?: AbortSignal): Promise<ResolvedAiModel | null> {
    const snapshot = await this.getSnapshot(signal)
    const preferred = snapshot.find((model) => model.isDefault && this.hasCredential(model))
    if (preferred) return preferred
    return snapshot.find((model) => model.provider.type === AiProviderType.MOCK) ?? null
  }

  /** Whether a resolved model's provider has a usable credential (mock is always available). */
  hasCredential(model: ResolvedAiModel): boolean {
    return this.credentials.hasCredential(model.provider.type, model.provider.credentialSlot)
  }

  /** Primary-PG permission read. Cached enabled state is never execution authority. */
  async resolveLiveModel(
    id: string,
    signal?: AbortSignal,
    frozen?: AiExecutionDescriptor
  ): Promise<ResolvedAiModel | null> {
    signal?.throwIfAborted()
    const row = await this.prisma.aiModel.findUnique({ where: { id }, include: { provider: true } })
    signal?.throwIfAborted()
    if (!row?.enabled || !row.provider.enabled) return null
    const parsed = resolvedAiModelSchema.safeParse(
      frozen
        ? {
            ...row,
            providerModelName: frozen.providerModelName,
            capabilities: frozen.capabilities,
            contextLimit: frozen.contextLimit,
            maxOutputTokens: frozen.maxOutputTokens,
            provider: {
              ...row.provider,
              config: null,
              dataRetentionClass: 'provider_default',
              baseUrl:
                row.provider.type === AiProviderType.OPENAI_COMPATIBLE
                  ? row.provider.baseUrl
                  : null,
            },
          }
        : row
    )
    return parsed.success ? parsed.data : null
  }

  /** Drop the cached snapshot — called after an admin catalog write (later arc). */
  async invalidate(): Promise<void> {
    this.load.invalidate()
    const token = await this.cache.invalidate()
    if (token) this.remoteGeneration = token
  }

  /**
   * `signal` is the CALLER's attempt boundary (an AI worker run): it is checked before every actual
   * operation — each Redis call and the database fallback — so a continuation resuming after the
   * caller's cutoff starts nothing more (it throws the signal's abort reason instead). The registry
   * itself stays shared and open: other callers (web role, producer) pass no signal.
   */
  private async getSnapshot(signal?: AbortSignal): Promise<AiCatalogSnapshot> {
    try {
      return await this.readSnapshot(signal)
    } catch {
      signal?.throwIfAborted()
      throw AiGatewayException.catalogueUnavailable()
    }
  }

  private async readSnapshot(signal?: AbortSignal): Promise<AiCatalogSnapshot> {
    signal?.throwIfAborted()
    let generation = this.load.generation
    const probe = await this.cache.probe(signal)
    signal?.throwIfAborted()
    if (generation !== this.load.generation) throw new Error('catalogue_unavailable')
    if (probe && this.remoteGeneration && probe.token !== this.remoteGeneration) {
      this.load.invalidate()
      generation = this.load.generation
    }
    if (probe) this.remoteGeneration = probe.token
    let token = probe?.token ?? null
    if (probe?.raw !== null && probe?.raw !== undefined) {
      const cached = this.parseSnapshot(probe.raw)
      if (cached) {
        this.metrics.incCacheOperation('ai_catalog', 'hit')
        return cached
      }
      this.metrics.incCacheOperation('ai_catalog', 'corrupt')
      token = await this.cache.invalidate(signal)
      signal?.throwIfAborted()
    }
    this.metrics.incCacheOperation('ai_catalog', 'miss')
    const snapshot = await this.load.load(signal, token)
    signal?.throwIfAborted()
    if (generation !== this.load.generation) throw new Error('catalogue_unavailable')
    this.metrics.incCacheOperation('ai_catalog', 'db_fallback')
    const fillToken = this.load.reserveFill()
    if (fillToken) await this.cache.fill(fillToken, JSON.stringify(snapshot), signal)
    signal?.throwIfAborted()
    return snapshot
  }

  /** Validate a cached snapshot against the bounded schema; `null` if invalid (→ reload). */
  private parseSnapshot(raw: string): AiCatalogSnapshot | null {
    if (Buffer.byteLength(raw) > 1024 * 1024) return null
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return null
    }
    const parsed = aiCatalogSnapshotSchema.safeParse(json)
    return parsed.success ? parsed.data : null
  }

  /**
   * Build the snapshot from the DB, validating each row at the trust boundary. A model whose
   * `capabilities` or whose provider's `config` fails the bounded schema is **skipped** (logged
   * by slug only, never content) so a structurally bad admin row can never be selected — fail
   * closed rather than passing unbounded JSON to the gateway as trusted config.
   */
  private async loadFromDb(
    tx: Prisma.TransactionClient,
    canQuery: () => void
  ): Promise<AiCatalogSnapshot> {
    canQuery()
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    canQuery()
    await tx.$queryRaw`SELECT set_config('statement_timeout', '1500ms', true)`
    canQuery()
    const models = await tx.aiModel.findMany({
      where: { enabled: true, provider: { enabled: true } },
      include: { provider: true },
      orderBy: { id: 'asc' },
      take: 1025,
    })
    if (models.length > 1024) throw new Error('catalogue_unavailable')
    const snapshot: AiCatalogSnapshot = []
    for (const model of models) {
      const parsed = resolvedAiModelSchema.safeParse(model)
      if (parsed.success) snapshot.push(parsed.data)
      else this.logger.warn({ modelSlug: model.slug }, 'Skipping invalid AI catalog row')
    }
    return snapshot
  }
}
