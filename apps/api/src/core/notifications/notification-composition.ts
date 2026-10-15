import { z } from 'zod'

import { canonicalJsonHash } from '../../common/utils/canonical-json.js'
import { preparedEmailBodySchema } from '../../infrastructure/email/prepared-email.js'

import { EmailChannelDeliverer } from './channels/email-channel.deliverer.js'
import { EmailTargetResolver } from './channels/email-target.resolver.js'
import type { NotificationChannelDescriptor } from './channels/notification-channel.types.js'
import {
  EmailNotificationDeliveryModule,
  TelegramNotificationDeliveryModule,
} from './channels/notification-delivery.modules.js'
import {
  EmailTargetReaderModule,
  TelegramTargetReaderModule,
} from './channels/notification-target-reader.modules.js'
import { TelegramChannelDeliverer } from './channels/telegram/telegram-channel.deliverer.js'
import { TelegramTargetResolver } from './channels/telegram/telegram-target.resolver.js'
import { TelegramNotificationWebModule } from './channels/telegram/telegram-web.module.js'
import { NOTIFICATION_DEFINITIONS } from './definitions/index.js'
import { NotificationsCoreModule } from './notifications-core.module.js'

/** Application composition entry; neutral/core barrels do not import this inventory. */
export const NOTIFICATION_CHANNELS: readonly NotificationChannelDescriptor[] = [
  {
    id: 'email',
    manualRetry: {
      validatorToken: EmailTargetResolver,
      requestIdentity: (env, id) => ({
        binding: `${env.get('EMAIL_PROVIDER')}:default:https://api.resend.com`,
        path: '/emails',
        idempotencyKey: `notification-delivery:${id}`,
      }),
    },
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
    manualRetry: {
      validatorToken: TelegramTargetResolver,
      requestIdentity: (env) => ({
        binding: `telegram:TELEGRAM_BOT_TOKEN:${canonicalJsonHash(env.get('TELEGRAM_API_BASE_URL').replace(/\/+$/, ''))}`,
        path: 'sendMessage',
        idempotencyKey: null,
      }),
    },
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
