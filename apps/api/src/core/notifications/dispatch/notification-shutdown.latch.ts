import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import {
  CUTOFF,
  type Cutoff,
  ShutdownLatch,
  type TransactionRunner,
} from '@/infrastructure/worker-lifecycle'

export { CUTOFF, type Cutoff, type TransactionRunner }

/** The notification dispatcher's shutdown latch: the shared lifecycle latch bound to this subsystem. */
@Injectable()
export class NotificationShutdownLatch extends ShutdownLatch {
  constructor(logger: PinoLogger) {
    logger.setContext(NotificationShutdownLatch.name)
    super(logger, 'notification')
  }
}
