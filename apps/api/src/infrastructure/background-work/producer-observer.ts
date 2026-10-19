import type { PinoLogger } from 'nestjs-pino'

export interface EnqueuedEvent {
  readonly queue: string
  readonly workId: string
  readonly jobName: string
  readonly jobId: string
  readonly incarnation: string
  /** True when an existing job with this ID won; `incarnation` is then the first request's. */
  readonly duplicate: boolean
}

/** What a producer reports about its caller, kept out of the producer's closed job surface. */
export interface ProducerObserver {
  enqueued(event: EnqueuedEvent): void
}

/**
 * One searchable line per `add`. The logging mixin supplies the request `correlationId`, so a
 * duplicate add still links the second request to the job that the first request created.
 */
export function createProducerObserver(logger: PinoLogger): ProducerObserver {
  return {
    enqueued: (event) => logger.info({ event: 'job.enqueued', ...event }, 'Managed job enqueued'),
  }
}
