import { Module } from '@nestjs/common'

import { configuredAiToolContracts } from './ai-tool-composition.js'
import { ConfiguredAiToolContractsModule } from './ai-tool-contracts-core.module.js'

@Module({ imports: [configuredAiToolContracts], exports: [ConfiguredAiToolContractsModule] })
export class AiToolContractsModule {}
