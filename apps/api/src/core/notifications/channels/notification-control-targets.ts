import { Injectable, type OnModuleInit } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'

import type { WorkReason } from '@amcore/shared'

import { EnvService } from '../../../env/env.service.js'
import type {
  Notification,
  NotificationDelivery,
  Prisma,
} from '../../../generated/prisma/client.js'
import { notificationProviderScope } from '../control/notification-provider-scope.js'
import { resolveExternalMode } from '../notification-content-policy.js'
import { NotificationDefinitionRegistry } from '../notification-definition.registry.js'

import { NotificationChannelRegistry } from './notification-channel.registry.js'
import type { NotificationControlTarget } from './notification-control-target.js'
import { validatePreparedRequest } from './notification-prepared-request.js'

/** Core-only validators use the supplied transaction and never resolve a new target. */
@Injectable()
export class NotificationControlTargets implements OnModuleInit {
  constructor(
    private readonly registry: NotificationChannelRegistry,
    private readonly modules: ModuleRef,
    private readonly definitions: NotificationDefinitionRegistry,
    private readonly env: EnvService
  ) {}

  onModuleInit(): void {
    for (const channel of this.registry.ids().filter((id) => id !== 'in_app')) {
      const descriptor = this.registry.get(channel)
      if (!descriptor.manualRetry) continue
      const validator = this.modules.get<NotificationControlTarget>(
        descriptor.manualRetry.validatorToken,
        { strict: false }
      )
      if (validator.channel !== channel || typeof validator.validateDelivery !== 'function')
        throw new Error('notification_control_validator_mismatch')
    }
  }

  async validate(
    tx: Prisma.TransactionClient,
    delivery: NotificationDelivery,
    notification: Notification
  ): Promise<WorkReason | null> {
    if (!this.registry.ids().includes(delivery.channel)) return 'ACTION_UNAVAILABLE'
    const descriptor = this.registry.get(delivery.channel)
    if (!descriptor.manualRetry) return 'ACTION_UNAVAILABLE'
    if (!this.registry.available(delivery.channel)) return 'WORK_UNAVAILABLE'
    try {
      const definition = this.definitions.getStored(notification.type, notification.schemaVersion)
      definition.payloadSchema.parse(notification.payload)
      if (!definition.supportedChannels.includes(delivery.channel)) return 'CONTENT_UNSUPPORTED'
      if (resolveExternalMode(definition, delivery.channel) === 'forbidden')
        return 'CONTENT_UNSUPPORTED'
      if (
        delivery.providerScope !== notificationProviderScope(this.env, delivery.channel, descriptor)
      )
        return 'PROVIDER_CHANGED'
      const identity = descriptor.manualRetry.requestIdentity(this.env, delivery.id)
      const checked = validatePreparedRequest(
        delivery.preparedRequest,
        {
          notification,
          delivery: {
            ...delivery,
            attemptNumber: delivery.attemptCount,
            leaseToken: delivery.leaseToken ?? '',
          },
        },
        descriptor,
        identity.binding,
        identity.path,
        identity.idempotencyKey
      )
      if (checked.hash !== delivery.preparedRequestHash) return 'CONTENT_UNSUPPORTED'
    } catch {
      return 'CONTENT_UNSUPPORTED'
    }
    const validator = this.modules.get<NotificationControlTarget>(
      descriptor.manualRetry.validatorToken,
      { strict: false }
    )
    return validator.validateDelivery(tx, delivery, notification.recipientUserId)
  }
}
