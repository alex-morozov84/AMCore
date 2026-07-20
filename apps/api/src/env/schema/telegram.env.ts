import { z } from 'zod'

import { DEFAULT_TELEGRAM_API_BASE_URL } from '../../core/notifications/channels/telegram/telegram.constants'

import { optionalEnvString, optionalEnvUrl, optionalTelegramUsername } from './helpers'

// Telegram OAuth login + notifications channel (Arc D). These share
// TELEGRAM_BOT_TOKEN but are independently optional; the composed refinement gates
// the channel (token + username + webhook secret) vs token-only OAuth mode.
export const telegramEnv = z.object({
  TELEGRAM_BOT_TOKEN: optionalEnvString(),
  TELEGRAM_CALLBACK_URL: optionalEnvUrl(),
  // Username builds the deep link; the API base URL is overridable for the
  // fake-server e2e (default = the public Bot API).
  TELEGRAM_BOT_USERNAME: optionalTelegramUsername(),
  TELEGRAM_API_BASE_URL: z.url().default(DEFAULT_TELEGRAM_API_BASE_URL),
  // Public URL of the `/webhooks/telegram` endpoint, used only by the `telegram:setup`
  // deploy script's `setWebhook` call (not at runtime).
  TELEGRAM_WEBHOOK_URL: optionalEnvUrl(),
})
