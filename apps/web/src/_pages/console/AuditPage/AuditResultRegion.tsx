'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

export const AUDIT_FOCUS_KEY = 'amcore-audit-focus-after-apply'

// A history payload can carry an old server result. Its token is never fresh again.
const seenResults = new Set<string>()

interface AuditResultRegionProps {
  readToken: string
  loading: string
  children: ReactNode
}

export function AuditResultRegion({ readToken, loading, children }: AuditResultRegionProps) {
  const router = useRouteProgressRouter()
  const region = useRef<HTMLElement>(null)
  const [awaitingFreshRead, setAwaitingFreshRead] = useState(false)

  useEffect(() => {
    const fresh = !seenResults.has(readToken)
    seenResults.add(readToken)
    const release = fresh ? window.setTimeout(() => setAwaitingFreshRead(false), 0) : undefined
    try {
      if (fresh && sessionStorage.getItem(AUDIT_FOCUS_KEY)) {
        sessionStorage.removeItem(AUDIT_FOCUS_KEY)
        region.current?.focus()
      }
    } catch {
      // Result rendering and navigation do not depend on session storage.
    }
    return () => window.clearTimeout(release)
  }, [readToken])

  useEffect(() => {
    const refreshHistoryResult = () => {
      setAwaitingFreshRead(true)
      window.setTimeout(() => router.refresh(), 0)
    }
    window.addEventListener('popstate', refreshHistoryResult)
    return () => window.removeEventListener('popstate', refreshHistoryResult)
  }, [router])

  return (
    <>
      {awaitingFreshRead && <p role="status">{loading}</p>}
      <section
        ref={region}
        hidden={awaitingFreshRead}
        aria-live="polite"
        tabIndex={-1}
        className="space-y-4"
      >
        {children}
      </section>
    </>
  )
}
