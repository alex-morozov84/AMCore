import { InjectQueue } from '@nestjs/bullmq'
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { AppException, NotFoundException } from '../../common/exceptions'

import { QueueName } from './constants/queues.constant'
import type { JobOptions } from './interfaces/job-options.interface'
import { DEFAULT_JOB_OPTIONS } from './interfaces/job-options.interface'
import type { IQueueService } from './interfaces/queue.interface'

@Injectable()
export class QueueService implements IQueueService, OnModuleInit {
  private readonly queues = new Map<string, Queue>()

  constructor(
    @InjectQueue(QueueName.DEFAULT) defaultQueue: Queue,
    @InjectQueue(QueueName.EMAIL) emailQueue: Queue,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(QueueService.name)
    // Register all queues for easy access
    this.queues.set(QueueName.DEFAULT, defaultQueue)
    this.queues.set(QueueName.EMAIL, emailQueue)

    this.logger.info({ count: this.queues.size }, `Initialized ${this.queues.size} queues`)
  }

  /**
   * Producer-side Redis observability (EQS-06). Surfaces a Redis outage on the
   * *producer* path (`queue.redis_error`) instead of it being silent until jobs
   * visibly stop. The worker's blocking connection is observed separately via
   * `EmailProcessor`'s `@OnWorkerEvent('error')`.
   *
   * MUST NOT block bootstrap. `queue.client` is BullMQ's ready-gated
   * `initializing` promise — with Redis down and our (deliberately unbounded)
   * `retryStrategy`, it may never settle, so awaiting it here would hang Nest
   * boot. Therefore:
   * - `error` is attached **synchronously** on the BullMQ `Queue` (QueueBase
   *   re-emits underlying connection errors; attaching also prevents the
   *   default throw-on-unhandled-`error`).
   * - `reconnecting` (only on the raw ioredis client) is attached
   *   **fire-and-forget** via `void queue.client.then(...)` — never awaited;
   *   the `.catch` swallows a rejected/never-ready client.
   */
  onModuleInit(): void {
    for (const [queueName, queue] of this.queues) {
      // ioredis emits `error` per failed command/connect attempt; our
      // retryStrategy caps the reconnect interval at 2s, so a sustained outage
      // logs at most ~1/2s — no throttle needed.
      queue.on('error', (err: Error) => {
        this.logger.error({ event: 'queue.redis_error', queueName, err }, 'Queue Redis error')
      })

      void queue.client
        .then((client) => {
          client.on('reconnecting', () => {
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
    options?: JobOptions
  ): Promise<Job<T>> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException('Queue', queueName)
    }

    const mergedOptions = { ...DEFAULT_JOB_OPTIONS, ...options }

    const job = await queue.add(jobName, data, mergedOptions)

    this.logger.info({ jobId: job.id, jobName, queueName }, `Job added to queue "${queueName}"`)

    return job as Job<T>
  }

  getQueue(queueName: string): Queue | undefined {
    return this.queues.get(queueName)
  }

  async removeJob(queueName: string, jobId: string): Promise<void> {
    const job = await this.getJob(queueName, jobId)

    if (!job) {
      throw new AppException(
        `Job "${jobId}" not found in queue "${queueName}"`,
        HttpStatus.NOT_FOUND,
        'RESOURCE_NOT_FOUND',
        { resource: 'Job', jobId, queueName }
      )
    }

    await job.remove()

    this.logger.info({ jobId, queueName }, `Job removed from queue "${queueName}"`)
  }

  async getJob<T = unknown>(queueName: string, jobId: string): Promise<Job<T> | undefined> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException('Queue', queueName)
    }

    return (await queue.getJob(jobId)) as Job<T> | undefined
  }

  async getActiveJobs(queueName: string): Promise<Job[]> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException('Queue', queueName)
    }

    return queue.getActive()
  }

  async getFailedJobs(queueName: string): Promise<Job[]> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException('Queue', queueName)
    }

    return queue.getFailed()
  }

  async retryJob(queueName: string, jobId: string): Promise<void> {
    const job = await this.getJob(queueName, jobId)

    if (!job) {
      throw new AppException(
        `Job "${jobId}" not found in queue "${queueName}"`,
        HttpStatus.NOT_FOUND,
        'RESOURCE_NOT_FOUND',
        { resource: 'Job', jobId, queueName }
      )
    }

    await job.retry()

    this.logger.info({ jobId, queueName }, `Job retried in queue "${queueName}"`)
  }

  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException('Queue', queueName)
    }

    await queue.pause()

    this.logger.info({ queueName }, 'Queue paused')
  }

  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException('Queue', queueName)
    }

    await queue.resume()

    this.logger.info({ queueName }, 'Queue resumed')
  }

  async cleanQueue(
    queueName: string,
    grace: number,
    status: 'completed' | 'failed'
  ): Promise<string[]> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException('Queue', queueName)
    }

    const cleaned = await queue.clean(grace, 1000, status)

    this.logger.info({ queueName, status, grace, cleaned: cleaned.length }, 'Queue cleaned')

    return cleaned
  }
}
