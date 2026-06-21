import { z } from 'zod'

import { TELEGRAM_LINK_TOKEN_PATTERN } from './telegram.constants'

/**
 * Two-stage bounded parse of a Telegram webhook update (R4). Bot API updates are intentionally
 * extensible, so we **strip** unknown fields (Zod default) rather than reject — but we only ever
 * read the few fields below, and never persist/log the rest.
 */

/**
 * Stage 1 — extract ONLY `update_id`. It is present + integer on every valid update
 * (`message`/`edited_message`/`callback_query`/…), so it alone drives the durable dedupe receipt:
 * any valid-secret update, even a shape we ignore, gets a receipt + 200 (never a retry loop).
 * Returns the value as `bigint` (converted at this boundary) or `undefined` if absent/unsafe.
 */
const updateIdSchema = z.object({ update_id: z.number() })

export function parseUpdateId(body: unknown): bigint | undefined {
  const parsed = updateIdSchema.safeParse(body)
  if (!parsed.success || !Number.isSafeInteger(parsed.data.update_id)) return undefined
  return BigInt(parsed.data.update_id)
}

/** A validated `/start <token>` bind command from a private chat. */
export interface TelegramStartCommand {
  chatId: string
  telegramUserId: string
  token: string
}

/** Stage 2 — strict bounded projection of the `/start` command (only the fields a bind needs). */
const startMessageSchema = z.object({
  message: z.object({
    text: z.string().max(256),
    chat: z.object({ id: z.number(), type: z.string().max(32) }),
    from: z.object({ id: z.number() }),
  }),
})

/**
 * Decide a bind from an update. Returns the command only when ALL hold (corr. B): it is a
 * `message` with text, a **private** chat, `from.id === chat.id` (a private chat's user/chat
 * identities coincide), and the text matches `^/start(@<bot>)?\s+<43-char base64url token>$`
 * with no trailing content. Any non-match → `null` (the caller commits a durable no-op + 200).
 */
export function parseStartCommand(body: unknown, botUsername: string): TelegramStartCommand | null {
  const parsed = startMessageSchema.safeParse(body)
  if (!parsed.success) return null
  const { message } = parsed.data

  if (message.chat.type !== 'private') return null
  if (!Number.isSafeInteger(message.chat.id) || !Number.isSafeInteger(message.from.id)) return null
  if (message.from.id !== message.chat.id) return null

  const match = startCommandRegex(botUsername).exec(message.text)
  if (!match) return null

  return {
    chatId: message.chat.id.toString(),
    telegramUserId: message.from.id.toString(),
    token: match[1]!,
  }
}

function startCommandRegex(botUsername: string): RegExp {
  const bot = botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^/start(?:@${bot})?\\s+(${TELEGRAM_LINK_TOKEN_PATTERN.source.slice(1, -1)})$`)
}
