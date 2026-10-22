import { type DynamicModule, Module } from '@nestjs/common'

import { INTEGRATION_REGISTRATIONS, type IntegrationRegistration } from './integration.types.js'
import { IntegrationRegistry } from './integration-registry.js'
import { INTEGRATIONS } from './integrations.composition.js'

/** Imports each registered module once and builds the registry from the composed list. */
@Module({})
export class IntegrationsModule {
  static register(registrations: readonly IntegrationRegistration[]): DynamicModule {
    return {
      module: IntegrationsModule,
      imports: [...new Set(registrations.map((registration) => registration.module))],
      providers: [
        { provide: INTEGRATION_REGISTRATIONS, useValue: registrations },
        IntegrationRegistry,
      ],
      exports: [IntegrationRegistry],
    }
  }
}

export const configuredIntegrations = IntegrationsModule.register(INTEGRATIONS)
