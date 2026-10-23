import { Injectable, Module } from '@nestjs/common'

import { AiCatalogModule } from '../../../../infrastructure/ai/ai-catalog.module.js'
import { AiModelRegistry } from '../../../../infrastructure/ai/registry/ai-model-registry.service.js'
import type { IntegrationReader, IntegrationReading } from '../integration.types.js'

/**
 * AI: configuration only, from the cached enabled-model catalogue. Counts providers that have an
 * enabled model; it is not a credential check against any provider and may be a few minutes old.
 */
@Injectable()
export class AiIntegrationReader implements IntegrationReader {
  constructor(private readonly registry: AiModelRegistry) {}

  async read(signal: AbortSignal): Promise<IntegrationReading> {
    const availability = await this.registry.describeAvailability(signal)
    return {
      configuration: availability.providersWithModels > 0 ? 'configured' : 'not_configured',
      evidence: {
        result: 'none',
        freshness: 'none',
        scope: 'configuration_only',
        instance: 'answering_instance',
        checkedAt: null,
        staleAfterSeconds: null,
        failure: null,
      },
      facts: [
        { key: 'providers_with_models', value: availability.providersWithModels },
        { key: 'providers_with_key', value: availability.providersWithKey },
        { key: 'effective_default', value: availability.effectiveDefault },
        { key: 'catalogue_cache_seconds', value: availability.cacheSeconds },
      ],
      links: [],
    }
  }
}

@Module({
  imports: [AiCatalogModule],
  providers: [AiIntegrationReader],
  exports: [AiIntegrationReader],
})
export class AiIntegrationModule {}
