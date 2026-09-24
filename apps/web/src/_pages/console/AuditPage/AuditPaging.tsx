'use client'

import { useSyncExternalStore } from 'react'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

const KEY = 'amcore-audit-previous-v1'
const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener('popstate', notify)
  return () => window.removeEventListener('popstate', notify)
}

interface AuditPagingProps {
  nextHref: string | null
  currentHref: string
  older: string
  previous: string
  hasCursor: boolean
}

/** Previous is offered only after this tab deliberately followed the older link. */
export function AuditPaging({
  nextHref,
  currentHref,
  older,
  previous,
  hasCursor,
}: AuditPagingProps) {
  const router = useRouteProgressRouter()
  const canGoBack = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const marker = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as {
          next?: string
          previous?: string
        } | null
        return !!hasCursor && marker?.next === currentHref
      } catch {
        return false
      }
    },
    () => false
  )
  return (
    <nav className="flex items-center justify-between gap-3">
      {canGoBack ? (
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-border px-3 py-2"
        >
          {previous}
        </button>
      ) : (
        <span />
      )}
      {nextHref ? (
        <RouteProgressLink
          prefetch={false}
          href={nextHref}
          onNavigate={() => {
            try {
              sessionStorage.setItem(
                KEY,
                JSON.stringify({
                  next: nextHref,
                  previous: currentHref,
                })
              )
            } catch {
              /* navigation remains available without session storage */
            }
          }}
          className="rounded-md border border-border px-3 py-2"
        >
          {older}
        </RouteProgressLink>
      ) : null}
    </nav>
  )
}
