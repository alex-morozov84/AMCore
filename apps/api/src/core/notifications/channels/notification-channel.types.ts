import type { DynamicModule, InjectionToken, Type } from '@nestjs/common'
import type { ZodType } from 'zod'

import type { DeliveryContext } from './channel-deliverer.types'

import type { EnvService } from '@/env/env.service'

/** One code-owned registration, projected into the selected process role. */
export interface NotificationChannelDescriptor {
  readonly id: string
  readonly targetMode: 'snapshot' | 'generation'
  readonly core: { module: Type<unknown>; token: InjectionToken }
  readonly worker: (core: Type<unknown>) => DynamicModule
  readonly delivererToken: InjectionToken
  readonly web?: (core: Type<unknown>) => DynamicModule
  readonly available: (env: EnvService) => boolean
  readonly wireVersion: number
  readonly requestSchema: ZodType
  readonly requestTargetsDelivery: (body: unknown, context: DeliveryContext) => boolean
}
