import { Module } from '@nestjs/common'

import { QueueModule } from './queue.module.js'
import { QueueDepthMetricsCollector } from './queue-depth-metrics.collector.js'

@Module({
  imports: [QueueModule],
  providers: [QueueDepthMetricsCollector],
})
export class QueueMetricsModule {}
