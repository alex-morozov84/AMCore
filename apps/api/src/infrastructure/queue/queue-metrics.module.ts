import { Module } from '@nestjs/common'

import { QueueModule } from './queue.module'
import { QueueDepthMetricsCollector } from './queue-depth-metrics.collector'

@Module({
  imports: [QueueModule],
  providers: [QueueDepthMetricsCollector],
})
export class QueueMetricsModule {}
