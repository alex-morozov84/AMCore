import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { NotFoundException } from '../../common/exceptions'
import type {
  ManagedJobIdentity,
  ManagedJobOptions,
  ManagedProducer,
} from '../background-work/managed-producer'
import { MANAGED_PRODUCERS } from '../background-work/registration'
import type { WorkDefinition } from '../background-work/work-definition'

import { QUEUE_REGISTRY } from './constants/queue-inventory.constant'
import type { QueueName } from './constants/queues.constant'
import type { IQueueService } from './interfaces/queue.interface'

import { MetricsService } from '@/infrastructure/observability'

@Injectable()
export class QueueService implements IQueueService, OnModuleInit {
  private readonly queues: ReadonlyMap<QueueName, Queue>

  constructor(
    @Inject(QUEUE_REGISTRY) queues: ReadonlyMap<QueueName, Queue>,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
    @Inject(MANAGED_PRODUCERS)
    private readonly producers: ReadonlyMap<string, ManagedProducer<WorkDefinition>>
  ) {
    this.logger.setContext(QueueService.name)
    // One registry built from the enabled inventory; the public add/get API is unchanged.
    this.queues = queues

    this.logger.info({ count: this.queues.size }, `Initialized ${this.queues.size} queues`)
  }

  /**
   * Producer-side Redis observability (EQS-06). Surfaces a Redis outage on the
   * *producer* path (`queue.redis_error`) instead of it being silent until jobs
   * visibly stop. The worker's blocking connection is observed separately via
   * the managed host's worker error event and the registered email handler.
   *
   * MUST NOT block bootstrap. `queue.getBackend().client` (BullMQ 6's Redis-
   * specific escape hatch, replacing the removed `Queue#client`) is BullMQ's
   * ready-gated `initializing` promise — with Redis down and our (deliberately
   * unbounded) `retryStrategy`, it may never settle, so awaiting it here would
   * hang Nest boot. Therefore:
   * - `error` is attached **synchronously** on the BullMQ `Queue` (QueueBase
   *   re-emits underlying connection errors; attaching also prevents the
   *   default throw-on-unhandled-`error`).
   * - `reconnecting` (only on the raw ioredis client) is attached
   *   **fire-and-forget** via `void queue.getBackend().client.then(...)` —
   *   never awaited; the `.catch` swallows a rejected/never-ready client.
   */
  onModuleInit(): void {
    for (const [queueName, queue] of this.queues) {
      // ioredis emits `error` per failed command/connect attempt; our
      // retryStrategy caps the reconnect interval at 2s, so a sustained outage
      // logs at most ~1/2s — no throttle needed.
      queue.on('error', (err: Error) => {
        this.metrics.incRedisClientEvent('queue_producer', 'error')
        this.metrics.incQueueEvent(queueName, 'redis_error')
        this.logger.error({ event: 'queue.redis_error', queueName, err }, 'Queue Redis error')
      })

      void queue
        .getBackend()
        .client.then((client) => {
          client.on('reconnecting', () => {
            this.metrics.incRedisClientEvent('queue_producer', 'reconnecting')
            this.metrics.incQueueEvent(queueName, 'redis_reconnecting')
            this.logger.warn(
              { event: 'queue.redis_reconnecting', queueName },
              'Queue Redis reconnecting'
            )
          })
        })
        .catch((err: unknown) =>
          this.logger.warn(
            { queueName, err: err instanceof Error ? err.message : 'unknown' },
            'Failed to attach queue reconnecting listener'
          )
        )
    }
  }

  async add<T = unknown>(
    queueName: string,
    jobName: string,
    data: T,
    options?: ManagedJobOptions
  ): Promise<ManagedJobIdentity> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException('Queue', queueName)
    }

    const producer = this.producers.get(queueName)
    if (!producer) throw new Error('ACTION_UNAVAILABLE')
    const identity = await producer.add(jobName, data, options)

    this.metrics.incQueueEvent(queueName as QueueName, 'job_added')
    this.logger.info(
      { jobId: identity.jobId, jobName, queueName },
      `Job added to queue "${queueName}"`
    )

    return identity
  }

  getQueue(queueName: string): Queue | undefined {
    return this.queues.get(queueName as QueueName)
  }
}
