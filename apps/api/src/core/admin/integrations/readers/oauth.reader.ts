import { Injectable, Module } from '@nestjs/common'

import { AuthModule } from '../../../auth/auth.module.js'
import { OAuthProviderFactory } from '../../../auth/oauth/providers/oauth-provider.factory.js'
import type { IntegrationReader, IntegrationReading } from '../integration.types.js'

/** Sign-in providers: configuration only. A configured provider does not prove a user can sign in. */
@Injectable()
export class OAuthIntegrationReader implements IntegrationReader {
  constructor(private readonly factory: OAuthProviderFactory) {}

  read(): Promise<IntegrationReading> {
    const providers = this.factory.getAvailableProviders().sort()
    return Promise.resolve({
      configuration: providers.length > 0 ? 'configured' : 'not_configured',
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
        { key: 'providers_count', value: providers.length },
        ...(providers.length > 0 ? [{ key: 'providers', value: providers.join(', ') }] : []),
      ],
      links: [],
    })
  }
}

@Module({
  imports: [AuthModule],
  providers: [OAuthIntegrationReader],
  exports: [OAuthIntegrationReader],
})
export class OAuthIntegrationModule {}
