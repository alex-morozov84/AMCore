import { Injectable } from '@nestjs/common'

import type { NotificationChannelDescriptor } from './notification-channel.types'

import type { EnvService } from '@/env/env.service'

export const NOTIFICATION_CHANNEL_DESCRIPTORS = Symbol('NOTIFICATION_CHANNEL_DESCRIPTORS')

/** Descriptor inventory shared by core and worker projections. */
@Injectable()
export class NotificationChannelRegistry {
  private readonly byId = new Map<string, NotificationChannelDescriptor>()

  constructor(
    descriptors: readonly NotificationChannelDescriptor[],
    private readonly env: EnvService
  ) {
    for (const descriptor of descriptors) {
      if (!/^[a-z][a-z0-9_]{0,47}$/.test(descriptor.id) || descriptor.id === 'in_app') {
        throw new Error('Invalid external notification channel identifier')
      }
      if (this.byId.has(descriptor.id))
        throw new Error(`Duplicate notification channel: ${descriptor.id}`)
      if (
        !descriptor.core.module ||
        !descriptor.core.token ||
        !descriptor.worker ||
        !descriptor.delivererToken ||
        !descriptor.requestSchema ||
        typeof descriptor.requestSchema.safeParse !== 'function' ||
        typeof descriptor.available !== 'function' ||
        !['snapshot', 'generation'].includes(descriptor.targetMode) ||
        typeof descriptor.worker !== 'function' ||
        (descriptor.web !== undefined && typeof descriptor.web !== 'function') ||
        typeof descriptor.requestTargetsDelivery !== 'function' ||
        descriptor.wireVersion !== 1
      ) {
        throw new Error(`Incomplete notification channel: ${descriptor.id}`)
      }
      this.byId.set(descriptor.id, descriptor)
    }
  }

  get(id: string): NotificationChannelDescriptor {
    const descriptor = this.byId.get(id)
    if (!descriptor) throw new Error(`Unregistered notification channel: ${id}`)
    return descriptor
  }

  available(id: string): boolean {
    return id === 'in_app' || this.get(id).available(this.env)
  }

  ids(): string[] {
    return ['in_app', ...this.byId.keys()]
  }
}
