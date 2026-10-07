import { NOTIFICATION_DISPATCH_CONCURRENCY } from '../notification-dispatch.constants'

import type { NotificationShutdownLatch } from './notification-shutdown.latch'

import { CapacityGate } from '@/infrastructure/worker-lifecycle'

/** The notification dispatcher's capacity gate: the shared gate with this subsystem's lane count. */
export class NotificationDispatchGate extends CapacityGate {
  constructor(
    latch: NotificationShutdownLatch,
    capacity: number = NOTIFICATION_DISPATCH_CONCURRENCY
  ) {
    super(latch, capacity)
  }
}
