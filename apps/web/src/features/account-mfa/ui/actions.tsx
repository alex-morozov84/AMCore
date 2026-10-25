import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'
import { Button, buttonVariants } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

const actionClass =
  'h-auto min-h-9 max-w-full px-4 py-2 text-sm leading-5 whitespace-normal sm:min-w-24'

/** Shared within this journey: native form submission and a stable back/next row. */
export function MfaActions({
  children,
  secondary,
}: {
  children: ReactNode
  secondary?: ReactNode
}) {
  return (
    <div
      data-mfa-actions
      className={cn(
        'grid items-stretch gap-3 border-t pt-5',
        secondary ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-1'
      )}
    >
      {secondary}
      <div className="min-w-0 justify-self-end max-sm:w-full [&>[data-slot=button]]:w-full">
        {children}
      </div>
    </div>
  )
}

export function MfaActionButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button {...props} className={cn(actionClass, className)} />
}

/** Navigation stays a native link, including keyboard and accessibility semantics. */
export function MfaActionLink({ className, ...props }: ComponentProps<typeof RouteProgressLink>) {
  return (
    <RouteProgressLink
      {...props}
      data-slot="button"
      className={buttonVariants({ className: cn(actionClass, className) })}
    />
  )
}
