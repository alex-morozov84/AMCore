import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

/** Route-backed sections use links, preserving browser history and new-tab access. */
export function SectionNavigation({
  label,
  items,
}: {
  label: string
  items: { label: string; href: string; active: boolean }[]
}) {
  return (
    <nav aria-label={label} className="flex gap-1 border-b border-border pb-2">
      {items.map((item) => (
        <RouteProgressLink
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            item.active && 'bg-muted text-foreground'
          )}
        >
          {item.label}
        </RouteProgressLink>
      ))}
    </nav>
  )
}
