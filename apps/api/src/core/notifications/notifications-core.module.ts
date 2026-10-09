import { type DynamicModule, Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'

import { ChannelTargetResolverRegistry } from './channels/channel-target-resolver.registry'
import type { ChannelTargetResolver } from './channels/channel-target-resolver.types'
import { NotificationChannelRegistry } from './channels/notification-channel.registry'
import type { NotificationChannelDescriptor } from './channels/notification-channel.types'
import { NotificationDefinitionRegistry } from './notification-definition.registry'
import type { NotificationDefinitionRegistration } from './notification-definition.types'
import { NotificationPreferenceRepository } from './notification-preference.repository'
import { NotificationPreferenceResolver } from './notification-preference.resolver'
import { NotificationsService } from './notifications.service'
import { NotificationRealtimePublisher } from './realtime/notification-realtime.publisher'

import { EnvService } from '@/env/env.service'
import { QueueModule } from '@/infrastructure/queue'

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
        NotificationPreferenceResolver,
        NotificationPreferenceRepository,
        NotificationRealtimePublisher,
        NotificationsService,
      ],
      exports: [
        NotificationsService,
        NotificationDefinitionRegistry,
        NotificationChannelRegistry,
        NotificationPreferenceRepository,
        NotificationRealtimePublisher,
      ],
    }
  }
}
