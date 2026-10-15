import { Module } from '@nestjs/common'

import { configuredNotificationsCore } from './notification-composition.js'
import { NotificationsCoreModule } from './notifications-core.module.js'

@Module({ imports: [configuredNotificationsCore], exports: [NotificationsCoreModule] })
export class NotificationsModule {}
