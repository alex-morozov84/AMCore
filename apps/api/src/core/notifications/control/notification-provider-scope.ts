import { createHash } from 'node:crypto'

import type { NotificationChannelDescriptor } from '../channels/notification-channel.types'

import type { EnvService } from '@/env/env.service'

/** Private compatibility witness; credentials and digests never enter public projections. */
export function notificationProviderScope(
  env: EnvService,
  channel: string,
  descriptor?: NotificationChannelDescriptor
): string | null {
  if (descriptor?.manualRetry?.providerScope)
    return createHash('sha256').update(descriptor.manualRetry.providerScope(env)).digest('hex')
  if (!['email', 'telegram'].includes(channel)) return null
  const credential =
    channel === 'email'
      ? env.get('RESEND_API_KEY')
      : channel === 'telegram'
        ? env.get('TELEGRAM_BOT_TOKEN')
        : null
  return createHash('sha256')
    .update(
      JSON.stringify([
        channel,
        channel === 'email' ? env.get('EMAIL_PROVIDER') : null,
        channel === 'telegram' ? env.get('TELEGRAM_API_BASE_URL') : null,
        credential ? createHash('sha256').update(credential).digest('hex') : null,
      ])
    )
    .digest('hex')
}
