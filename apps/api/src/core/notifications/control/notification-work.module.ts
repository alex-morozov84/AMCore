import { Module } from '@nestjs/common'

import { PrismaModule } from '../../../prisma/index.js'
import { NotificationsModule } from '../notifications.module.js'

import { notificationDeliveriesWork } from './notification-deliveries.work.js'
import { NotificationWorkControl } from './notification-work-control.js'
import { NotificationWorkReader } from './notification-work-reader.js'

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [
    NotificationWorkReader,
    NotificationWorkControl,
    { provide: notificationDeliveriesWork.tokens.reader, useExisting: NotificationWorkReader },
    { provide: notificationDeliveriesWork.tokens.control, useExisting: NotificationWorkControl },
  ],
  exports: [notificationDeliveriesWork.tokens.reader, notificationDeliveriesWork.tokens.control],
})
export class NotificationWorkModule {}
