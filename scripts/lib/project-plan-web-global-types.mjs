// init:project --mode=single: src/global.d.ts's next-intl type augmentation.
// Found via the real `pnpm --filter web build` in init-project.test.mjs, not
// named in the original scope: `Locale` was derived from `routing.locales`,
// so deleting routing.ts (project-plan-web-structure.mjs) breaks every
// next-intl typed call in the app (`getTranslations`, `useTranslations`,
// ...) with an unrelated-looking overload error, not an import error.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `import type { formats } from '@/i18n/request'
import type { routing } from '@/i18n/routing'

import type messages from '../messages/en.json'

/**
 * Type-level i18n contract.
 *
 * Without this, \`t('some.key')\` accepts any string and a typo only surfaces as
 * a missing-message error in the browser. Typing \`Messages\` from the English
 * catalogue — the source of truth — makes an unknown key a \`pnpm typecheck\`
 * failure instead.
 *
 * This checks keys used against \`en.json\`. It does *not* check that \`ru.json\`
 * has them all; that is what the catalogue-parity test enforces at runtime.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number]
    Messages: typeof messages
    Formats: typeof formats
  }
}
`

function after(locale) {
  return `import type { DEFAULT_LOCALE } from '@amcore/shared'

import type { formats } from '@/i18n/request'

import type messages from '../messages/${locale}.json'

/**
 * Type-level i18n contract.
 *
 * Without this, \`t('some.key')\` accepts any string and a typo only surfaces as
 * a missing-message error in the browser. Typing \`Messages\` from the one
 * supported catalogue makes an unknown key a \`pnpm typecheck\` failure instead.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: typeof DEFAULT_LOCALE
    Messages: typeof messages
    Formats: typeof formats
  }
}
`
}

export function buildWebGlobalTypesSteps(root, locale) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/global.d.ts'),
      { expectedBefore: BEFORE, after: after(locale) },
      "global.d.ts: type next-intl's Locale/Messages from the single supported catalogue"
    ),
  ]
}
