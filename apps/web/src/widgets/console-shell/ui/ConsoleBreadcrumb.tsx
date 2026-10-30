'use client'

import { useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'

import { usePathname } from '@/i18n/navigation'
import {
  getConsoleAccountSecurityHref,
  getConsolePublicPathname,
} from '@/shared/lib/console-public-href'

import { useConsoleNavItems } from './console-nav-items'

/** "OPS / <SECTION>" - falls back to the eyebrow-less bare prefix on an unrecognized/root path. */
const noSubscription = () => () => {}
const serverPathname = () => null

export function ConsoleBreadcrumb() {
  const t = useTranslations('console')
  const sourcePathname = usePathname()
  // Rewritten paths may differ during hydration. Keep SSR and first client markup stable.
  const pathname = useSyncExternalStore(
    noSubscription,
    () => getConsolePublicPathname(sourcePathname),
    serverPathname
  )
  const items = useConsoleNavItems()
  const current =
    pathname === getConsoleAccountSecurityHref()
      ? { label: t('profileSettings') }
      : items.find((item) => item.href === pathname)

  return (
    <div className="font-console-mono text-[11px] tracking-[0.08em] text-foreground-muted uppercase">
      {t('opsPrefix')}
      {current ? ` / ${current.label}` : ''}
    </div>
  )
}
