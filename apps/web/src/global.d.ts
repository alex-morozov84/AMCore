import type { formats } from '@/i18n/request'
import type { routing } from '@/i18n/routing'

import type messages from '../messages/en.json'

/**
 * Type-level i18n contract.
 *
 * Without this, `t('some.key')` accepts any string and a typo only surfaces as
 * a missing-message error in the browser. Typing `Messages` from the English
 * catalogue — the source of truth — makes an unknown key a `pnpm typecheck`
 * failure instead.
 *
 * This checks keys used against `en.json`. It does *not* check that `ru.json`
 * has them all; that is what the catalogue-parity test enforces at runtime.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number]
    Messages: typeof messages
    Formats: typeof formats
  }
}
