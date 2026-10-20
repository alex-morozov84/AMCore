'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { LayoutDashboardIcon, MonitorIcon, PanelLeftIcon } from 'lucide-react'

import { LocaleSwitcher } from '@/features/locale-switcher'
import { AcceptedNavigationProvider } from '@/shared/lib/navigation/accepted-navigation'
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

interface AppShellProps {
  homeHref?: string
  sessionsHref?: string
  navigationAfterDashboard?: ReactNode
  sidebarFooter?: ReactNode
  /**
   * Header end slot. The application places its account block here (for the default product shell,
   * `AccountMenu` from `(dashboard)/layout.tsx` and the organization frame). The shell never
   * imports the account block, so a downstream can move, replace or drop it.
   */
  headerEnd?: ReactNode
  /**
   * The `sidebar_state` cookie value, read server-side by
   * `(dashboard)/layout.tsx` via `await cookies()`. Restores the
   * collapsed/expanded state across a reload — without this, every render
   * would fall back to `SidebarProvider`'s own `defaultOpen={true}`,
   * silently discarding the cookie `SidebarProvider` itself writes on every
   * toggle.
   */
  defaultSidebarOpen?: boolean
  children: ReactNode
}

/** Existing dashboard/session items plus app-owned navigation slot. */
function NavMenu({
  afterDashboard,
  homeHref,
  sessionsHref,
}: {
  afterDashboard?: ReactNode
  homeHref: string
  sessionsHref: string
}) {
  const t = useTranslations('nav')
  const tSessions = useTranslations('sessions')

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={t('dashboard')} render={<RouteProgressLink href={homeHref} />}>
          <LayoutDashboardIcon aria-hidden="true" />
          <span>{t('dashboard')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {afterDashboard}
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={tSessions('title')}
          render={<RouteProgressLink href={sessionsHref} />}
        >
          <MonitorIcon aria-hidden="true" />
          <span>{tSessions('title')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/**
 * The dashboard app shell: a shadcn/Base UI Sidebar composition (nav,
 * language switcher in the header) around the page content. `SidebarProvider` owns the
 * open/collapsed state itself (cookie-backed, `useSidebar()`) — there is no
 * separate app-level store for it. Route-level plumbing (session read, the
 * real auth gate, the cookie read below) stays in `(dashboard)/layout.tsx`;
 * this widget only receives the already-resolved `defaultSidebarOpen` and the `headerEnd` slot.
 */
export function AppShell({
  headerEnd,
  homeHref = '/',
  sessionsHref = '/settings/sessions',
  defaultSidebarOpen,
  children,
  navigationAfterDashboard,
  sidebarFooter,
}: AppShellProps) {
  const t = useTranslations('nav')

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <MobileNavigationBoundary>
        <Sidebar
          collapsible="icon"
          mobileTitle={t('mobileTitle')}
          mobileDescription={t('mobileDescription')}
        >
          <SidebarHeader>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <PanelLeftIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="font-semibold group-data-[collapsible=icon]:hidden">AMCore</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <NavMenu
                  afterDashboard={navigationAfterDashboard}
                  homeHref={homeHref}
                  sessionsHref={sessionsHref}
                />
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          {sidebarFooter && <SidebarFooter>{sidebarFooter}</SidebarFooter>}
          <SidebarRail toggleLabel={t('toggleSidebar')} />
        </Sidebar>
        {/* `SidebarInset` already renders the page's `<main>` landmark — a
      nested one here would trip axe's landmark-main-is-top-level/
      no-duplicate-main rules, caught live by sidebar.stories.tsx's a11y
      gate. */}
        <SidebarInset className="min-w-0">
          <header className="flex h-14 items-center gap-2 border-b border-border px-4">
            <SidebarTrigger toggleLabel={t('toggleSidebar')} />
            <div className="ml-auto flex items-center gap-2">
              <LocaleSwitcher />
              {headerEnd}
            </div>
          </header>
          <div className="w-full p-4 sm:p-6">{children}</div>
        </SidebarInset>
      </MobileNavigationBoundary>
    </SidebarProvider>
  )
}

function MobileNavigationBoundary({ children }: { children: ReactNode }) {
  const { setOpenMobile } = useSidebar()
  return (
    <AcceptedNavigationProvider onAccepted={() => setOpenMobile(false)}>
      {children}
    </AcceptedNavigationProvider>
  )
}
