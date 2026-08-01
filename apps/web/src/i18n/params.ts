import { notFound } from 'next/navigation'
import { hasLocale, type Locale } from 'next-intl'

import { routing } from './routing'

/**
 * Resolve and validate the `[locale]` route segment.
 *
 * Next.js types route params as `{ locale: string }` — the segment is whatever
 * the URL contained — so every page and layout has to narrow it before handing
 * it to next-intl. Doing that here keeps the check in one place and makes an
 * unsupported locale a 404 rather than a silent fallback: `/de/login` must not
 * quietly render English while claiming to be German.
 */
export async function resolveLocaleParam(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  return locale
}
