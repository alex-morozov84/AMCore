import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@amcore/shared'

import { usePathname } from '@/i18n/navigation'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

import 'client-only'

/** URL navigation is shared; only the product wrapper supplies a profile mutation. */
export function useLocaleChange(beforeNavigate?: (locale: SupportedLocale) => void) {
  const locale = useLocale()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouteProgressRouter()
  const [requested, setRequested] = useState(locale)
  const [pending, startTransition] = useTransition()

  function change(value: string) {
    const next = SUPPORTED_LOCALES.find((candidate) => candidate === value)
    if (!next || next === locale || pending) return
    setRequested(next)
    beforeNavigate?.(next)
    const search = searchParams.toString()
    const target = `${pathname}${search ? `?${search}` : ''}${window.location.hash}`
    startTransition(() => router.replace(target, { locale: next }))
  }

  return { value: pending ? requested : locale, pending, change }
}
