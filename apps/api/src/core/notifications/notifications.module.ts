import { Module } from '@nestjs/common'

import { configuredNotificationsCore } from './notification-composition'
import { NotificationsCoreModule } from './notifications-core.module'

@Module({ imports: [configuredNotificationsCore], exports: [NotificationsCoreModule] })
export class NotificationsModule {}
