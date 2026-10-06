import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'
import { Skeleton } from '@/shared/ui/skeleton'

/** Preserve the heading slot while its caller revalidates protected data. */
export function PageTitle({ children, className, ...props }: ComponentProps<'h1'>) {
  return (
    <h1
      className={cn('min-h-8 break-words text-2xl font-semibold tracking-tight', className)}
      {...props}
    >
      {children ?? (
        <Skeleton aria-hidden="true" className="h-8 w-64 max-w-full motion-reduce:animate-none" />
      )}
    </h1>
  )
}
