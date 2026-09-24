'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

import { AuditResultsSkeleton } from './AuditResultsSkeleton'

export const AUDIT_FOCUS_KEY = 'amcore-audit-focus-after-apply'
export const AUDIT_PAGE_NAVIGATION = 'amcore-audit-page-navigation'

// A history payload can carry an old server result. Its token is never fresh again.
const seenResults = new Set<string>()

interface AuditResultRegionProps {
  readToken: string
  loading: string
  children: ReactNode
}

export function AuditResultRegion({ readToken, loading, children }: AuditResultRegionProps) {
  return (
    <AuditResultRegionContent key={readToken} readToken={readToken} loading={loading}>
      {children}
    </AuditResultRegionContent>
  )
}

function AuditResultRegionContent({ readToken, loading, children }: AuditResultRegionProps) {
  const router = useRouteProgressRouter()
  const region = useRef<HTMLElement>(null)
  const refreshScheduled = useRef(false)
  // A cached history payload is hidden on its first client render, before effects paint.
  const [awaitingFreshRead, setAwaitingFreshRead] = useState(
    () => typeof window !== 'undefined' && seenResults.has(readToken)
  )
  const [navigating, setNavigating] = useState(false)

  useEffect(() => {
    if (awaitingFreshRead) {
      if (!refreshScheduled.current) {
        refreshScheduled.current = true
        window.setTimeout(() => router.refresh(), 0)
      }
      return
    }
    seenResults.add(readToken)
    try {
      if (sessionStorage.getItem(AUDIT_FOCUS_KEY)) {
        sessionStorage.removeItem(AUDIT_FOCUS_KEY)
        region.current?.focus()
      }
    } catch {
      // Result rendering and navigation do not depend on session storage.
    }
  }, [awaitingFreshRead, readToken, router])

  useEffect(() => {
    const refreshHistoryResult = () => {
      flushSync(() => setAwaitingFreshRead(true))
    }
    const showPendingResult = () => {
      flushSync(() => setNavigating(true))
    }
    window.addEventListener('popstate', refreshHistoryResult)
    window.addEventListener(AUDIT_PAGE_NAVIGATION, showPendingResult)
    return () => {
      window.removeEventListener('popstate', refreshHistoryResult)
      window.removeEventListener(AUDIT_PAGE_NAVIGATION, showPendingResult)
    }
  }, [router])

  return (
    <>
      {navigating ? (
        <AuditResultsSkeleton label={loading} />
      ) : (
        awaitingFreshRead && <p role="status">{loading}</p>
      )}
      <section
        ref={region}
        hidden={awaitingFreshRead || navigating}
        aria-live="polite"
        tabIndex={-1}
        className="space-y-4"
      >
        {children}
      </section>
    </>
  )
}
