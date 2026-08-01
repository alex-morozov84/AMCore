import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'

import { routing } from './routing'

/**
 * Shared format definitions. Declaring them once here (rather than passing
 * options at each call site) keeps date/number rendering consistent and makes
 * the names type-checked via the `Formats` entry in `AppConfig` — see
 * `src/global.d.ts`.
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
  // `requestLocale` carries the `[locale]` segment. Validate it against the
  // shared locale set rather than trusting the URL — the segment is user input
  // and would otherwise be used to index the message catalogue directly.
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

  return {
    locale,
    formats,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
