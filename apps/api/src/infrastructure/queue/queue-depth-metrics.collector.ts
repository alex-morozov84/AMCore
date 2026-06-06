import { Injectable } from '@nestjs/common'
import type { JobType } from 'bullmq'

import { QueueName } from './constants/queues.constant'
import { QueueService } from './queue.service'

import { METRIC_NAMES, MetricsService } from '@/infrastructure/observability'

const QUEUE_DEPTH_STATES = [
  ['waiting', 'waiting'],
  ['active', 'active'],
  ['delayed', 'delayed'],
  ['completed', 'completed'],
  ['failed', 'failed'],
  ['paused', 'paused'],
  ['prioritized', 'prioritized'],
  ['waiting-children', 'waiting_children'],
] as const satisfies ReadonlyArray<readonly [JobType, string]>

type QueueDepthMetricState = (typeof QUEUE_DEPTH_STATES)[number][1]
type QueueDepthLabels = 'queue' | 'state'
type QueueDepthSnapshot = Array<{
  queue: QueueName
  counts: Record<string, number>
}>

@Injectable()
export class QueueDepthMetricsCollector {
  constructor(metrics: MetricsService, queueService: QueueService) {
    metrics.registerGauge<QueueDepthLabels>({
      name: METRIC_NAMES.queueJobs,
      help: 'BullMQ jobs by queue and state from worker-capable process roles.',
      labelNames: ['queue', 'state'],
      collect: async (gauge) => {
        const snapshot = await metrics.withCollectorTimeout<QueueDepthSnapshot | null>(
          'queue_depth',
          this.collectSnapshot(queueService),
          null
        )

        gauge.reset()
        if (!snapshot) return

        for (const { queue, counts } of snapshot) {
          for (const [bullState, metricState] of QUEUE_DEPTH_STATES) {
            gauge.set(
              { queue, state: metricState as QueueDepthMetricState },
              counts[bullState] ?? 0
            )
          }
        }
      },
    })
  }

  private async collectSnapshot(queueService: QueueService): Promise<QueueDepthSnapshot> {
    const bullStates = QUEUE_DEPTH_STATES.map(([state]) => state)

    return Promise.all(
      Object.values(QueueName).map(async (queueName) => {
        const queue = queueService.getQueue(queueName)
        if (!queue) {
          throw new Error(`Queue "${queueName}" is not registered`)
        }

        return {
          queue: queueName,
          counts: await queue.getJobCounts(...bullStates),
        }
      })
    )
  }
}
