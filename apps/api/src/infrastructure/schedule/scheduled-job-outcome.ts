import type { ScheduledSummary } from '@amcore/shared'

import { failed, partial, type ScheduledJobResult, succeeded } from './scheduled-job.js'

/**
 * Outcome of a job that runs independent buckets and reports `failures` instead of throwing
 * (cleanup, notification retention). No failed bucket is success, some is partial, all is failed.
 * Counts and bucket names only: no row content reaches the evidence.
 */
export function bucketOutcome(result: { failures: readonly string[] }): ScheduledJobResult {
  const counts: Record<string, number> = {}
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number') counts[key] = value
  }
  const summary: ScheduledSummary = { counts, codes: [...result.failures].slice(0, 8) }
  const buckets = Object.keys(counts).length
  if (result.failures.length === 0) return succeeded(summary)
  if (result.failures.length >= buckets) return failed('all_buckets_failed', summary)
  return partial('bucket_failed', summary)
}
