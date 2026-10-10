import { type DynamicModule, Injectable, Module, type Type } from '@nestjs/common'
import type { TestingModuleBuilder } from '@nestjs/testing'
import { z } from 'zod'

import type {
  DeliveryAdmission,
  DeliveryContext,
} from '../../../src/core/notifications/channels/channel-deliverer.types'
import type { ChannelDeliverer } from '../../../src/core/notifications/channels/channel-deliverer.types'
import type {
  ChannelTargetResolver,
  ResolvedDeliveryTarget,
  TargetResolutionContext,
} from '../../../src/core/notifications/channels/channel-target-resolver.types'
import type { NotificationChannelDescriptor } from '../../../src/core/notifications/channels/notification-channel.types'
import { preparedNotificationRequest } from '../../../src/core/notifications/channels/notification-prepared-request'
import { NOTIFICATION_DEFINITIONS } from '../../../src/core/notifications/definitions'
import { NotificationDispatchProcessor } from '../../../src/core/notifications/dispatch/notification-dispatch.processor'
import { NotificationExecutionModule } from '../../../src/core/notifications/dispatch/notification-execution.module'
import { NotificationPreparedRequestService } from '../../../src/core/notifications/dispatch/notification-prepared-request.service'
import {
  NotificationCategory,
  NotificationContentClass,
} from '../../../src/core/notifications/notification.constants'
import { NOTIFICATION_CHANNELS } from '../../../src/core/notifications/notification-composition'
import { NotificationDefinitionRegistry } from '../../../src/core/notifications/notification-definition.registry'
import type { NotificationDefinition } from '../../../src/core/notifications/notification-definition.types'
import { NotificationsModule } from '../../../src/core/notifications/notifications.module'
import { notificationsWork } from '../../../src/core/notifications/notifications.work'
import { NotificationsCoreModule } from '../../../src/core/notifications/notifications-core.module'
import {
  ConfiguredNotificationsWorkerModule,
  NotificationsWorkerModule,
} from '../../../src/core/notifications/notifications-worker.module'
import type { Prisma } from '../../../src/generated/prisma/client'
import { bindWorkHandlers } from '../../../src/infrastructure/background-work/registration'
import { PrismaModule } from '../../../src/prisma'

@Injectable()
export class FixtureSubscriptionReader implements ChannelTargetResolver {
  readonly channel = 'fixture_channel'
  async resolveTargets(
    tx: Prisma.TransactionClient,
    context: TargetResolutionContext
  ): Promise<ResolvedDeliveryTarget[]> {
    const rows = await tx.$queryRaw<{ id: string; destination: string }[]>`
      SELECT id, destination FROM core.extension_fixture_subscriptions
      WHERE "userId" = ${context.recipient.id} ORDER BY id FOR SHARE`
    return rows.map((row) => ({
      targetKey: row.destination,
      targetRef: row.id,
      destinationSnapshot: { label: 'Fixture subscription' },
    }))
  }
}
@Module({ providers: [FixtureSubscriptionReader], exports: [FixtureSubscriptionReader] })
class FixtureReaderModule {}

