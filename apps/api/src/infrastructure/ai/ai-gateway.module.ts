import { Module } from '@nestjs/common'

import { AiCatalogModule } from './ai-catalog.module'
import { AI_PROVIDER_ADAPTERS, type AiProviderAdapter } from './gateway/ai-gateway.types'
import { AiCredentialResolver } from './gateway/credential-resolver'
import { ModelGateway } from './gateway/model-gateway.service'
import { AnthropicAdapter } from './gateway/providers/anthropic.adapter'
import { MockAiAdapter } from './gateway/providers/mock.adapter'
import { OpenAICompatibleAdapter } from './gateway/providers/openai-compatible.adapter'
import { AiUsageLedgerService } from './usage/ai-usage-ledger.service'

import { PrismaModule } from '@/prisma'

/**
 * AI gateway module (Track C — ADR-054, Arc C split). The **worker-only** half of the former
 * `AiCoreModule`: the `ModelGateway` seam, its SDK-backed provider adapters, and the usage-ledger
 * writer — every piece that can make a provider call or read a credential.
 *
 * This module is imported **only** by the worker slice (Arc C.4 `AiWorkerModule`), never by
 * `coreImports()`/web, so provider-call capability is absent from the web DI graph (the Arc B
 * carried boundary, now enforced by DI rather than convention). It imports `AiCatalogModule` for
 * the shared secret-free `AiModelRegistry` and provides its own `AiCredentialResolver` (stateless;
 * kept out of any web-visible export). Adapters are registered as a list behind
 * `AI_PROVIDER_ADAPTERS`; the real SDK adapters use the global `fetch`, so they are constructed in
 * the factory rather than via DI.
 */
@Module({
  imports: [AiCatalogModule, PrismaModule],
  providers: [
    AiCredentialResolver,
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
  exports: [ModelGateway, AiUsageLedgerService],
})
export class AiGatewayModule {}
