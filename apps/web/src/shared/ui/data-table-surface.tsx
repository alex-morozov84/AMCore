import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

export function DataTableSurface({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-lg border border-border bg-surface-elevated shadow-md',
        className
      )}
      {...props}
    />
  )
}
