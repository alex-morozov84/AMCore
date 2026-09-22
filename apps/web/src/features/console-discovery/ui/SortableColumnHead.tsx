import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { TableHead } from '@/shared/ui/table'

import {
  ariaSortValue,
  buildDiscoveryHref,
  type DiscoveryQueryState,
  type DiscoverySortOrder,
  toggleSortOrder,
} from '../model/discovery-query'

export interface SortableColumnHeadProps {
  baseHref: string
  column: string
  defaultOrder: DiscoverySortOrder
  current: Pick<DiscoveryQueryState, 'search' | 'sortBy' | 'sortOrder'>
  /** Shown visually; not the link's accessible name (see `accessibleLabel`). */
  visibleLabel: string
  /** The link's full accessible name — states the next action/direction
   *  explicitly, e.g. "Sort by name, descending", not a bare icon/label. */
  accessibleLabel: string
  className?: string
}

/**
 * One sortable column header — a plain link (`RouteProgressLink`, exactly
 * like pagination), not a client-side control: a sort toggle is one
 * discrete click, not a stream of intermediate states, so there is no
 * debounce problem to solve and a link already gets free hover/viewport
 * prefetching. Server-renderable; domain-agnostic (`column` is just the
 * backend's `sortBy` value, `current`/labels come from the caller).
 */
export function SortableColumnHead({
  baseHref,
  column,
  defaultOrder,
  current,
  visibleLabel,
  accessibleLabel,
  className,
}: SortableColumnHeadProps) {
  const ariaSort = ariaSortValue(column, current, defaultOrder)
  const nextOrder = toggleSortOrder(column, current, defaultOrder)
  const href = buildDiscoveryHref(baseHref, {
    search: current.search,
    sortBy: column,
    sortOrder: nextOrder,
    page: 1,
  })

  return (
    <TableHead aria-sort={ariaSort} className={className}>
      <RouteProgressLink
        href={href}
        aria-label={accessibleLabel}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        <span aria-hidden="true" className="inline-flex items-center gap-1">
          {visibleLabel}
          {ariaSort === 'none' ? (
            // Sortable-but-inactive columns still need a persistent
            // affordance — otherwise nothing on screen distinguishes a
            // sortable header from a plain one until it's clicked. Muted so
            // the active column's directional chevron still reads as the
            // primary signal.
            <ChevronsUpDown className="size-3.5 text-foreground-muted" />
          ) : ariaSort === 'ascending' ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </span>
      </RouteProgressLink>
    </TableHead>
  )
}
