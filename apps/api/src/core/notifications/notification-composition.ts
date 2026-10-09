import { z } from 'zod'

import { EmailChannelDeliverer } from './channels/email-channel.deliverer'
import { EmailTargetResolver } from './channels/email-target.resolver'
import type { NotificationChannelDescriptor } from './channels/notification-channel.types'
import {
  EmailNotificationDeliveryModule,
  TelegramNotificationDeliveryModule,
} from './channels/notification-delivery.modules'
import {
  EmailTargetReaderModule,
  TelegramTargetReaderModule,
} from './channels/notification-target-reader.modules'
import { TelegramChannelDeliverer } from './channels/telegram/telegram-channel.deliverer'
import { TelegramTargetResolver } from './channels/telegram/telegram-target.resolver'
import { TelegramNotificationWebModule } from './channels/telegram/telegram-web.module'
import { NOTIFICATION_DEFINITIONS } from './definitions'
import { NotificationsCoreModule } from './notifications-core.module'

import { preparedEmailBodySchema } from '@/infrastructure/email/prepared-email'

/** Application composition entry; neutral/core barrels do not import this inventory. */
export const NOTIFICATION_CHANNELS: readonly NotificationChannelDescriptor[] = [
  {
    id: 'email',
    targetMode: 'snapshot',
    core: { module: EmailTargetReaderModule, token: EmailTargetResolver },
    worker: (core) => EmailNotificationDeliveryModule.register(core),
    delivererToken: EmailChannelDeliverer,
    available: () => true,
    wireVersion: 1,
    requestSchema: preparedEmailBodySchema,
    requestTargetsDelivery: (body, context) => {
      const request = preparedEmailBodySchema.parse(body)
      return request.to.length === 1 && request.to[0] === context.delivery.targetKey
    },
  },
  {
    id: 'telegram',
    requestTargetsDelivery: (body, context) =>
      (body as { chat_id: string }).chat_id === context.delivery.targetKey,
    web: (core) => TelegramNotificationWebModule.register(core),
    targetMode: 'generation',
    core: { module: TelegramTargetReaderModule, token: TelegramTargetResolver },
    worker: (core) => TelegramNotificationDeliveryModule.register(core),
    delivererToken: TelegramChannelDeliverer,
    available: (env) => Boolean(env.get('TELEGRAM_BOT_TOKEN')),
    wireVersion: 1,
    requestSchema: z
      .object({
        chat_id: z.string(),
        text: z.string(),
      })
      .strict(),
  },
]

/** Construct once. Every importing facade/consumer shares this exact module object. */
export const configuredNotificationsCore = NotificationsCoreModule.register({
  definitions: NOTIFICATION_DEFINITIONS,
  channels: NOTIFICATION_CHANNELS,
})
