import { getQueueToken, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, type Type } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import type { Job, Queue } from 'bullmq'
import { DelayedError, UnrecoverableError } from 'bullmq'

import { workReasonSchema } from '@amcore/shared'

import type { WorkDefinition, WorkHandler } from './work-definition'
import { WorkExecutionService } from './work-execution.service'

/** One generated host per definition; business modules export handlers, never raw processors. */
export function managedProcessor(definition: WorkDefinition): Type<WorkerHost> {
  const queueName = definition.queue?.name
  if (!queueName) throw new Error('MISSING_QUEUE_DEFINITION')
  class ManagedProcessor extends WorkerHost {
    constructor(
      @Inject(getQueueToken(queueName)) private readonly queue: Queue,
      @Inject(WorkExecutionService) private readonly execution: WorkExecutionService,
      @Inject(ModuleRef) private readonly modules: ModuleRef
    ) {
      super()
    }

    async process(job: Job, token?: string): Promise<void> {
      if (this.execution.discardSecret(definition, job)) return
      const current = definition.jobs[job.name]?.wireVersion
      const version =
        job.data && typeof job.data === 'object' && 'protocolVersion' in job.data
          ? job.data.jobVersion
          : current
      const handlerToken = definition.tokens.handlers[`${job.name}@${version}`]
      if (!handlerToken || !token) throw new UnrecoverableError('VERSION_UNSUPPORTED')
      const handler = this.modules.get<WorkHandler>(handlerToken, { strict: false })
      try {
        await this.execution.run(definition, this.queue, job, token, handler)
      } catch (error) {
        if (error instanceof DelayedError) throw error
        if (error instanceof UnrecoverableError) {
          const reason = workReasonSchema.safeParse(error.message)
          throw new UnrecoverableError(reason.success ? reason.data : 'PERMANENT_FAILURE')
        }
        // Bull stores failedReason/stacktrace. Never persist a renderer/provider/DB exception.
        throw new Error('TRANSIENT_FAILURE')
      }
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, error: Error): void {
      const binding = this.binding(job)
      binding?.onFailed?.(
        job,
        error instanceof UnrecoverableError || error.name === 'UnrecoverableError'
          ? new UnrecoverableError('PERMANENT_FAILURE')
          : new Error('TRANSIENT_FAILURE')
      )
    }

    @OnWorkerEvent('error')
    onError(): void {
      const handlers = new Set(
        Object.values(definition.tokens.handlers).map((token) =>
          this.modules.get<WorkHandler>(token, { strict: false })
        )
      )
      for (const handler of handlers) handler.onError?.(new Error('WORK_UNAVAILABLE'))
    }

    private binding(job: Job): WorkHandler | undefined {
      const version =
        job.data?.protocolVersion === 1
          ? job.data.jobVersion
          : definition.jobs[job.name]?.wireVersion
      // Unsupported versions still need the current binding's safe failure observer.
      // This fallback is never used for business execution or preparation.
      const token =
        definition.tokens.handlers[`${job.name}@${version}`] ??
        definition.tokens.handlers[`${job.name}@${definition.jobs[job.name]?.wireVersion}`]
      return token ? this.modules.get<WorkHandler>(token, { strict: false }) : undefined
    }
  }
  Processor(queueName, { autorun: false })(ManagedProcessor)
  Object.defineProperty(ManagedProcessor, 'name', { value: `Managed_${definition.id}` })
  return ManagedProcessor
}
