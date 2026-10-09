import { Module } from '@nestjs/common'

import { configuredAiToolContracts } from './ai-tool-composition'
import { ConfiguredAiToolContractsModule } from './ai-tool-contracts-core.module'

@Module({ imports: [configuredAiToolContracts], exports: [ConfiguredAiToolContractsModule] })
export class AiToolContractsModule {}
