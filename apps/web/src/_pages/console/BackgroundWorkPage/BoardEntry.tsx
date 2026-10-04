'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ExternalLink, TriangleAlert } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { buttonVariants } from '@/shared/ui/button'
import { InfoTooltip } from '@/shared/ui/info-tooltip'

import type { BoardEntryState } from './board-entry-state'

/** Opens in a new tab: said to everyone, not only to those who can see the icon. */
function NewTabLink({
  href,
  className,
  onClick,
  children,
}: {
  href: string
  className?: string
  onClick?: () => void
  children: ReactNode
}) {
  const t = useTranslations('console.backgroundWork.board')
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={onClick}
    >
      {children}
      <span className="sr-only"> {t('openLinkNewTab')}</span>
    </a>
  )
}

/**
 * The way into the read-only queue board, placed with the page actions: a button plus the same kind of
 * help icon as Auto-refresh, which carries the standing "view-only" explanation. Shown only while the
 * live summary confirms the board is available (or just failed to open, so the visitor can retry).
 */
export function BoardOpenAction({ href, onOpen }: { href: string; onOpen: () => void }) {
  const t = useTranslations('console.backgroundWork.board')
  return (
    <>
      <NewTabLink href={href} onClick={onOpen} className={cn(buttonVariants(), 'gap-2')}>
        {t('openLink')}
        <ExternalLink aria-hidden className="size-4" />
      </NewTabLink>
      <InfoTooltip label={t('noteBody')} />
    </>
  )
}

/**
 * Only what needs the visitor's attention, above the table: the board is not enabled (with the way to
 * enable it) or the last attempt to open it failed. The caller computes the state
 * (`resolveBoardEntryState`) from the same observer that feeds the queue rows.
 */
export function BoardNotices({ state, guideHref }: { state: BoardEntryState; guideHref: string }) {
  const t = useTranslations('console.backgroundWork.board')
  if (state === 'disabled') {
    return (
      <Alert role="note">
        <TriangleAlert aria-hidden />
        <AlertTitle className="line-clamp-none">{t('disabledTitle')}</AlertTitle>
        <AlertDescription>
          <p>
            {t.rich('disabledBody', {
              code: (chunks) => (
                <code className="rounded bg-muted px-1 font-console-mono text-xs">{chunks}</code>
              ),
            })}
          </p>
          <NewTabLink href={guideHref} className="underline">
            {t('disabledGuideLink')}
          </NewTabLink>
        </AlertDescription>
      </Alert>
    )
  }
  if (state === 'open-failed') {
    return (
      <Alert variant="destructive" role="status">
        <TriangleAlert aria-hidden />
        <AlertTitle className="line-clamp-none">{t('unavailableTitle')}</AlertTitle>
        <AlertDescription>{t('unavailableBody')}</AlertDescription>
      </Alert>
    )
  }
  return null
}
