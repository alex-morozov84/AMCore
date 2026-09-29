'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { UserResponse } from '@amcore/shared'
import { ShieldCheckIcon } from 'lucide-react'

import { ConsoleLogoutButton } from '@/features/console-logout'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'
import { ConsoleTimeZoneProvider } from '@/shared/lib/console-time-zone'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/shared/ui/sidebar'

import { ConsoleBreadcrumb } from './ConsoleBreadcrumb'
import { ConsoleLocaleSwitcher } from './ConsoleLocaleSwitcher'
import { ConsoleNavigation } from './ConsoleNavigation'
import { ConsoleTimeZoneSwitcher } from './ConsoleTimeZoneSwitcher'
import { ConsoleUserBadge } from './ConsoleUserBadge'

interface ConsoleShellProps {
  children: ReactNode
  /** Server-resolved (`getConsoleAwareUser`) - chrome only, never an auth decision. */
  user: UserResponse | null
  /** Presentation preference read from the non-sensitive sidebar cookie. */
  defaultSidebarOpen?: boolean
}

export function ConsoleShell({ children, defaultSidebarOpen, user }: ConsoleShellProps) {
  const t = useTranslations('console')

  return (
    <ConsoleTimeZoneProvider>
      <SidebarProvider defaultOpen={defaultSidebarOpen}>
        <Sidebar
          collapsible="icon"
          role="navigation"
          aria-label={t('mobileNavigation')}
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
          <SidebarRail toggleLabel={t('toggleNavigation')} />
        </Sidebar>
        <SidebarInset className="min-w-0">
          <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-surface-elevated px-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger toggleLabel={t('toggleNavigation')} />
              <div className="hidden sm:block">
                <ConsoleBreadcrumb />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ConsoleTimeZoneSwitcher />
              <ConsoleLocaleSwitcher />
              <ConsoleUserBadge user={user} />
              {ADMIN_CONSOLE_CONFIG.mode === 'host' && <ConsoleLogoutButton />}
            </div>
          </header>
          <div className="w-full p-4 sm:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </ConsoleTimeZoneProvider>
  )
}
