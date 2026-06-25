import { Module } from '@nestjs/common'

import { AI_PROVIDER_ADAPTERS, type AiProviderAdapter } from './gateway/ai-gateway.types'
import { AiCredentialResolver } from './gateway/credential-resolver'
import { ModelGateway } from './gateway/model-gateway.service'
import { AnthropicAdapter } from './gateway/providers/anthropic.adapter'
import { MockAiAdapter } from './gateway/providers/mock.adapter'
import { OpenAICompatibleAdapter } from './gateway/providers/openai-compatible.adapter'
import { AiModelRegistry } from './registry/ai-model-registry.service'
import { AiUsageLedgerService } from './usage/ai-usage-ledger.service'

import { PrismaModule } from '@/prisma'

/**
 * AI core module (Track C — ADR-054, Arc B). Provider-safe services: the credential resolver, the
 * DB-backed model registry, the `ModelGateway` seam, and its provider adapters. Redis
 * (`REDIS_CLIENT`), `EnvService`, and `MetricsService` come from their global modules; only
 * `PrismaModule` is imported. Adapters are registered as a list behind `AI_PROVIDER_ADAPTERS`; the
 * real SDK-backed adapters use the global `fetch` (no injected one), so they are constructed in the
 * factory rather than via DI. A provider call only happens when the worker invokes the gateway.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    AiCredentialResolver,
    AiModelRegistry,
    AiUsageLedgerService,
    {
      provide: AI_PROVIDER_ADAPTERS,
      useFactory: (): AiProviderAdapter[] => [
        new MockAiAdapter(),
        new AnthropicAdapter(),
        new OpenAICompatibleAdapter(),
      ],
    },
    ModelGateway,
  ],
  exports: [AiCredentialResolver, AiModelRegistry, ModelGateway, AiUsageLedgerService],
})
export class AiCoreModule {}
