'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ExternalLink, Info, TriangleAlert } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { buttonVariants } from '@/shared/ui/button'

import type { BoardEntryState } from './board-entry-state'

interface BoardEntryProps {
  state: BoardEntryState
  /** Where the board opens (the Console BFF route of this topology). */
  href: string
  /** Operator guide that explains how to enable the board. */
  guideHref: string
  /** The visitor is trying again: the stale "could not open" notice goes away. */
  onOpen: () => void
}

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
 * Entry to the read-only queue board on Background work. A standing, calm note (never a modal, never
 * a warning) says what the board is; then, depending on what the live summary confirms, a button, the
 * way to enable it, or a note that the last attempt failed. The caller computes the state
 * (`resolveBoardEntryState`) from the same observer that feeds the queue rows.
 */
export function BoardEntry({ state, href, guideHref, onOpen }: BoardEntryProps) {
  const t = useTranslations('console.backgroundWork.board')
  const canOpen = state === 'available' || state === 'open-failed'
  return (
    <div className="flex flex-col gap-3">
      <Alert role="note">
        <Info aria-hidden />
        <AlertTitle className="line-clamp-none">{t('noteTitle')}</AlertTitle>
        <AlertDescription>{t('noteBody')}</AlertDescription>
      </Alert>
      {state === 'disabled' && (
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
      )}
      {state === 'open-failed' && (
        <Alert variant="destructive" role="status">
          <TriangleAlert aria-hidden />
          <AlertTitle className="line-clamp-none">{t('unavailableTitle')}</AlertTitle>
          <AlertDescription>{t('unavailableBody')}</AlertDescription>
        </Alert>
      )}
      {canOpen && (
        <NewTabLink href={href} onClick={onOpen} className={cn(buttonVariants(), 'w-fit gap-2')}>
          {t('openLink')}
          <ExternalLink aria-hidden className="size-4" />
        </NewTabLink>
      )}
    </div>
  )
}
