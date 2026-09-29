'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { LogoutButton } from '@/features/auth-logout'
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
  navigationAfterDashboard?: ReactNode
  email?: string
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
function NavMenu({ afterDashboard }: { afterDashboard?: ReactNode }) {
  const t = useTranslations('nav')
  const tSessions = useTranslations('sessions')

  return (
    <SidebarMenu>
      {afterDashboard}
      <SidebarMenuItem>
        <SidebarMenuButton render={<RouteProgressLink href="/" />}>
          <span>{t('dashboard')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton render={<RouteProgressLink href="/settings/sessions" />}>
          <span>{tSessions('title')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/**
 * The dashboard app shell: a shadcn/Base UI Sidebar composition (nav,
 * account footer) around the page content. `SidebarProvider` owns the
 * open/collapsed state itself (cookie-backed, `useSidebar()`) — there is no
 * separate app-level store for it. Route-level plumbing (session read, the
 * real auth gate, the cookie read below) stays in `(dashboard)/layout.tsx`;
 * this widget only receives the already-resolved `email`/`defaultSidebarOpen`.
 */
export function AppShell({
  email,
  defaultSidebarOpen,
  children,
  navigationAfterDashboard,
}: AppShellProps) {
  const t = useTranslations('nav')

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <MobileNavigationBoundary>
        <Sidebar mobileTitle={t('mobileTitle')} mobileDescription={t('mobileDescription')}>
          <SidebarHeader>
            <span className="px-2 py-1.5 font-semibold">AMCore</span>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <NavMenu afterDashboard={navigationAfterDashboard} />
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="gap-3">
            {email && <span className="truncate px-2 text-sm text-muted-foreground">{email}</span>}
            <div className="flex items-center justify-between gap-2 px-2">
              <LocaleSwitcher />
              <LogoutButton variant="ghost" showText={false} />
            </div>
          </SidebarFooter>
          <SidebarRail toggleLabel={t('toggleSidebar')} />
        </Sidebar>
        {/* `SidebarInset` already renders the page's `<main>` landmark — a
      nested one here would trip axe's landmark-main-is-top-level/
      no-duplicate-main rules, caught live by sidebar.stories.tsx's a11y
      gate. */}
        <SidebarInset>
          <header className="flex h-14 items-center gap-2 border-b border-border px-4">
            <SidebarTrigger toggleLabel={t('toggleSidebar')} />
          </header>
          <div className="mx-auto w-full max-w-7xl p-4">{children}</div>
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
