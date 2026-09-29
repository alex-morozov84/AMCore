'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@amcore/shared'

import { useCurrentUser } from '@/entities/user'
import { usePathname } from '@/i18n/navigation'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

import { usePersistLocale } from '../model/use-persist-locale'

interface LocaleSwitcherProps {
  className?: string
}

/**
 * Language switcher.
 *
 * Navigating with next-intl's router updates the URL prefix and the
 * `NEXT_LOCALE` cookie, which covers anonymous visitors and the next visit
 * from this browser. For a signed-in user that is not enough — the preference
 * has to reach `User.locale` on the server, or their emails and notifications
 * keep arriving in the old language and the choice does not follow them to
 * another device. Hence the extra `PATCH /auth/me` below.
 */
export function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const t = useTranslations('locale')
  const locale = useLocale()
  const router = useRouteProgressRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  // `data` is `undefined` both while loading and on a 401 (no session) —
  // either way there's no authenticated user to persist a locale for.
  const { data } = useCurrentUser()
  const persistLocale = usePersistLocale()

  function onSelect(next: SupportedLocale) {
    if (next === locale) return

    if (data?.user) {
      // Deliberately not awaited and not blocking the navigation: the UI
      // language must switch immediately even if the profile write fails.
      persistLocale(next)
    }

    startTransition(() => {
      router.replace(pathname, { locale: next })
    })
  }

  const items = SUPPORTED_LOCALES.map((value) => ({ value, label: t(value) }))
  return (
    <div className={className}>
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
