import { CLS_ID } from 'nestjs-cls'

import { isCorrelationId } from '../../common/utils/correlation-id.js'

/**
 * Reads the request correlation ID from a queued job envelope before the envelope is parsed.
 * The value only becomes a log field, so the bounded ID format is the whole check; anything
 * else (absent, legacy payload, malformed) yields no ID and the worker line carries none.
 */
export function peekCorrelationId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const value = (data as { correlationId?: unknown }).correlationId
  return isCorrelationId(value) ? value : undefined
}

/** CLS store for one job run: the request ID (when the envelope has one) plus the job identity. */
export function workerLogStore(
  workId: string,
  job: { id?: string; data?: unknown }
): Record<string | symbol, string> {
  const correlationId = peekCorrelationId(job.data)
  return {
    ...(correlationId ? { [CLS_ID]: correlationId } : {}),
    workId,
    ...(job.id ? { jobId: job.id } : {}),
  }
}
