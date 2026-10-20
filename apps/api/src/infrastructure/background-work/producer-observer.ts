import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'

import { isCorrelationId } from '../../common/utils/correlation-id.js'

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
  /** The request that is adding the job, if the call runs inside one. */
  correlationId(): string | undefined
  enqueued(event: EnqueuedEvent): void
}

/**
 * One searchable line per `add`. The logging mixin supplies the request `correlationId`, so a
 * duplicate add still links the second request to the job that the first request created.
 */
export function createProducerObserver(logger: PinoLogger, cls: ClsService): ProducerObserver {
  return {
    correlationId: () => {
      const id = cls.getId()
      return isCorrelationId(id) ? id : undefined
    },
    enqueued: (event) => logger.info({ event: 'job.enqueued', ...event }, 'Managed job enqueued'),
  }
}
