import { Inject, Injectable } from '@nestjs/common'

import type { NotificationChannel } from '../notification.constants'

import type { ChannelDeliverer } from './channel-deliverer.types'

/**
 * DI token for the set of active channel deliverers. Provided as an array so each
 * channel adapter (email in B.4, Telegram in Arc D) registers additively without the
 * registry depending on any concrete deliverer.
 */
export const CHANNEL_DELIVERERS = Symbol('CHANNEL_DELIVERERS')

/**
 * Worker-role registry of channel deliverers, keyed by channel id. The dispatcher
 * resolves a deliverer per claimed delivery; a channel with no registered deliverer is
 * treated as a permanent `no_adapter` failure (defensive — the producer only creates
 * external deliveries for channels whose target resolver exists, kept in parity).
 */
@Injectable()
export class ChannelDelivererRegistry {
  private readonly byChannel: Map<string, ChannelDeliverer>

  constructor(@Inject(CHANNEL_DELIVERERS) deliverers: readonly ChannelDeliverer[]) {
    this.byChannel = new Map(deliverers.map((deliverer) => [deliverer.channel, deliverer]))
  }

  get(channel: NotificationChannel): ChannelDeliverer | undefined {
    return this.byChannel.get(channel)
  }
}
