'use client'

import { useSyncExternalStore } from 'react'

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/shared/ui/pagination'

import { AUDIT_PAGE_NAVIGATION } from './AuditResultRegion'

const KEY = 'amcore-audit-pages-v2'
const EVENT = 'audit-pages-change'
type Trail = { scope: string; pages: string[] }

function scopeOf(href: string): string {
  const url = new URL(href, 'http://localhost')
  url.searchParams.delete('cursor')
  return `${url.pathname}?${url.searchParams.toString()}`
}

function readTrail(): Trail | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Trail | null
    return value && Array.isArray(value.pages) ? value : null
  } catch {
    return null
  }
}

function writeTrail(trail: Trail) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(trail))
    window.dispatchEvent(new Event(EVENT))
  } catch {
    /* Normal navigation works without session storage. */
  }
}

function subscribe(notify: () => void): () => void {
  window.addEventListener(EVENT, notify)
  window.addEventListener('popstate', notify)
  return () => {
    window.removeEventListener(EVENT, notify)
    window.removeEventListener('popstate', notify)
  }
}

export function AuditPaging({
  nextHref,
  currentHref,
  older,
  previous,
  hasCursor,
}: {
  nextHref: string | null
  currentHref: string
  older: string
  previous: string
  hasCursor: boolean
}) {
  const previousHref = useSyncExternalStore(
    subscribe,
    () => {
      const trail = readTrail()
      if (!hasCursor || trail?.scope !== scopeOf(currentHref)) return ''
      const index = trail.pages.indexOf(currentHref)
      return index > 0 ? trail.pages[index - 1] : ''
    },
    () => ''
  )

  return (
    <Pagination aria-label={`${previous} / ${older}`}>
      <PaginationContent>
        {previousHref && (
          <PaginationItem>
            <PaginationPrevious
              label={previous}
              prefetch={false}
              href={previousHref}
              onNavigate={() => {
                window.dispatchEvent(new Event(AUDIT_PAGE_NAVIGATION))
                const trail = readTrail()
                if (trail)
                  writeTrail({
                    ...trail,
                    pages: trail.pages.slice(0, trail.pages.indexOf(currentHref)),
                  })
              }}
            />
          </PaginationItem>
        )}
        {nextHref && (
          <PaginationItem>
            <PaginationNext
              label={older}
              prefetch={false}
              href={nextHref}
              onNavigate={() => {
                window.dispatchEvent(new Event(AUDIT_PAGE_NAVIGATION))
                const scope = scopeOf(currentHref)
                const trail = readTrail()
                const pages = trail?.scope === scope ? trail.pages : []
                const index = pages.indexOf(currentHref)
                writeTrail({
                  scope,
                  pages: [
                    ...(index >= 0 ? pages.slice(0, index + 1) : [currentHref]),
                    nextHref,
                  ].slice(-100),
                })
              }}
            />
          </PaginationItem>
        )}
      </PaginationContent>
    </Pagination>
  )
}
