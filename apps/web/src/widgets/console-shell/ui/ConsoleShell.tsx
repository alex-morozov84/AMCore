'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { LayoutDashboardIcon, ShieldCheckIcon } from 'lucide-react'

import { ConsoleLogoutButton } from '@/features/console-logout'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'
import { getConsoleOverviewHref } from '@/shared/lib/console-public-href'
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
}

function ConsoleNavigation() {
  const t = useTranslations('console')
  const { setOpenMobile } = useSidebar()
  const overviewHref = getConsoleOverviewHref()

  return (
    <SidebarMenu aria-label={t('navigation')}>
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive
          tooltip={t('overview')}
          className="border-l-2 border-console-accent bg-console-accent/5 text-sidebar-foreground hover:bg-console-accent/10"
          render={<RouteProgressLink href={overviewHref} onClick={() => setOpenMobile(false)} />}
        >
          <LayoutDashboardIcon aria-hidden="true" />
          <span>{t('overview')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function ConsoleStatusStrip() {
  const t = useTranslations('console')

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-foreground-muted">
      <span>{t('controlPlane')}</span>
      <span className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-console-accent" aria-hidden="true" />
        {t('accessPolicy')}
      </span>
      <span>{t('protected')}</span>
    </div>
  )
}

export function ConsoleShell({ children }: ConsoleShellProps) {
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
            className="px-2 font-mono text-xs text-foreground-muted group-data-[collapsible=icon]:hidden"
          >
            {t('controlPlane')}
          </span>
        </SidebarFooter>
        <SidebarRail toggleLabel={t('toggleNavigation')} />
      </Sidebar>
      <SidebarInset>
        <header className="flex min-h-14 items-center gap-3 border-b border-line-strong px-4">
          <SidebarTrigger toggleLabel={t('toggleNavigation')} />
          <ConsoleStatusStrip />
          {ADMIN_CONSOLE_CONFIG.mode === 'host' && <ConsoleLogoutButton />}
        </header>
        <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
