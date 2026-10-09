import { Injectable } from '@nestjs/common'

import type { NotificationChannel } from '../notification.constants'

import type { ChannelTargetResolver } from './channel-target-resolver.types'
import { EmailTargetResolver } from './email-target.resolver'
import { TelegramTargetResolver } from './telegram/telegram-target.resolver'

/**
 * External channel target resolvers active in this build (in-app is excluded — it is
 * materialized `DELIVERED` inline by the producer and has no external target).
 * Configured channel descriptors supply downstream readers through the core factory.
 */
const DEFAULT_TARGET_RESOLVERS: readonly ChannelTargetResolver[] = [
  new EmailTargetResolver(),
  new TelegramTargetResolver(),
]

/**
 * Produce-time channel target resolver registry (core role). Keyed by channel id; the
 * producer looks up a resolver per enabled external channel to materialize its
 * deliveries. Constructed via a factory so tests can pass a custom resolver set.
 */
@Injectable()
export class ChannelTargetResolverRegistry {
  private readonly byChannel: Map<string, ChannelTargetResolver>

  constructor(resolvers: readonly ChannelTargetResolver[] = DEFAULT_TARGET_RESOLVERS) {
    this.byChannel = new Map()
    for (const resolver of resolvers) {
      if (this.byChannel.has(resolver.channel)) {
        throw new Error(`Duplicate notification channel: ${resolver.channel}`)
      }
      this.byChannel.set(resolver.channel, resolver)
    }
  }

  get(channel: NotificationChannel): ChannelTargetResolver | undefined {
    return this.byChannel.get(channel)
  }
}
