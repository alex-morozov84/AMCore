'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { LogoutButton } from '@/features/auth-logout'
import { LocaleSwitcher } from '@/features/locale-switcher'
import { Link } from '@/i18n/navigation'
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
} from '@/shared/ui/sidebar'

interface AppShellProps {
  email?: string
  children: ReactNode
}

/**
 * The dashboard app shell: a shadcn/Base UI Sidebar composition (nav,
 * account footer) around the page content. `SidebarProvider` owns the
 * open/collapsed state itself (cookie-backed, `useSidebar()`) — there is no
 * separate app-level store for it. Route-level plumbing (session read, the
 * real auth gate) stays in `(dashboard)/layout.tsx`; this widget only
 * receives the already-resolved `email`.
 */
export function AppShell({ email, children }: AppShellProps) {
  const t = useTranslations('nav')
  const tSessions = useTranslations('sessions')

  return (
    <SidebarProvider>
      <Sidebar mobileTitle={t('mobileTitle')} mobileDescription={t('mobileDescription')}>
        <SidebarHeader>
          <span className="px-2 py-1.5 font-semibold">AMCore</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton render={<Link href="/" />}>
                    <span>{t('dashboard')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton render={<Link href="/settings/sessions" />}>
                    <span>{tSessions('title')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
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
    </SidebarProvider>
  )
}
