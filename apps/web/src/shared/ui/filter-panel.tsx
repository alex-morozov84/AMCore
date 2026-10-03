import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

export function FilterPanel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'space-y-4 rounded-lg border border-border bg-surface-elevated p-4 shadow-md',
        className
      )}
      {...props}
    />
  )
}
