import { type DynamicModule, Module, type Type } from '@nestjs/common'
import { z } from 'zod'

import { AI_TOOLS, type AiTool, type AiToolRegistration } from './ai-tool.types'
import { AI_TOOL_REGISTRATIONS } from './ai-tool-composition'
import { AiToolContractRegistry } from './ai-tool-contract.registry'
import { AiToolContractsModule } from './ai-tool-contracts.module'
import { AiToolRegistry } from './ai-tool-registry.service'

import { canonicalJsonHash } from '@/common/utils/canonical-json'

@Module({})
export class AiToolsWorkerModule {
  static register(core: Type<unknown>, entries: readonly AiToolRegistration[]): DynamicModule {
    return {
      module: AiToolsWorkerModule,
      imports: [core, ...entries.map((entry) => entry.worker(core))],
      providers: [
        {
          provide: AI_TOOLS,
          useFactory: (contracts: AiToolContractRegistry, ...tools: AiTool[]) => {
            for (const [index, tool] of tools.entries()) {
              const contract = entries[index]?.contract
              if (
                tool.toolId !== contract?.toolId ||
                tool.contractVersion !== contract.contractVersion ||
                !tool.prepare ||
                !tool.execute ||
                !contracts.get(tool.toolId)
              )
                throw new Error('Tool executor token mismatch')
              const registered = contracts.get(tool.toolId)!
              if (
                tool.riskClass !== contract.riskClass ||
                tool.idempotency !== contract.idempotency ||
                canonicalJsonHash(z.toJSONSchema(tool.parameters, { io: 'input' })) !==
                  registered.inputSchemaHash ||
                canonicalJsonHash(z.toJSONSchema(tool.normalizedSchema, { io: 'input' })) !==
                  registered.normalizedSchemaHash
              ) {
                throw new Error('Tool executor contract mismatch')
              }
            }
            return tools
          },
          inject: [AiToolContractRegistry, ...entries.map((entry) => entry.executorToken)],
        },
        AiToolRegistry,
      ],
      exports: [core, AiToolRegistry, AI_TOOLS],
    }
  }
}

const configuredWorker = AiToolsWorkerModule.register(AiToolContractsModule, AI_TOOL_REGISTRATIONS)
@Module({ imports: [configuredWorker], exports: [AiToolsWorkerModule] })
export class AiToolsModule {}
