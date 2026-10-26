'use client'

import { useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@amcore/shared'

import { usePathname } from '@/i18n/navigation'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

/** URL/cookie-only language choice: pending authentication must not read a product profile. */
export function AuthLocaleSwitcher() {
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
