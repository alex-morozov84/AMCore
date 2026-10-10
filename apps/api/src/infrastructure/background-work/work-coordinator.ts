import { BullRegistrar, getQueueToken, WorkerHost } from '@nestjs/bullmq'
import { Inject, Injectable, type OnApplicationBootstrap, type Type } from '@nestjs/common'
import { DiscoveryService, ModuleRef } from '@nestjs/core'
import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'

import { validateWorkRegistrations, WORK_REGISTRATIONS } from './registration'
import { verifyInstalledScriptProvenance } from './script-provenance'
import { initializeManagedQueue } from './scripts/initialize-queue'
import type { WorkHandler, WorkRegistration } from './work-definition'
import { PROVIDER_WINDOW_EXECUTION } from './work-execution.service'
import { WorkReadiness } from './work-readiness'

export const MANAGED_WORKERS = Symbol('MANAGED_WORKERS')
export interface ManagedWorkerBinding {
  readonly workId: string
  readonly host: Type<WorkerHost>
}

/** Explicit registration + autorun:false avoids depending on lifecycle-hook ordering. */
@Injectable()
export class WorkCoordinator implements OnApplicationBootstrap {
  constructor(
    @Inject(WORK_REGISTRATIONS) private readonly entries: readonly WorkRegistration[],
    @Inject(MANAGED_WORKERS) private readonly bindings: readonly ManagedWorkerBinding[],
    private readonly discovery: DiscoveryService,
    private readonly modules: ModuleRef,
    private readonly registrar: BullRegistrar,
    private readonly readiness: WorkReadiness
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      validateWorkRegistrations(this.entries)
      verifyInstalledScriptProvenance()
      this.validatePorts()
      this.validateProcessors()
      const extras = this.modules.get<{ manualRegistration?: boolean }>('BULLMQ_EXTRA_OPTIONS', {
        strict: false,
      })
      if (extras.manualRegistration !== true) throw new Error('UNSAFE_WORKER_REGISTRATION')
      this.registrar.register()
      const hosts = this.bindings.map(({ host }) => this.modules.get(host, { strict: false }))
      for (let i = 0; i < hosts.length; i += 1) {
        const definition = this.entries.find(
          (entry) => entry.definition.id === this.bindings[i]!.workId
        )!.definition
        const worker = hosts[i]!.worker
        if (
          worker.opts.autorun !== false ||
          worker.name !== definition.queue!.name ||
          worker.isRunning()
        )
          throw new Error('UNSAFE_WORKER_CONFIGURATION')
      }
      for (const { definition } of this.entries) {
        if (!definition.queue?.enabled) continue
        const queue = this.modules.get<Queue>(getQueueToken(definition.queue.name), {
          strict: false,
        })
        await initializeManagedQueue(
          (await queue.getBackend().client) as unknown as Redis,
          queue.toKey('meta')
        )
      }
      this.readiness.open()
      for (const host of hosts) void host.worker.run().catch(() => this.readiness.close())
    } catch (error) {
      this.readiness.close()
      throw error
    }
  }

  private validatePorts(): void {
    for (const { definition } of this.entries) {
      if (definition.queue && !definition.queue.enabled) continue
      if (definition.kind === 'durable') {
        const reader = this.modules.get<Record<string, unknown>>(definition.tokens.reader, {
          strict: false,
        })
        const control = this.modules.get<Record<string, unknown>>(definition.tokens.control, {
          strict: false,
        })
        if (
          ['readSummary', 'list', 'detail'].some(
            (method) => typeof reader[method] !== 'function'
          ) ||
          ['lock', 'eligibility', 'apply'].some((method) => typeof control[method] !== 'function')
        )
          throw new Error('MISSING_DURABLE_PORT')
      }
      if (!this.bindings.some((binding) => binding.workId === definition.id)) continue
      for (const [key, token] of Object.entries(definition.tokens.handlers)) {
        const handler = this.modules.get<WorkHandler>(token, { strict: false })
        if (
          typeof handler.run !== 'function' ||
          (definition.legacy && typeof handler.runLegacyWake !== 'function') ||
          (definition.jobs[key.slice(0, key.lastIndexOf('@'))]?.replay.kind === 'provider-window' &&
            typeof handler.prepareRequest !== 'function')
        )
          throw new Error(`INVALID_WORK_HANDLER:${definition.id}:${key}`)
      }
      if (
        Object.values(definition.jobs).some((job) => job.replay.kind === 'provider-window') &&
        !this.modules.get(PROVIDER_WINDOW_EXECUTION, { strict: false })
      )
        throw new Error('MISSING_PROVIDER_WINDOW_EXECUTION')
    }
  }

  private validateProcessors(): void {
    const known = new Set(this.bindings.map((binding) => binding.host))
    const observed = new Set<Type<WorkerHost>>()
    for (const provider of this.discovery.getProviders()) {
      const type =
        !provider.metatype || provider.inject ? provider.instance?.constructor : provider.metatype
      if (!type || !Reflect.hasMetadata('bullmq:processor_metadata', type)) continue
      if (!known.has(type as Type<WorkerHost>)) throw new Error('UNREGISTERED_WORK_PROCESSOR')
      if (!provider.isDependencyTreeStatic() || observed.has(type as Type<WorkerHost>))
        throw new Error('DUPLICATE_OR_SCOPED_WORK_PROCESSOR')
      const options = Reflect.getMetadata('bullmq:worker_metadata', type) as { autorun?: boolean }
      if (options?.autorun !== false) throw new Error('UNSAFE_WORKER_CONFIGURATION')
      observed.add(type as Type<WorkerHost>)
    }
    if (observed.size !== known.size) throw new Error('MISSING_WORK_PROCESSOR')
  }
}
