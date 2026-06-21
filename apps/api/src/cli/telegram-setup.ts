/* eslint-disable no-console -- a deploy CLI reports progress to stdout (mirrors prisma/seed.ts) */
/**
 * Deploy-time Telegram `setWebhook` (Arc D / D.3). Compiled into the production artifact
 * (`dist/cli/telegram-setup.js`); run once per deploy with **plain Node**, no pnpm/tsx:
 *
 *   node dist/cli/telegram-setup.js          # production (from the runner image)
 *   pnpm --filter api telegram:setup         # local dev (tsx)
 *
 * NOT run at replica startup. Registers our `/webhooks/telegram` endpoint with the bot, attaching
 * the shared secret and narrowing to `allowed_updates:['message']`. Config is validated up front
 * (URLs through `z.url()`, the secret through its official grammar) so a typo can't send the
 * token-bearing request to an unintended URL. Never prints the bot token or the secret, and reuses
 * the client's sanitized fetch so a failure never surfaces the token-bearing URL. Secret rotation:
 * set a new WEBHOOK_TELEGRAM_SECRET, redeploy, then re-run this command.
 */
import { z } from 'zod'

import {
  DEFAULT_TELEGRAM_API_BASE_URL,
  TELEGRAM_WEBHOOK_SECRET_PATTERN,
} from '../core/notifications/channels/telegram/telegram.constants'
import { TelegramBotApiClient } from '../core/notifications/channels/telegram/telegram-bot-api.client'
import type { EnvService } from '../env/env.service'

// Focused, validated config — the same normalization/grammar the application env enforces.
const setupConfigSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  WEBHOOK_TELEGRAM_SECRET: z.string().regex(TELEGRAM_WEBHOOK_SECRET_PATTERN),
  TELEGRAM_WEBHOOK_URL: z.url(),
  TELEGRAM_API_BASE_URL: z.url().default(DEFAULT_TELEGRAM_API_BASE_URL),
  TELEGRAM_DROP_PENDING: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})

export async function runTelegramSetup(rawEnv: NodeJS.ProcessEnv): Promise<boolean> {
  const parsed = setupConfigSchema.safeParse(rawEnv)
  if (!parsed.success) {
    // Report which keys are wrong WITHOUT printing any value.
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
    console.error(`telegram:setup failed — invalid/missing config: ${fields}`)
    return false
  }
  const config = parsed.data

  // Duck-typed EnvService — the client only reads TELEGRAM_BOT_TOKEN + TELEGRAM_API_BASE_URL.
  const env = {
    get: (key: string) =>
      key === 'TELEGRAM_BOT_TOKEN'
        ? config.TELEGRAM_BOT_TOKEN
        : key === 'TELEGRAM_API_BASE_URL'
          ? config.TELEGRAM_API_BASE_URL
          : undefined,
  } as unknown as EnvService

  const ok = await new TelegramBotApiClient(env).setWebhook(
    config.TELEGRAM_WEBHOOK_URL,
    config.WEBHOOK_TELEGRAM_SECRET,
    config.TELEGRAM_DROP_PENDING
  )
  if (ok) {
    console.log(
      `telegram:setup ok — webhook registered (drop_pending_updates=${config.TELEGRAM_DROP_PENDING})`
    )
  } else {
    console.error('telegram:setup failed — Telegram rejected setWebhook or the request errored')
  }
  return ok
}

// Run only when invoked directly (not when imported by a test).
if (require.main === module) {
  void runTelegramSetup(process.env).then((ok) => process.exit(ok ? 0 : 1))
}
