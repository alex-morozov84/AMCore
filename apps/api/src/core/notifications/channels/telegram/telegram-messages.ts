import type { SupportedLocale } from '@amcore/shared'

/**
 * Neutral generic Telegram content (Arc D). Used when a definition resolves Telegram to
 * `generic` (the default for SENSITIVE/PERSONAL, and for any definition without a detailed
 * Telegram renderer) — it never touches the raw payload. Plain text, no `parse_mode`. Mirrors
 * the email generic strings but kept local so the worker deliverer does not depend on the email
 * message catalog. A new locale is added in `SUPPORTED_LOCALES` plus a block here.
 */
export const telegramGenericMessages: Record<SupportedLocale, { title: string; body: string }> = {
  ru: {
    title: 'Новое уведомление',
    body: 'У вас новое уведомление. Откройте AMCore, чтобы посмотреть.',
  },
  en: {
    title: 'New notification',
    body: 'You have a new notification. Open AMCore to view it.',
  },
}
