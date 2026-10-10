import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import type { Queue } from 'bullmq'

import { QUEUE_REGISTRY } from '../queue/constants/queue-inventory.constant'
import { DEFAULT_JOB_OPTIONS } from '../queue/interfaces/job-options.interface'
import { buildBullConnection } from '../queue/redis-connection.config'

import { ControlConnection } from './control-connection'
import { managedProcessor } from './managed-processor'
import { ManagedProducer } from './managed-producer'
import { PgOutcomeBuffer } from './pg-outcome-buffer'
import { ProviderEvidenceStore } from './provider-evidence.store'
import { MANAGED_PRODUCERS, validateWorkRegistrations, WORK_REGISTRATIONS } from './registration'
import { MANAGED_WORKERS, type ManagedWorkerBinding, WorkCoordinator } from './work-coordinator'
import type { WorkDefinition, WorkRegistration } from './work-definition'
import { WorkExecutionService } from './work-execution.service'
import { WorkReadiness } from './work-readiness'

import { EnvModule } from '@/env/env.module'
import { EnvService } from '@/env/env.service'

export type WorkProcessRole = 'web' | 'worker' | 'all'
const graphs = new WeakMap<
  readonly WorkRegistration[],
  Map<WorkProcessRole, Promise<DynamicModule>>
>()

/** Application roots share one selected graph; web never invokes a worker loader. */
export function composeBackgroundWork(
  entries: readonly WorkRegistration[],
  role: WorkProcessRole
): Promise<DynamicModule> {
  validateWorkRegistrations(entries)
  let roles = graphs.get(entries)
  if (!roles) {
    roles = new Map()
    graphs.set(entries, roles)
  }
  const existing = roles.get(role)
  if (existing) return existing
  const graph = configure(entries, role)
  roles.set(role, graph)
  return graph
}

async function configure(
  entries: readonly WorkRegistration[],
  role: WorkProcessRole
): Promise<DynamicModule> {
  const enabled = entries.filter(({ definition }) => !definition.queue || definition.queue.enabled)
  const imports: NonNullable<DynamicModule['imports']> = [
    DiscoveryModule,
    EnvModule,
    BullModule.forRootAsync({
      imports: [EnvModule],
      inject: [EnvService],
      extraOptions: { manualRegistration: true },
      useFactory: (env: EnvService) => ({
        connection: buildBullConnection(env.get('REDIS_URL')),
        prefix: 'amcore',
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue(
      ...enabled.flatMap(({ definition }) =>
        definition.queue ? [{ name: definition.queue.name }] : []
      )
    ),
  ]
  const bindings: ManagedWorkerBinding[] = []
  for (const entry of enabled) {
    imports.push(await entry.core())
    if (entry.control) imports.push(await entry.control())
    if (role !== 'web' && entry.worker) {
      imports.push(await entry.worker())
      if (entry.definition.kind === 'ordinary' || entry.definition.kind === 'wake')
        bindings.push({ workId: entry.definition.id, host: managedProcessor(entry.definition) })
    }
  }
  const queueDefinitions = enabled.flatMap(({ definition }) =>
    definition.queue ? [definition] : []
  )
  const evidence = queueDefinitions.some((definition) =>
    Object.values(definition.jobs).some((job) => job.replay.kind === 'provider-window')
  )
    ? [ProviderEvidenceStore]
    : []
  const producers = entries.flatMap(({ definition }) =>
    definition.kind === 'ordinary' || definition.kind === 'wake'
      ? [producerProvider(definition)]
      : []
  )
  return {
    module: ConfiguredBackgroundWork,
    imports,
    providers: [
      WorkReadiness,
      WorkExecutionService,
      WorkCoordinator,
      ControlConnection,
      PgOutcomeBuffer,
      ...evidence,
      { provide: WORK_REGISTRATIONS, useValue: entries },
      { provide: MANAGED_WORKERS, useValue: bindings },
      {
        provide: QUEUE_REGISTRY,
        inject: queueDefinitions.map((d) => getQueueToken(d.queue!.name)),
        useFactory: (...queues: Queue[]) =>
          new Map(
            queueDefinitions.map((definition, index) => [definition.queue!.name, queues[index]])
          ),
      },
      ...producers,
      ...bindings.map(({ host }) => host),
      {
        provide: MANAGED_PRODUCERS,
        inject: producers.map((provider) => provider.provide),
        useFactory: (...instances: ManagedProducer<WorkDefinition>[]) =>
          new Map(
            entries
              .filter(
                ({ definition }) => definition.kind === 'ordinary' || definition.kind === 'wake'
              )
              .map(({ definition }, index) => [definition.queue!.name, instances[index]])
          ),
      },
    ],
    exports: [
      BullModule,
      WORK_REGISTRATIONS,
      QUEUE_REGISTRY,
      WorkReadiness,
      MANAGED_PRODUCERS,
      ControlConnection,
      PgOutcomeBuffer,
      ...evidence,
      ...producers.map((provider) => provider.provide),
    ],
  }
}

function producerProvider(definition: WorkDefinition): Extract<Provider, { provide: unknown }> {
  if (!definition.queue?.enabled)
    return {
      provide: definition.tokens.producer,
      useValue: Object.freeze({
        add: async () => {
          throw new Error('WORK_UNAVAILABLE')
        },
      }),
    }
  return {
    provide: definition.tokens.producer,
    inject: [getQueueToken(definition.queue.name), WorkReadiness],
    useFactory: (queue: Queue, readiness: WorkReadiness) =>
      new ManagedProducer(definition, queue, readiness),
  }
}

@Global()
@Module({})
class ConfiguredBackgroundWork {}
