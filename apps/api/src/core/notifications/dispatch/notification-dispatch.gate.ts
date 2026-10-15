import { CapacityGate } from '../../../infrastructure/worker-lifecycle/index.js'
import { NOTIFICATION_DISPATCH_CONCURRENCY } from '../notification-dispatch.constants.js'

import type { NotificationShutdownLatch } from './notification-shutdown.latch.js'

/** The notification dispatcher's capacity gate: the shared gate with this subsystem's lane count. */
export class NotificationDispatchGate extends CapacityGate {
  constructor(
    latch: NotificationShutdownLatch,
    capacity: number = NOTIFICATION_DISPATCH_CONCURRENCY
  ) {
    super(latch, capacity)
  }
}
