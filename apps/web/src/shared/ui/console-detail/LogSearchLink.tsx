'use client'

import { useTranslations } from 'next-intl'
import { ExternalLink } from 'lucide-react'

import { useLogSearchTarget } from '@/shared/lib/log-search-context'
import { logSearchHref } from '@/shared/lib/log-search-link'
import { NewTabLink } from '@/shared/ui/new-tab-link'

/**
 * "Find in logs" for one ID that the Console shows (job, delivery, run or request ID). It renders
 * nothing when no log-search address is configured or the ID is not a well-formed correlation ID, so
 * a page never shows a link that cannot work.
 */
export function LogSearchLink({ id, className }: { id: string; className?: string }) {
  const t = useTranslations('console')
  const target = useLogSearchTarget()
  const href = target ? logSearchHref(target, id) : null
  if (!href) return null
  return (
    <NewTabLink
      href={href}
      newTabLabel={t('overviewPublicOpenNewTab')}
      className={`inline-flex items-center gap-1 text-sm underline ${className ?? ''}`.trim()}
    >
      {t('logSearchLink')}
      <ExternalLink aria-hidden className="size-4" />
    </NewTabLink>
  )
}

/** The one note per section: what the links search and what they need. Nothing when not configured. */
export function LogSearchNote() {
  const t = useTranslations('console')
  if (!useLogSearchTarget()) return null
  return <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('logSearchNote')}</p>
}
