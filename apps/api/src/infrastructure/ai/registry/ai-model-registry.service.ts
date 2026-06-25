import { Inject, Injectable } from '@nestjs/common'
import { AiProviderType } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import { AiCredentialResolver } from '../gateway/credential-resolver'

import {
  type AiCatalogSnapshot,
  aiCatalogSnapshotSchema,
  type ResolvedAiModel,
  resolvedAiModelSchema,
} from './ai-registry.types'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'
import { type AppRedisClient, REDIS_CLIENT } from '@/infrastructure/redis'
import { PrismaService } from '@/prisma'

const CATALOG_CACHE_KEY = 'ai:catalog:v1'

/**
 * DB-backed model registry (Track C — ADR-054, Arc B). Resolves the admin-managed catalog to
 * the secret-free shapes the gateway dispatches on. The catalog is one tiny read-mostly key, so
 * a single Redis snapshot with a bounded TTL + explicit `invalidate()` is the right cache — no
 * per-key stampede lock (unlike the high-cardinality per-user cache): on expiry a few concurrent
 * misses each run one small query until one fills the snapshot, which is negligible.
 *
 * Credential gating (the A.3 closeout requirement): `resolveDefaultModel()` only returns the
 * `isDefault` model when its provider actually has a key, otherwise it falls back to the key-less
 * `mock` provider — so a fresh key-less fork resolves a usable default instead of a dead one.
 */
@Injectable()
export class AiModelRegistry {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly credentials: AiCredentialResolver,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService
  ) {
    this.logger.setContext(AiModelRegistry.name)
  }

  /** An enabled model by logical slug, or `null`. No credential gating — an explicit choice. */
  async resolveModel(slug: string): Promise<ResolvedAiModel | null> {
    const snapshot = await this.getSnapshot()
    return snapshot.find((model) => model.slug === slug) ?? null
  }

  /**
   * The selectable default model: the `isDefault` row when its provider has a usable credential,
   * else the key-less `mock` provider's model, else `null` (empty/unconfigured catalog).
   */
  async resolveDefaultModel(): Promise<ResolvedAiModel | null> {
    const snapshot = await this.getSnapshot()
    const preferred = snapshot.find((model) => model.isDefault && this.hasCredential(model))
    if (preferred) return preferred
    return snapshot.find((model) => model.provider.type === AiProviderType.MOCK) ?? null
  }

  /** Whether a resolved model's provider has a usable credential (mock is always available). */
  hasCredential(model: ResolvedAiModel): boolean {
    return this.credentials.hasCredential(model.provider.type, model.provider.credentialSlot)
  }

  /** Drop the cached snapshot — called after an admin catalog write (later arc). */
  async invalidate(): Promise<void> {
    await this.redis.del(CATALOG_CACHE_KEY)
  }

  private async getSnapshot(): Promise<AiCatalogSnapshot> {
    const raw = await this.redis.get(CATALOG_CACHE_KEY)
    if (raw !== null) {
      const cached = this.parseSnapshot(raw)
      if (cached !== null) {
        this.metrics.incCacheOperation('ai_catalog', 'hit')
        return cached
      }
      // Syntactically or structurally invalid cache → never trust it; drop and reload.
      await this.redis.del(CATALOG_CACHE_KEY)
      this.metrics.incCacheOperation('ai_catalog', 'corrupt')
    }

    this.metrics.incCacheOperation('ai_catalog', 'miss')
    const snapshot = await this.loadFromDb()
    this.metrics.incCacheOperation('ai_catalog', 'db_fallback')
    await this.redis.set(CATALOG_CACHE_KEY, JSON.stringify(snapshot), {
      expiration: { type: 'EX', value: this.env.get('AI_CATALOG_CACHE_TTL_SECONDS') },
    })
    return snapshot
  }

  /** Validate a cached snapshot against the bounded schema; `null` if invalid (→ reload). */
  private parseSnapshot(raw: string): AiCatalogSnapshot | null {
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
  private async loadFromDb(): Promise<AiCatalogSnapshot> {
    const providers = await this.prisma.aiProvider.findMany({
      where: { enabled: true },
      include: { models: { where: { enabled: true } } },
    })

    const snapshot: AiCatalogSnapshot = []
    for (const provider of providers) {
      for (const model of provider.models) {
        const candidate = {
          slug: model.slug,
          providerModelName: model.providerModelName,
          capabilities: model.capabilities,
          contextLimit: model.contextLimit,
          maxOutputTokens: model.maxOutputTokens,
          isDefault: model.isDefault,
          provider: {
            slug: provider.slug,
            type: provider.type,
            baseUrl: provider.baseUrl,
            credentialSlot: provider.credentialSlot,
            dataRetentionClass: provider.dataRetentionClass,
            config: provider.config,
          },
        }
        const parsed = resolvedAiModelSchema.safeParse(candidate)
        if (!parsed.success) {
          this.logger.warn(
            { providerSlug: provider.slug, modelSlug: model.slug },
            'Skipping AI catalog row that fails bounded-schema validation'
          )
          continue
        }
        snapshot.push(parsed.data)
      }
    }
    return snapshot
  }
}
