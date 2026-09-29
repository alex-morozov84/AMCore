import type { MouseEventHandler } from 'react'

import { buttonVariants } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

/** Reset navigates to the unfiltered page; same-URL clicks never start progress. */
export function ConsoleFilterReset({
  href,
  label,
  onClick,
}: {
  href: string
  label: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}) {
  return (
    <RouteProgressLink
      href={href}
      prefetch={false}
      onClick={onClick}
      className={buttonVariants({ variant: 'outline', size: 'lg' })}
    >
      {label}
    </RouteProgressLink>
  )
}
