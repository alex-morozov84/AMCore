import { type DynamicModule, Module } from '@nestjs/common'

import type { AiToolAuthority, AiToolRegistration } from './ai-tool.types'
import { AiToolContractRegistry } from './ai-tool-contract.registry'

@Module({})
export class ConfiguredAiToolContractsModule {
  static register(entries: readonly AiToolRegistration[]): DynamicModule {
    return {
      module: ConfiguredAiToolContractsModule,
      imports: entries.map((entry) => entry.contract.authority.module),
      providers: [
        {
          provide: AiToolContractRegistry,
          useFactory: (...authorities: AiToolAuthority[]) =>
            new AiToolContractRegistry(
              entries.map((entry) => entry.contract),
              authorities
            ),
          inject: entries.map((entry) => entry.contract.authority.token),
        },
      ],
      exports: [AiToolContractRegistry],
    }
  }
}
