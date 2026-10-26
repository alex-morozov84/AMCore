'use client'

import { useTranslations } from 'next-intl'
import { SUPPORTED_LOCALES } from '@amcore/shared'

import { LocaleSelector } from '@/shared/ui/locale-selector'

import { useLocaleChange } from '../model/use-locale-change'

/** Pending authentication changes URL/cookie only; it never reads a product profile. */
export function AuthLocaleSwitcher() {
  const t = useTranslations('locale')
  const { value, pending, change } = useLocaleChange()
  return (
    <LocaleSelector
      label={t('label')}
      items={SUPPORTED_LOCALES.map((locale) => ({ value: locale, label: t(locale) }))}
      value={value}
      pending={pending}
      onChange={change}
    />
  )
}
