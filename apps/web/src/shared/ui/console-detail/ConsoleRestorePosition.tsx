'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

import { usePathname } from '@/i18n/navigation'

import { type ConsoleReturnPosition, RETURN_POSITION_KEY } from './ConsoleContextLink'

function visibleMatches(detailKey: string): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-console-detail]')).filter(
    (item) => item.dataset.consoleDetail === detailKey && item.getClientRects().length > 0
  )
}

/** Restore the clicked row after a fresh inventory/Audit result has appeared. */
export function ConsoleRestorePosition() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()

  useEffect(() => {
    let position: ConsoleReturnPosition | null = null
    try {
      const stored = sessionStorage.getItem(RETURN_POSITION_KEY)
      if (stored) position = JSON.parse(stored) as ConsoleReturnPosition
    } catch {
      return
    }
    if (!position) return
    if (Date.now() - position.savedAt > 10 * 60_000) {
      sessionStorage.removeItem(RETURN_POSITION_KEY)
      return
    }
    const current = search ? `${pathname}?${search}` : pathname
    if (current !== position.actual && current !== position.canonical) return
    let finished = false
    const restore = () => {
      if (finished || !position) return
      const matches = visibleMatches(position.detailKey)
      const link = matches[position.occurrence] ?? matches[0]
      if (!link) return
      finished = true
      observer.disconnect()
      window.clearTimeout(timeout)
      window.requestAnimationFrame(() => {
        link.focus({ preventScroll: true })
        window.scrollTo(0, position.scrollY)
        sessionStorage.removeItem(RETURN_POSITION_KEY)
      })
    }
    const observer = new MutationObserver(restore)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    const timeout = window.setTimeout(() => {
      observer.disconnect()
      sessionStorage.removeItem(RETURN_POSITION_KEY)
    }, 10_000)
    restore()
    return () => {
      finished = true
      observer.disconnect()
      window.clearTimeout(timeout)
    }
  }, [pathname, search])

  return null
}
