import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, NotFoundException } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { QueueName } from './constants/queues.constant'
import type { JobOptions } from './interfaces/job-options.interface'
import { DEFAULT_JOB_OPTIONS } from './interfaces/job-options.interface'
import type { IQueueService } from './interfaces/queue.interface'

@Injectable()
export class QueueService implements IQueueService {
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

  async add<T = unknown>(
    queueName: string,
    jobName: string,
    data: T,
    options?: JobOptions
  ): Promise<Job<T>> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException(`Queue "${queueName}" not found`)
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
      throw new NotFoundException(`Job "${jobId}" not found in queue "${queueName}"`)
    }

    await job.remove()

    this.logger.info({ jobId, queueName }, `Job removed from queue "${queueName}"`)
  }

  async getJob<T = unknown>(queueName: string, jobId: string): Promise<Job<T> | undefined> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException(`Queue "${queueName}" not found`)
    }

    return (await queue.getJob(jobId)) as Job<T> | undefined
  }

  async getActiveJobs(queueName: string): Promise<Job[]> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException(`Queue "${queueName}" not found`)
    }

    return queue.getActive()
  }

  async getFailedJobs(queueName: string): Promise<Job[]> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException(`Queue "${queueName}" not found`)
    }

    return queue.getFailed()
  }

  async retryJob(queueName: string, jobId: string): Promise<void> {
    const job = await this.getJob(queueName, jobId)

    if (!job) {
      throw new NotFoundException(`Job "${jobId}" not found in queue "${queueName}"`)
    }

    await job.retry()

    this.logger.info({ jobId, queueName }, `Job retried in queue "${queueName}"`)
  }

  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException(`Queue "${queueName}" not found`)
    }

    await queue.pause()

    this.logger.info({ queueName }, 'Queue paused')
  }

  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName)

    if (!queue) {
      throw new NotFoundException(`Queue "${queueName}" not found`)
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
      throw new NotFoundException(`Queue "${queueName}" not found`)
    }

    const cleaned = await queue.clean(grace, 1000, status)

    this.logger.info({ queueName, status, grace, cleaned: cleaned.length }, 'Queue cleaned')

    return cleaned
  }
}
