'use client'

import { useTranslations } from 'next-intl'

import { usePathname } from '@/i18n/navigation'

import { useConsoleNavItems } from './console-nav-items'

/** "OPS / <SECTION>" - falls back to the eyebrow-less bare prefix on an unrecognized/root path. */
export function ConsoleBreadcrumb() {
  const t = useTranslations('console')
  const pathname = usePathname()
  const items = useConsoleNavItems()
  const current = items.find((item) => item.href === pathname)

  return (
    <div className="font-[family-name:var(--console-font-mono)] text-[11px] tracking-[0.08em] text-foreground-muted uppercase">
      {t('opsPrefix')}
      {current ? ` / ${current.label}` : ''}
    </div>
  )
}
