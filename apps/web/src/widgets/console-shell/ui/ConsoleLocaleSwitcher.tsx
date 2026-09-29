'use client'

import { useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@amcore/shared'

import { usePathname } from '@/i18n/navigation'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

/**
 * Console-only language switcher.
 *
 * Unlike the product `LocaleSwitcher` (`@/features/locale-switcher`), this
 * never reads the product user or writes `PATCH /auth/me`: the isolated
 * host console session has no product-session Query hook to read, and a
 * console viewer's language choice is URL/cookie-only (next-intl's own
 * `NEXT_LOCALE` cookie via the navigation router), never a profile
 * mutation. Preserves the current page and its search parameters (e.g.
 * Organizations' `?page=2`) across the switch.
 *
 * A generated single-locale fork removes this file and its usage in
 * `ConsoleShell.tsx` entirely (`LOCALE_DELETES` +
 * `locale.navigation-console-switcher`), the same way the product switcher
 * is removed — not a runtime `SUPPORTED_LOCALES.length` guard here, because
 * `useRouteProgressRouter()`'s `replace()` signature itself changes shape
 * under single-locale mode (plain `next/navigation`, no object href or
 * `locale` option), so this component cannot type-check in that variant
 * regardless of any internal branch.
 */
export function ConsoleLocaleSwitcher() {
  const t = useTranslations('locale')
  const locale = useLocale()
  const router = useRouteProgressRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function onSelect(next: SupportedLocale) {
    if (next === locale) return

    const query: Record<string, string | string[]> = {}
    for (const key of new Set(searchParams.keys())) {
      const values = searchParams.getAll(key)
      query[key] = values.length === 1 ? values[0]! : values
    }
    startTransition(() => {
      router.replace({ pathname, query }, { locale: next })
    })
  }

  const items = SUPPORTED_LOCALES.map((value) => ({ value, label: t(value) }))
  return (
    <div>
      <Select
        value={locale}
        disabled={isPending}
        items={items}
        onValueChange={(next) => {
          if (SUPPORTED_LOCALES.some((value) => value === next)) onSelect(next as SupportedLocale)
        }}
      >
        <SelectTrigger size="sm" aria-label={t('label')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
