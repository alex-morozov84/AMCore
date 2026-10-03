import type { ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'

/** Shared inventory layout; the owning view supplies navigation semantics. */
export function ListPagination({
  previous,
  next,
  status,
  className,
}: {
  previous?: ReactNode
  next?: ReactNode
  status: string
  className?: string
}) {
  return (
    <nav
      aria-label={status}
      className={cn('flex items-center justify-between gap-3 text-sm', className)}
    >
      {previous ?? <span aria-hidden="true" />}
      <span className="text-foreground-muted">{status}</span>
      {next ?? <span aria-hidden="true" />}
    </nav>
  )
}
