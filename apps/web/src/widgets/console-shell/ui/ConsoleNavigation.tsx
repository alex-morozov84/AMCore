'use client'

import { useTranslations } from 'next-intl'

import { usePathname } from '@/i18n/navigation'
import { cn } from '@/shared/lib/utils'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/shared/ui/sidebar'

import { useConsoleNavItems } from './console-nav-items'

export function ConsoleNavigation() {
  const t = useTranslations('console')
  const { setOpenMobile } = useSidebar()
  const pathname = usePathname()
  const items = useConsoleNavItems()

  return (
    <SidebarMenu aria-label={t('navigation')}>
      {items.map(({ href, label, icon: Icon, prefetch }) => {
        const isActive = pathname === href
        return (
          <SidebarMenuItem key={href}>
            <SidebarMenuButton
              isActive={isActive}
              tooltip={label}
              className={cn(
                // `data-active:` here, not a JS-computed unconditional class:
                // the base `sidebarMenuButtonVariants` already sets
                // `data-active:bg-sidebar-accent` (a variant-scoped utility).
                // An unconditional `bg-console-accent/8` sits in a different
                // tailwind-merge conflict group, so both classes would
                // survive into the DOM and the base one wins anyway (its
                // `[data-active]` attribute selector outranks a plain
                // class). Matching the same `data-active:` scope lets
                // tailwind-merge actually drop the base color in favor of
                // this one.
                'rounded-md text-foreground-muted data-active:bg-console-accent/8 data-active:font-semibold data-active:text-console-accent data-active:hover:bg-console-accent/12'
              )}
              render={
                <RouteProgressLink
                  href={href}
                  prefetch={prefetch}
                  onClick={() => setOpenMobile(false)}
                />
              }
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}
