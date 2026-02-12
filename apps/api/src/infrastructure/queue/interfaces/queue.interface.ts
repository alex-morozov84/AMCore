import type { Job, Queue } from 'bullmq'

import type { JobOptions } from './job-options.interface'

/**
 * Queue service interface
 */
export interface IQueueService {
  /**
   * Add a job to a queue
   */
  add<T = unknown>(
    queueName: string,
    jobName: string,
    data: T,
    options?: JobOptions
  ): Promise<Job<T>>

  /**
   * Get a queue instance by name
   */
  getQueue(queueName: string): Queue | undefined

  /**
   * Remove a job by ID
   */
  removeJob(queueName: string, jobId: string): Promise<void>

  /**
   * Get job by ID
   */
  getJob<T = unknown>(queueName: string, jobId: string): Promise<Job<T> | undefined>

  /**
   * Get all active jobs
   */
  getActiveJobs(queueName: string): Promise<Job[]>

  /**
   * Get all failed jobs
   */
  getFailedJobs(queueName: string): Promise<Job[]>

  /**
   * Retry a failed job
   */
  retryJob(queueName: string, jobId: string): Promise<void>

  /**
   * Pause a queue
   */
  pauseQueue(queueName: string): Promise<void>

  /**
   * Resume a queue
   */
  resumeQueue(queueName: string): Promise<void>

  /**
   * Clean old jobs from a queue
   */
  cleanQueue(queueName: string, grace: number, status: 'completed' | 'failed'): Promise<string[]>
}

/**
 * Job processor interface
 */
export interface IJobProcessor<T = unknown> {
  process(job: Job<T>): Promise<unknown>
}
