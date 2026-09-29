import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

/** Consistent filter surface; each page retains its own form and URL semantics. */
export function ConsoleFilterPanel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="console-filter-panel"
      className={cn(
        'space-y-4 rounded-lg border border-border bg-surface-elevated p-4 shadow-md',
        className
      )}
      {...props}
    />
  )
}
