import type { ComponentProps, ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'

interface BackLinkProps {
  href: ComponentProps<typeof RouteProgressLink>['href']
  children: ReactNode
}

/** Caller owns the destination and localized label; no browser-history fallback. */
export function BackLink({ href, children }: BackLinkProps) {
  return (
    <RouteProgressLink
      prefetch={false}
      href={href}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:underline"
    >
      <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </RouteProgressLink>
  )
}
