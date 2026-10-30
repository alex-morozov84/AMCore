import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'

import { AuditLogService } from '../src/core/audit/audit-log.service.js'
import { MfaFlowVerificationService } from '../src/core/auth/mfa/mfa-flow-verification.service.js'
import { MfaSecurityEvents } from '../src/core/auth/mfa/mfa-security-events.service.js'
import type { MfaSourceLimiterService } from '../src/core/auth/mfa/mfa-source-limiter.service.js'
import { ChannelTargetResolverRegistry } from '../src/core/notifications/channels/channel-target-resolver.registry.js'
import { NotificationDefinitionRegistry } from '../src/core/notifications/notification-definition.registry.js'
import { NotificationPreferenceRepository } from '../src/core/notifications/notification-preference.repository.js'
import { NotificationPreferenceResolver } from '../src/core/notifications/notification-preference.resolver.js'
import { NotificationsService } from '../src/core/notifications/notifications.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import type { MfaProofFixture } from './mfa-proof.fixture.js'

/** Real DB notification producer/audit; no external delivery or Redis publication inside the tx. */
export function verificationFixture(
  fixture: MfaProofFixture,
  index = 0
): {
  notifications: NotificationsService
  service: MfaFlowVerificationService
  events: MfaSecurityEvents
} {
  const db = fixture.clients[index]! as unknown as PrismaService
  const logger = { setContext: () => undefined } as unknown as PinoLogger
  const cls = { get: () => undefined, getId: () => 'mfa-fixture' } as unknown as ClsService
  const outsideTransaction = (): never => {
    throw new Error('Unexpected external publication during MFA transaction')
  }
  const notifications = new NotificationsService(
    db,
    new NotificationDefinitionRegistry(),
    new NotificationPreferenceResolver(),
    new NotificationPreferenceRepository(db),
    new ChannelTargetResolverRegistry(),
    { addJob: outsideTransaction } as never,
    { publish: outsideTransaction } as never,
    logger
  )
  const events = new MfaSecurityEvents(new AuditLogService(db, cls, logger), notifications)
  // Shared-source Redis semantics are covered separately; this fixture isolates DB orchestration.
  const limiter = { consume: async () => undefined } as unknown as MfaSourceLimiterService
  return {
    events,
    notifications,
    service: new MfaFlowVerificationService(db, fixture.first, limiter, events),
  }
}
