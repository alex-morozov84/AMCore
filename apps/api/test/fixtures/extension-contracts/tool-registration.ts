import { type DynamicModule, Injectable, Module, type Type } from '@nestjs/common'
import type { TestingModuleBuilder } from '@nestjs/testing'
import type { ZodType } from 'zod'

import { SUPPORTED_LOCALES } from '@amcore/shared'

import type {
  AiTool,
  AiToolAuthority,
  AiToolContract,
  AiToolIntent,
  AiToolPreparation,
  AiToolRegistration,
} from '../../../src/infrastructure/ai/tools/ai-tool.types'
import { AiToolContractsModule } from '../../../src/infrastructure/ai/tools/ai-tool-contracts.module'
import { ConfiguredAiToolContractsModule } from '../../../src/infrastructure/ai/tools/ai-tool-contracts-core.module'
import {
  AiToolsModule,
  AiToolsWorkerModule,
} from '../../../src/infrastructure/ai/tools/ai-tools.module'

/** Only these synthetic fixture targets are authorized. Real domain fixtures use domain authority. */
@Injectable()
export class FixtureToolAuthority implements AiToolAuthority {
  async canDisclose(_tx: unknown, intent: AiToolIntent): Promise<boolean> {
    return intent.target?.kind === 'fixture' && intent.target.id === 'fixture-target'
  }
  async authorize(tx: never, intent: AiToolIntent): Promise<void> {
    if (!(await this.canDisclose(tx, intent))) throw new Error('fixture_target_forbidden')
  }
}
@Module({ providers: [FixtureToolAuthority], exports: [FixtureToolAuthority] })
export class FixtureToolAuthorityModule {}

export function fixtureToolContract<T>(parameters: ZodType<T>): Pick<
  AiToolContract<T>,
  'contractVersion' | 'normalizedSchema' | 'authority'
> & {
  prepare(args: T): Promise<AiToolPreparation<T>>
} {
  return {
    contractVersion: 1,
    normalizedSchema: parameters,
    authority: { module: FixtureToolAuthorityModule, token: FixtureToolAuthority },
    async prepare(args: T) {
      const preview = Object.fromEntries(
        SUPPORTED_LOCALES.map((locale) => [
          locale,
          {
            title: 'Fixture action',
            summary: 'Execute the isolated test action.',
            target: { id: 'fixture-target', label: 'Isolated fixture target' },
            effects: ['Produce the fixture result'],
          },
        ])
      )
      return { args, target: { kind: 'fixture', id: 'fixture-target', revision: 1 }, preview }
    },
  }
}

@Module({})
class FixtureExecutorModule {
  static register(core: Type<unknown>, tool: AiTool, token: symbol): DynamicModule {
    return {
      module: FixtureExecutorModule,
      imports: [core],
      providers: [{ provide: token, useValue: tool }],
      exports: [token],
    }
  }
}

/** Use the same configured core/worker composition seam a downstream registers. */
export function registerFixtureTools(
  builder: TestingModuleBuilder,
  tools: readonly AiTool[]
): TestingModuleBuilder {
  const entries: AiToolRegistration[] = tools.map((tool) => {
    const token = Symbol(tool.toolId)
    return {
      contract: tool,
      executorToken: token,
      worker: (core) => FixtureExecutorModule.register(core, tool, token),
    }
  })
  return registerFixtureToolEntries(builder, entries)
}

export function registerFixtureToolEntries(
  builder: TestingModuleBuilder,
  entries: readonly AiToolRegistration[]
): TestingModuleBuilder {
  const configuredCore = ConfiguredAiToolContractsModule.register(entries)
  @Module({ imports: [configuredCore], exports: [ConfiguredAiToolContractsModule] })
  class FixtureContractsModule {}
  const worker = AiToolsWorkerModule.register(FixtureContractsModule, entries)
  return builder
    .overrideModule(AiToolContractsModule)
    .useModule(FixtureContractsModule)
    .overrideModule(AiToolsModule)
    .useModule(worker)
}
