'use client'

import { useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@amcore/shared'

import { usePathname } from '@/i18n/navigation'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

/**
 * Console-only language switcher.
 *
 * Unlike the product `LocaleSwitcher` (`@/features/locale-switcher`), this
 * never reads the product user or writes `PATCH /auth/me`: the isolated
 * host console session has no product-session Query hook to read, and a
 * console viewer's language choice is URL/cookie-only (next-intl's own
 * `NEXT_LOCALE` cookie via the navigation router), never a profile
 * mutation. Preserves the current page and its search parameters (e.g.
 * Organizations' `?page=2`) across the switch. Renders nothing when a
 * generated single-locale fork leaves only one entry in
 * `SUPPORTED_LOCALES` — there is nothing to switch between.
 */
export function ConsoleLocaleSwitcher() {
  const t = useTranslations('locale')
  const locale = useLocale()
  const router = useRouteProgressRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  if (SUPPORTED_LOCALES.length < 2) return null

  function onSelect(next: SupportedLocale) {
    if (next === locale) return

    const query = Object.fromEntries(searchParams.entries())
    startTransition(() => {
      router.replace({ pathname, query }, { locale: next })
    })
  }

  return (
    <label>
      <span className="sr-only">{t('label')}</span>
      <select
        value={locale}
        disabled={isPending}
        onChange={(event) => onSelect(event.target.value as SupportedLocale)}
        aria-label={t('label')}
        className="rounded-md border border-border bg-card px-2 py-1 text-sm"
      >
        {SUPPORTED_LOCALES.map((value) => (
          <option key={value} value={value}>
            {t(value)}
          </option>
        ))}
      </select>
    </label>
  )
}
