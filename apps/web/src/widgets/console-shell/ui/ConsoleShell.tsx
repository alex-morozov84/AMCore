'use client'

import type { ComponentType, ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { UserResponse } from '@amcore/shared'
import { Building2Icon, LayoutDashboardIcon, ShieldCheckIcon } from 'lucide-react'

import { ConsoleLogoutButton } from '@/features/console-logout'
import { usePathname } from '@/i18n/navigation'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'
import {
  getConsoleOrganizationsHref,
  getConsoleOverviewHref,
} from '@/shared/lib/console-public-href'
import { cn } from '@/shared/lib/utils'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/shared/ui/sidebar'

interface ConsoleShellProps {
  children: ReactNode
  /** Server-resolved (`getConsoleAwareUser`) - chrome only, never an auth decision. */
  user: UserResponse | null
}

interface ConsoleNavItem {
  href: string
  label: string
  icon: ComponentType<{ 'aria-hidden'?: boolean | 'true' | 'false' }>
}

function useConsoleNavItems(): ConsoleNavItem[] {
  const t = useTranslations('console')
  return [
    { href: getConsoleOverviewHref(), label: t('overview'), icon: LayoutDashboardIcon },
    { href: getConsoleOrganizationsHref(), label: t('organizations'), icon: Building2Icon },
  ]
}

function ConsoleNavigation() {
  const t = useTranslations('console')
  const { setOpenMobile } = useSidebar()
  const pathname = usePathname()
  const items = useConsoleNavItems()

  return (
    <SidebarMenu aria-label={t('navigation')}>
      {items.map(({ href, label, icon: Icon }) => {
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
              render={<RouteProgressLink href={href} onClick={() => setOpenMobile(false)} />}
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

/** "OPS / <SECTION>" - falls back to the eyebrow-less bare prefix on an unrecognized/root path. */
function ConsoleBreadcrumb() {
  const t = useTranslations('console')
  const pathname = usePathname()
  const items = useConsoleNavItems()
  const current = items.find((item) => item.href === pathname)

  return (
    <div className="font-[family-name:var(--console-font-mono)] text-[11px] tracking-[0.08em] text-foreground-muted uppercase">
      {t('opsPrefix')}
      {current ? ` / ${current.label}` : ''}
    </div>
  )
}

function ConsoleEnvironmentBadge() {
  const t = useTranslations('console')
  const isProduction = process.env.NODE_ENV === 'production'

  return (
    <span className="rounded-md bg-foreground px-2 py-1 font-[family-name:var(--console-font-mono)] text-[10px] font-semibold tracking-[0.06em] text-background uppercase">
      {isProduction ? t('envProduction') : t('envDevelopment')}
    </span>
  )
}

function initialsFor(user: UserResponse): string {
  const source = user.name?.trim() || user.email
  const parts = source.split(/\s+/).filter(Boolean)
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)
  return initials.toUpperCase()
}

function ConsoleUserBadge({ user }: { user: UserResponse | null }) {
  const t = useTranslations('console')
  if (!user) return null

  return (
    <div className="flex items-center gap-2">
      <span className="flex size-7 items-center justify-center rounded-md bg-console-accent/8 font-[family-name:var(--console-font-mono)] text-xs font-bold text-console-accent">
        {initialsFor(user)}
      </span>
      <span className="hidden flex-col leading-tight sm:flex">
        <span className="text-xs font-semibold">{user.name || user.email}</span>
        <span className="font-[family-name:var(--console-font-mono)] text-[10px] tracking-[0.05em] text-foreground-faint uppercase">
          {t('superAdminRole')}
        </span>
      </span>
    </div>
  )
}

export function ConsoleShell({ children, user }: ConsoleShellProps) {
  const t = useTranslations('console')

  return (
    <SidebarProvider>
      <Sidebar
        collapsible="icon"
        mobileTitle={t('mobileNavigation')}
        mobileDescription={t('mobileNavigationDescription')}
      >
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center gap-2 px-2 py-1">
            <ShieldCheckIcon className="size-4 shrink-0 text-console-accent" aria-hidden="true" />
            <span
              data-console-shell="title"
              className="font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
            >
              {t('title')}
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <ConsoleNavigation />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <span
            data-console-shell="footer"
            className="px-2 font-[family-name:var(--console-font-mono)] text-xs text-foreground-muted group-data-[collapsible=icon]:hidden"
          >
            {t('controlPlane')}
          </span>
        </SidebarFooter>
        <SidebarRail toggleLabel={t('toggleNavigation')} />
      </Sidebar>
      <SidebarInset>
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-surface-elevated px-4">
          <div className="flex items-center gap-3">
            <SidebarTrigger toggleLabel={t('toggleNavigation')} />
            <ConsoleBreadcrumb />
          </div>
          <div className="flex items-center gap-3">
            <ConsoleEnvironmentBadge />
            <ConsoleUserBadge user={user} />
            {ADMIN_CONSOLE_CONFIG.mode === 'host' && <ConsoleLogoutButton />}
          </div>
        </header>
        <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
