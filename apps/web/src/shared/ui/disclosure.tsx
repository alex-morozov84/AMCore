import type { ComponentProps, ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

/** Native disclosure: callers own localized labels, content and optional open state. */
export function Disclosure({
  label,
  children,
  className,
  contentClassName,
  ...props
}: ComponentProps<'details'> & { label: ReactNode; contentClassName?: string }) {
  return (
    <details {...props} className={cn('text-sm [&[open]>summary>svg]:rotate-180', className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 transition-transform" />
        {label}
      </summary>
      <div className={cn('mt-3', contentClassName)}>{children}</div>
    </details>
  )
}
