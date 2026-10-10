import type { Queue } from 'bullmq'

import type { ManagedJobIdentity, ManagedJobOptions } from '../../background-work/managed-producer'

/** Compatibility facade. New producers inject their definition's typed producer token. */
export interface IQueueService {
  add(
    queueName: string,
    jobName: string,
    data: unknown,
    options?: ManagedJobOptions
  ): Promise<ManagedJobIdentity>
  /** Trusted internal read-only adapters only; raw mutation is outside the extension contract. */
  getQueue(queueName: string): Queue | undefined
}
