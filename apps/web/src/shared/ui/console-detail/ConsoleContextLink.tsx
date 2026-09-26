'use client'

import { type ReactNode, useRef } from 'react'

import { usePathname } from '@/i18n/navigation'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

const RETURN_POSITION_KEY = 'amcore-console-detail-return-position'

export interface ConsoleReturnPosition {
  actual: string
  canonical: string | null
  detailKey: string
  occurrence: number
  scrollY: number
  savedAt: number
}

export function ConsoleContextLink({
  href,
  detailKey,
  className,
  children,
}: {
  href: string
  detailKey: string
  className?: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const anchor = useRef<HTMLAnchorElement>(null)

  function rememberPosition() {
    const current = anchor.current
    if (!current) return
    const peers = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('[data-console-detail]')
    ).filter((item) => item.dataset.consoleDetail === detailKey && item.getClientRects().length)
    const target = new URL(current.href)
    const position: ConsoleReturnPosition = {
      actual: `${pathname}${window.location.search}`,
      canonical: target.searchParams.get('returnTo'),
      detailKey,
      occurrence: Math.max(0, peers.indexOf(current)),
      scrollY: window.scrollY,
      savedAt: Date.now(),
    }
    try {
      sessionStorage.setItem(RETURN_POSITION_KEY, JSON.stringify(position))
    } catch {
      // Navigation still works when session storage is unavailable.
    }
  }

  return (
    <RouteProgressLink
      ref={anchor}
      prefetch={false}
      href={href}
      className={className}
      data-console-detail={detailKey}
      onNavigate={rememberPosition}
    >
      {children}
    </RouteProgressLink>
  )
}

export { RETURN_POSITION_KEY }
