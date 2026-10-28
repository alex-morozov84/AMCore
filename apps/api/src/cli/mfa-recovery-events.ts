import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'

import { AuditLogService } from '../core/audit/audit-log.service.js'
import { MfaSecurityEvents } from '../core/auth/mfa/mfa-security-events.service.js'
import { ChannelTargetResolverRegistry } from '../core/notifications/channels/channel-target-resolver.registry.js'
import { NotificationDefinitionRegistry } from '../core/notifications/notification-definition.registry.js'
import { NotificationPreferenceRepository } from '../core/notifications/notification-preference.repository.js'
import { NotificationPreferenceResolver } from '../core/notifications/notification-preference.resolver.js'
import { NotificationsService } from '../core/notifications/notifications.service.js'
import type { NotificationRealtimePublisher } from '../core/notifications/realtime/notification-realtime.publisher.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { QueueService } from '../infrastructure/queue/queue.service.js'
import type { PrismaService } from '../prisma/index.js'

/** Only the existing transactional producers run; workers discover committed intent through their poller. */
export function offlineMfaEvents(db: PrismaClient): MfaSecurityEvents {
  const unavailable = (): never => {
    throw new Error('External publication is unavailable in offline recovery')
  }
  const prisma = db as unknown as PrismaService
  const logger = { setContext: () => undefined, warn: unavailable } as unknown as PinoLogger
  const cls = { get: () => undefined, getId: () => undefined } as unknown as ClsService
  const notifications = new NotificationsService(
    prisma,
    new NotificationDefinitionRegistry(),
    new NotificationPreferenceResolver(),
    new NotificationPreferenceRepository(prisma),
    new ChannelTargetResolverRegistry(),
    { add: unavailable } as unknown as QueueService,
    { publish: unavailable } as unknown as NotificationRealtimePublisher,
    logger
  )
  return new MfaSecurityEvents(new AuditLogService(prisma, cls, logger), notifications)
}
