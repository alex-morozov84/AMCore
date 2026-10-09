import { Module } from '@nestjs/common'

import { NotificationDispatchGate } from './notification-dispatch.gate'
import { NotificationShutdownLatch } from './notification-shutdown.latch'

/** Shared worker capability; importing the same module preserves physical capacity. */
@Module({
  providers: [
    NotificationShutdownLatch,
    {
      provide: NotificationDispatchGate,
      useFactory: (latch: NotificationShutdownLatch) => new NotificationDispatchGate(latch),
      inject: [NotificationShutdownLatch],
    },
  ],
  exports: [NotificationShutdownLatch, NotificationDispatchGate],
})
export class NotificationExecutionModule {}
