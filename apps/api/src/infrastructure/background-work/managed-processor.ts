import { getQueueToken, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Optional, type Type } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import type { Job, Queue } from 'bullmq'
import { DelayedError, UnrecoverableError } from 'bullmq'
import { ClsService } from 'nestjs-cls'
import { PinoLogger } from 'nestjs-pino'

import { workReasonSchema } from '@amcore/shared'

import { jobRunEvent } from './job-run-log.js'
import type { WorkDefinition, WorkHandler } from './work-definition.js'
import { WorkExecutionService } from './work-execution.service.js'
import { workerLogStore } from './worker-log-context.js'

/** One generated host per definition; business modules export handlers, never raw processors. */
export function managedProcessor(definition: WorkDefinition): Type<WorkerHost> {
  const queueName = definition.queue?.name
  if (!queueName) throw new Error('MISSING_QUEUE_DEFINITION')
  const queueLabel: string = queueName
  class ManagedProcessor extends WorkerHost {
    constructor(
      @Inject(getQueueToken(queueName)) private readonly queue: Queue,
      @Inject(WorkExecutionService) private readonly execution: WorkExecutionService,
      @Inject(ModuleRef) private readonly modules: ModuleRef,
      @Optional() @Inject(ClsService) private readonly cls?: ClsService,
      @Optional() @Inject(PinoLogger) private readonly logger?: PinoLogger
    ) {
      super()
    }

    /** Runs each job in its own log context: request ID (if any), work ID and job ID. */
    process(job: Job, token?: string): Promise<void> {
      // The application always provides CLS; a processor built by hand without it still runs.
      if (!this.cls) return this.reported(job, token)
      return this.cls.runWith(workerLogStore(definition.id, job), () => this.reported(job, token))
    }

    /** Logs one `job.finished` line inside the job's log context, then rethrows any failure. */
    private async reported(job: Job, token?: string): Promise<void> {
      const started = performance.now()
      const finish = (error?: unknown): void => {
        const event = jobRunEvent(
          queueLabel,
          job.name,
          error,
          Math.round(performance.now() - started)
        )
        if (event.outcome === 'completed' || event.outcome === 'delayed')
          this.logger?.info(event, 'Job finished')
        else this.logger?.warn(event, 'Job did not finish')
      }
      try {
        await this.run(job, token)
      } catch (error) {
        finish(error)
        throw error
      }
      finish()
    }

    private async run(job: Job, token?: string): Promise<void> {
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
