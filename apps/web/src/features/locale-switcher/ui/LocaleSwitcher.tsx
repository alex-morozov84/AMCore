'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@amcore/shared'

import { usePathname, useRouter } from '@/i18n/navigation'
import { useAuthStore } from '@/shared/store'

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
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const status = useAuthStore((state) => state.status)
  const persistLocale = usePersistLocale()

  function onSelect(next: SupportedLocale) {
    if (next === locale) return

    if (status === 'authenticated') {
      // Deliberately not awaited and not blocking the navigation: the UI
      // language must switch immediately even if the profile write fails.
      persistLocale(next)
    }

    startTransition(() => {
      router.replace(pathname, { locale: next })
    })
  }

  return (
    <label className={className}>
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