@Injectable()
export class FixtureChannelDeliverer implements ChannelDeliverer {
  readonly channel = 'fixture_channel'
  static readonly requests: string[] = []
  constructor(
    private readonly registry: NotificationDefinitionRegistry,
    private readonly prepared: NotificationPreparedRequestService
  ) {}
  async checkTarget(
    tx: Prisma.TransactionClient,
    context: DeliveryContext
  ): Promise<{ reason: string } | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM core.extension_fixture_subscriptions
      WHERE id = ${context.delivery.targetRef} AND "userId" = ${context.notification.recipientUserId}
        AND destination = ${context.delivery.targetKey} FOR SHARE`
    return rows.length ? null : { reason: 'fixture_target_revoked' }
  }
  async deliver(
    context: DeliveryContext,
    admission: DeliveryAdmission
  ): ReturnType<ChannelDeliverer['deliver']> {
    const key = `notification-delivery:${context.delivery.id}`
    const request = await this.prepared.obtain(
      context,
      this,
      'fixture:default',
      '/deliver',
      key,
      async () => {
        const definition = this.registry.getStored(
          context.notification.type,
          context.notification.schemaVersion
        )
        const payload = definition.payloadSchema.parse(context.notification.payload)
        const projected = definition.projectExternal!('fixture_channel', payload)
        return preparedNotificationRequest(
          context,
          'fixture:default',
          '/deliver',
          JSON.stringify({ destination: context.delivery.targetKey, text: String(projected.text) }),
          key
        )
      }
    )
    if ('status' in request) return request
    return admission.send(async () => {
      FixtureChannelDeliverer.requests.push(request.body)
      return { status: 'delivered' as const, providerMessageId: 'fixture-receipt' }
    })
  }
}
@Module({})
class FixtureDeliveryModule {
  static register(core: Type<unknown>): DynamicModule {
    return {
      module: FixtureDeliveryModule,
      imports: [core, PrismaModule, NotificationExecutionModule],
      providers: [FixtureChannelDeliverer, NotificationPreparedRequestService],
      exports: [FixtureChannelDeliverer],
    }
  }
}

export const fixtureChannel: NotificationChannelDescriptor = {
  id: 'fixture_channel',
  targetMode: 'generation',
  core: { module: FixtureReaderModule, token: FixtureSubscriptionReader },
  worker: (core) => FixtureDeliveryModule.register(core),
  delivererToken: FixtureChannelDeliverer,
  available: () => true,
  wireVersion: 1,
  requestSchema: z.object({ destination: z.string(), text: z.string() }).strict(),
  requestTargetsDelivery: (body, context) =>
    (body as { destination: string }).destination === context.delivery.targetKey,
}

export const fixtureV1: NotificationDefinition = {
  type: 'extension.fixture',
  category: NotificationCategory.PRODUCT,
  schemaVersion: 1,
  contentClass: NotificationContentClass.PUBLIC,
  supportedChannels: ['in_app', 'fixture_channel'],
  defaultChannels: ['in_app', 'fixture_channel'],
  mandatoryChannels: [],
  externalModeByChannel: {},
  payloadSchema: z.object({ text: z.string().trim() }),
  safePayload: (payload) => payload as Record<string, unknown>,
  renderInApp: (payload) => ({ title: 'Version 1', body: (payload as { text: string }).text }),
  projectExternal: (_channel, payload) => ({ text: (payload as { text: string }).text }),
  renderExternal: {
    fixture_channel: (projection) => ({ title: 'Version 1', body: String(projection.text) }),
  },
}
export const fixtureV2: NotificationDefinition = {
  ...fixtureV1,
  schemaVersion: 2,
  payloadSchema: z.object({ text: z.string(), revision: z.number().default(2) }),
  renderInApp: (payload) => ({ title: 'Version 2', body: (payload as { text: string }).text }),
}

export const fixtureChannels = [...NOTIFICATION_CHANNELS, fixtureChannel]

export function registerFixtureNotifications(builder: TestingModuleBuilder): TestingModuleBuilder {
  const configured = NotificationsCoreModule.register({
    definitions: [
      ...NOTIFICATION_DEFINITIONS,
      { definition: fixtureV1, current: false },
      { definition: fixtureV2, current: true },
    ],
    channels: fixtureChannels,
  })
  @Module({ imports: [configured], exports: [NotificationsCoreModule] })
  class FixtureNotificationsModule {}
  const worker = ConfiguredNotificationsWorkerModule.register(
    FixtureNotificationsModule,
    fixtureChannels
  )
  const bindings = bindWorkHandlers(
    notificationsWork,
    { 'dispatch-due@1': NotificationDispatchProcessor },
    [worker]
  )
  @Module({ imports: [worker, bindings], exports: [bindings] })
  class FixtureNotificationsWorkerModule {}
  return builder
    .overrideModule(NotificationsModule)
    .useModule(FixtureNotificationsModule)
    .overrideModule(NotificationsWorkerModule)
    .useModule(FixtureNotificationsWorkerModule)
}
