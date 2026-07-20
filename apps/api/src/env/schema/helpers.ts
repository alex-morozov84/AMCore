import { z } from 'zod'

import { TELEGRAM_BOT_USERNAME_PATTERN } from '../../core/notifications/channels/telegram/telegram.constants'

// Return the stable public base type (`z.ZodType`) rather than the concrete
// `z.preprocess` wrapper: its internal shape churns across zod minor releases
// (`ZodPipe` → `ZodPreprocess` in 4.4, PR #5929), and the object inference below
// only needs the output type (`string | undefined`).
export const optionalEnvString = (): z.ZodType<string | undefined> =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().optional()
  )

export const optionalEnvUrl = (): z.ZodType<string | undefined> =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.url().optional()
  )

// A Telegram bot username (Arc D). Normalizes a leading `@` away and treats empty as unset;
// validates the public-username grammar (5–32 of A-Za-z0-9_). Used to build the `t.me/<name>`
// deep link and the `/start@<name>` command grammar.
export const optionalTelegramUsername = (): z.ZodType<string | undefined> =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const normalized = value.trim().replace(/^@/, '')
    return normalized === '' ? undefined : normalized
  }, z.string().regex(TELEGRAM_BOT_USERNAME_PATTERN, 'must be 5–32 chars of A-Za-z0-9_').optional())
