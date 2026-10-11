import { Module } from '@nestjs/common'

import { NotificationsModule } from '../notifications.module'

import { notificationDeliveriesWork } from './notification-deliveries.work'
import { NotificationWorkControl } from './notification-work-control'
import { NotificationWorkReader } from './notification-work-reader'

import { PrismaModule } from '@/prisma'

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
