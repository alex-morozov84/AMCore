import type { ReactNode } from 'react'
import { cookies } from 'next/headers'

import { OrganizationNavigationEntry } from '@/_app/organization-access/index.client'
import { organizationAccessPlacement } from '@/_app/organization-access/index.config'
import { SIDEBAR_COOKIE_NAME } from '@/shared/ui/sidebar-cookie'
import { AccountMenu } from '@/widgets/account-menu'
import { AppShell } from '@/widgets/app-shell'

interface DashboardLayoutProps {
  children: ReactNode
}

// See `page.tsx`'s identical export - this layout also reads `cookies()` on every render.
export const dynamic = 'force-dynamic'

/**
 * Display-only - not the auth gate (`(dashboard)/page.tsx`'s own `requireSession()` is). The
 * account block (`AccountMenu`) reads the current user on the client, so this layout no longer
 * reads the session; it only places the block into the shell's `headerEnd` slot.
 */
export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  // `SidebarProvider` writes this cookie client-side on every toggle
  // (shared/ui/sidebar.tsx). Reading it here and passing it back in as
  // `defaultOpen` is what makes the collapsed/expanded choice survive a
  // reload - without this read, every render would silently discard it and
  // fall back to `SidebarProvider`'s own `defaultOpen={true}`. `undefined`
  // (no cookie yet, e.g. first visit) intentionally falls through to that
  // same default rather than being coerced to `false`.
  const sidebarCookie = (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value
  const defaultSidebarOpen = sidebarCookie === undefined ? undefined : sidebarCookie === 'true'

  return (
    <AppShell
      homeHref={organizationAccessPlacement.homeHref}
      headerEnd={<AccountMenu />}
      defaultSidebarOpen={defaultSidebarOpen}
      navigationAfterDashboard={<OrganizationNavigationEntry />}
    >
      {children}
    </AppShell>
  )
}
