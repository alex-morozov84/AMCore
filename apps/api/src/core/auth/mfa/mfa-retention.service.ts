import { Injectable } from '@nestjs/common'

import {
  errorCode,
  ScheduledJobExecutor,
} from '../../../infrastructure/schedule/scheduled-job.executor.js'
import {
  failed,
  partial,
  ScheduledJob,
  type ScheduledJobResult,
  succeeded,
} from '../../../infrastructure/schedule/scheduled-job.js'
import { MFA_RETENTION_JOB } from '../../../infrastructure/schedule/scheduled-jobs.catalogue.js'
import { PrismaService } from '../../../prisma/index.js'

import { lockRetentionCandidates } from './mfa-retention-locks.js'
import {
  MFA_RETENTION_BUCKETS,
  type MfaRetentionBucket,
  pruneRetentionCandidates,
  retentionCandidates,
} from './mfa-retention-query.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

/** Two bounded rounds; read-time expiry never depends on this sweep. */
@Injectable()
export class MfaRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: ScheduledJobExecutor
  ) {}

  @ScheduledJob(MFA_RETENTION_JOB)
  async scheduledRetention(): Promise<void> {
    await this.jobs.run(MFA_RETENTION_JOB, () => this.sweep())
  }

  async prune(
    bucket: MfaRetentionBucket,
    onExamined: (count: number) => void = () => undefined
  ): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const candidates = await retentionCandidates(tx, bucket, await mfaDatabaseClock(tx))
        onExamined(candidates.length)
        if (!candidates.length) return 0
        await lockRetentionCandidates(tx, candidates)
        return pruneRetentionCandidates(tx, bucket, candidates, await mfaDatabaseClock(tx))
      },
      { maxWait: 2000, timeout: 4000 }
    )
  }

  async sweep(): Promise<ScheduledJobResult> {
    const counts = {
      drafts: 0,
      receipts: 0,
      settingsStarts: 0,
      logoutReceipts: 0,
      flows: 0,
      families: 0,
      contexts: 0,
      examined: 0,
      removed: 0,
      batches: 0,
      truncated: 0,
    }
    const codes: string[] = []
    for (let round = 0; round < 2; round += 1) {
      for (const bucket of MFA_RETENTION_BUCKETS) {
        counts.batches += 1
        try {
          const removed = await this.prune(bucket, (count) => {
            counts.examined += count
          })
          counts[bucket] += removed
          counts.removed += removed
        } catch {
          if (!codes.includes(bucket)) codes.push(bucket)
        }
      }
    }
    try {
      const now = await mfaDatabaseClock(this.prisma)
      for (const bucket of MFA_RETENTION_BUCKETS)
        if ((await retentionCandidates(this.prisma, bucket, now, 1)).length) counts.truncated = 1
    } catch (error) {
      codes.push(errorCode(error))
    }
    const summary = { counts, codes }
    if (codes.length)
      return MFA_RETENTION_BUCKETS.some((bucket) => counts[bucket] > 0)
        ? partial('retention_incomplete', summary)
        : failed('retention_failed', summary)
    return counts.truncated ? partial('batch_limit', summary) : succeeded(summary)
  }
}
