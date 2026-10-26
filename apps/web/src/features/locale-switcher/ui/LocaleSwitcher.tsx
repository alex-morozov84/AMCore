'use client'

import { useTranslations } from 'next-intl'
import { SUPPORTED_LOCALES } from '@amcore/shared'

import { useCurrentUser } from '@/entities/user'
import { LocaleSelector } from '@/shared/ui/locale-selector'

import { useLocaleChange } from '../model/use-locale-change'
import { usePersistLocale } from '../model/use-persist-locale'

/** Admitted product pages also persist the preference; URL navigation never waits for it. */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations('locale')
  const { data } = useCurrentUser()
  const persistLocale = usePersistLocale()
  const { value, pending, change } = useLocaleChange((locale) => {
    if (data?.user) persistLocale(locale)
  })
  return (
    <div className={className}>
      <LocaleSelector
        label={t('label')}
        items={SUPPORTED_LOCALES.map((locale) => ({ value: locale, label: t(locale) }))}
        value={value}
        pending={pending}
        onChange={change}
      />
    </div>
  )
}
