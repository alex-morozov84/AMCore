'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { UserResponse } from '@amcore/shared'
import { ShieldCheckIcon } from 'lucide-react'

import { ConsoleLogoutButton } from '@/features/console-logout'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/shared/ui/sidebar'

import { ConsoleBreadcrumb } from './ConsoleBreadcrumb'
import { ConsoleNavigation } from './ConsoleNavigation'
import { ConsoleUserBadge } from './ConsoleUserBadge'

interface ConsoleShellProps {
  children: ReactNode
  /** Server-resolved (`getConsoleAwareUser`) - chrome only, never an auth decision. */
  user: UserResponse | null
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
            <ConsoleUserBadge user={user} />
            {ADMIN_CONSOLE_CONFIG.mode === 'host' && <ConsoleLogoutButton />}
          </div>
        </header>
        <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
