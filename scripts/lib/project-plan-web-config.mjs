// init:project --mode=single steps that rewrite apps/web config files in
// place (no move): i18n/request.ts (next-intl's "without i18n routing"
// setup) and eslint.config.mjs (the navigation-import ban and its
// navigation.ts-scoped exemption, both meaningless once that file and the
// [locale] segment are gone).
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const REQUEST_BEFORE = `import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'

import { routing } from './routing'

/**
 * Shared format definitions. Declaring them once here (rather than passing
 * options at each call site) keeps date/number rendering consistent and makes
 * the names type-checked via the \`Formats\` entry in \`AppConfig\` — see
 * \`src/global.d.ts\`.
 */
export const formats = {
  dateTime: {
    short: { day: 'numeric', month: 'short', year: 'numeric' },
    long: { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: 'numeric' },
  },
  number: {
    precise: { maximumFractionDigits: 2 },
  },
} as const

export default getRequestConfig(async ({ requestLocale }) => {
  // \`requestLocale\` carries the \`[locale]\` segment. Validate it against the
  // shared locale set rather than trusting the URL — the segment is user input
  // and would otherwise be used to index the message catalogue directly.
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

  return {
    locale,
    formats,
    messages: (await import(\`../../messages/\${locale}.json\`)).default,
  }
})
`

const REQUEST_AFTER = `import { getRequestConfig } from 'next-intl/server'
import { DEFAULT_LOCALE } from '@amcore/shared'

/**
 * Shared format definitions. Declaring them once here (rather than passing
 * options at each call site) keeps date/number rendering consistent and makes
 * the names type-checked via the \`Formats\` entry in \`AppConfig\` — see
 * \`src/global.d.ts\`.
 */
export const formats = {
  dateTime: {
    short: { day: 'numeric', month: 'short', year: 'numeric' },
    long: { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: 'numeric' },
  },
  number: {
    precise: { maximumFractionDigits: 2 },
  },
} as const

// Single-locale mode (pnpm init:project --mode=single): no [locale] route
// segment exists, so there is nothing to read from the request — every
// render uses the one supported locale. See next-intl's "without i18n
// routing" setup.
export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  formats,
  messages: (await import(\`../../messages/\${DEFAULT_LOCALE}.json\`)).default,
}))
`

export function buildWebConfigSteps(root) {
  const requestPath = path.join(root, 'apps/web/src/i18n/request.ts')

  return [
    exactContentStep(
      requestPath,
      { expectedBefore: REQUEST_BEFORE, after: REQUEST_AFTER },
      'rewrite i18n/request.ts to return a static locale (next-intl "without i18n routing")'
    ),
  ]
}
