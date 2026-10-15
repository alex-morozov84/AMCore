import { Module } from '@nestjs/common'

import { QueueService } from './queue.service.js'
import { QueueObservationService } from './queue-observation.service.js'

/** Compatibility facade over the generated work runtime; no separate Bull/queue registration. */
@Module({
  providers: [QueueService, QueueObservationService],
  exports: [QueueService, QueueObservationService],
})
export class QueueModule {}
