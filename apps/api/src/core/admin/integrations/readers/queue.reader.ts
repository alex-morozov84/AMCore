import { Injectable, Module } from '@nestjs/common'

import type { AdminQueue } from '@amcore/shared'

import { QueueModule, QueueObservationService } from '../../../../infrastructure/queue/index.js'
import type { IntegrationReader, IntegrationReading } from '../integration.types.js'

const STALE_AFTER_SECONDS = 60

/**
 * Pure aggregation of per-queue broker reads (exported for tests). No enabled queue is "disabled",
 * never a fabricated success. The check time is the oldest `sampledAt`, not the page read time.
 */
export function aggregateQueues(queues: readonly AdminQueue[], now: number): IntegrationReading {
  const enabled = queues.filter((queue) => queue.status !== 'disabled')
  const available = enabled.flatMap((queue) => (queue.status === 'available' ? [queue] : []))
  const unavailable = enabled.length - available.length
  const base = {
    scope: 'broker_read',
    instance: 'answering_instance',
    staleAfterSeconds: STALE_AFTER_SECONDS,
  } as const
  if (enabled.length === 0)
    return {
      configuration: 'disabled',
      evidence: { ...base, result: 'none', freshness: 'none', checkedAt: null, failure: null },
      facts: [],
      links: ['background_work'],
    }
  const oldest = available.length
    ? Math.min(...available.map((queue) => Date.parse(queue.sampledAt)))
    : null
  const failure = unavailable === 0 ? null : available.length === 0 ? 'unreachable' : 'partial'
  return {
    configuration: 'configured',
    evidence: {
      ...base,
      result: unavailable === 0 ? 'ok' : 'failed',
      freshness:
        oldest === null ? 'none' : now - oldest > STALE_AFTER_SECONDS * 1000 ? 'stale' : 'fresh',
      checkedAt: oldest === null ? null : new Date(oldest).toISOString(),
      failure,
    },
    facts: [
      { key: 'queues_enabled', value: enabled.length },
      { key: 'queues_unavailable', value: unavailable },
    ],
    links: ['background_work'],
  }
}

/** Queue: the broker answered a bounded, payload-free read. It does not prove workers run. */
@Injectable()
export class QueueIntegrationReader implements IntegrationReader {
  constructor(private readonly observation: QueueObservationService) {}

  async read(): Promise<IntegrationReading> {
    return aggregateQueues(await this.observation.observe(), Date.now())
  }
}

@Module({
  imports: [QueueModule],
  providers: [QueueIntegrationReader],
  exports: [QueueIntegrationReader],
})
export class QueueIntegrationModule {}
