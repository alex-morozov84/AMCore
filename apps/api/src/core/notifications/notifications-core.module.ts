import { type DynamicModule, Module } from '@nestjs/common'

import { EnvService } from '../../env/env.service.js'
import { QueueModule } from '../../infrastructure/queue/index.js'
import { PrismaModule } from '../../prisma/index.js'

import { ChannelTargetResolverRegistry } from './channels/channel-target-resolver.registry.js'
import type { ChannelTargetResolver } from './channels/channel-target-resolver.types.js'
import { NotificationChannelRegistry } from './channels/notification-channel.registry.js'
import type { NotificationChannelDescriptor } from './channels/notification-channel.types.js'
import { NotificationControlTargets } from './channels/notification-control-targets.js'
import { NotificationDefinitionRegistry } from './notification-definition.registry.js'
import type { NotificationDefinitionRegistration } from './notification-definition.types.js'
import { NotificationPreferenceRepository } from './notification-preference.repository.js'
import { NotificationPreferenceResolver } from './notification-preference.resolver.js'
import { NotificationsService } from './notifications.service.js'
import { NotificationRealtimePublisher } from './realtime/notification-realtime.publisher.js'

export interface NotificationRegistration {
  definitions: readonly NotificationDefinitionRegistration[]
  channels: readonly NotificationChannelDescriptor[]
}

/** Construct once and re-export through a static application facade. */
@Module({})
export class NotificationsCoreModule {
  static register({ definitions, channels }: NotificationRegistration): DynamicModule {
    return {
      module: NotificationsCoreModule,
      imports: [PrismaModule, QueueModule, ...channels.map((channel) => channel.core.module)],
      providers: [
        {
          provide: NotificationChannelRegistry,
          useFactory: (env: EnvService) => new NotificationChannelRegistry(channels, env),
          inject: [EnvService],
        },
        {
          provide: NotificationDefinitionRegistry,
          useFactory: (registry: NotificationChannelRegistry) =>
            new NotificationDefinitionRegistry(definitions, registry),
          inject: [NotificationChannelRegistry],
        },
        {
          provide: ChannelTargetResolverRegistry,
          useFactory: (...resolvers: ChannelTargetResolver[]) => {
            for (const [index, resolver] of resolvers.entries()) {
              if (resolver.channel !== channels[index]?.id)
                throw new Error('Channel reader token mismatch')
            }
            return new ChannelTargetResolverRegistry(resolvers)
          },
          inject: channels.map((channel) => channel.core.token),
        },
        NotificationControlTargets,
        NotificationPreferenceResolver,
        NotificationPreferenceRepository,
        NotificationRealtimePublisher,
        NotificationsService,
      ],
      exports: [
        NotificationControlTargets,
        NotificationsService,
        NotificationDefinitionRegistry,
        NotificationChannelRegistry,
        NotificationPreferenceRepository,
        NotificationRealtimePublisher,
      ],
    }
  }
}
