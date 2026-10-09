import { type DynamicModule, Module, type Type } from '@nestjs/common'

import type { AiToolRegistration } from './ai-tool.types'
import { ConfiguredAiToolContractsModule } from './ai-tool-contracts-core.module'
import { currentTimeContract } from './reference/current-time.contract'
import { currentTimeTool } from './reference/current-time.tool'

export const CURRENT_TIME_EXECUTOR = Symbol('CURRENT_TIME_EXECUTOR')
@Module({})
class CurrentTimeExecutionModule {
  static register(core: Type<unknown>): DynamicModule {
    return {
      module: CurrentTimeExecutionModule,
      imports: [core],
      providers: [{ provide: CURRENT_TIME_EXECUTOR, useValue: currentTimeTool }],
      exports: [CURRENT_TIME_EXECUTOR],
    }
  }
}

/** Application composition entry; transport execution never enters the core barrel. */
export const AI_TOOL_REGISTRATIONS: readonly AiToolRegistration[] = [
  {
    contract: currentTimeContract,
    executorToken: CURRENT_TIME_EXECUTOR,
    worker: (core) => CurrentTimeExecutionModule.register(core),
  },
]
export const configuredAiToolContracts =
  ConfiguredAiToolContractsModule.register(AI_TOOL_REGISTRATIONS)
