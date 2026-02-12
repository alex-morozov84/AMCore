import type { JobsOptions, KeepJobs } from 'bullmq'

/**
 * Extended job options with common defaults
 */
export interface JobOptions extends Partial<JobsOptions> {
  /**
   * Priority (0-10, higher is better)
   * @default 5
   */
  priority?: number

  /**
   * Delay in milliseconds before job starts
   */
  delay?: number

  /**
   * Number of attempts before job fails
   * @default 3
   */
  attempts?: number

  /**
   * Backoff strategy for retries
   * @default exponential (2^attempt * 1000ms)
   */
  backoff?: {
    type: 'exponential' | 'fixed'
    delay?: number
  }

  /**
   * Remove job after completion
   * @default true
   */
  removeOnComplete?: boolean | number | KeepJobs

  /**
   * Remove job after failure
   * @default false (keep for debugging)
   */
  removeOnFail?: boolean | number | KeepJobs
}

/**
 * Default job options applied to all jobs
 */
export const DEFAULT_JOB_OPTIONS: JobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: {
    age: 3600, // 1 hour
    count: 100, // keep last 100
  },
  removeOnFail: {
    age: 86400, // 24 hours
    count: 1000, // keep last 1000
  },
}
