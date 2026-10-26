import type { ReactNode } from 'react'
import { cookies } from 'next/headers'

import { ClientMessages } from '@/i18n/client-message-boundary'
import { SIDEBAR_COOKIE_NAME } from '@/shared/ui/sidebar-cookie'
import { AccountMenu } from '@/widgets/account-menu'
import { AppShell } from '@/widgets/app-shell'

import {
  organizationAccessHrefs,
  type OrganizationAccessPlacement,
  organizationAccessPlacement,
} from '../model/placement'

import { OrganizationNavigationEntry } from './navigation-entry'

import 'server-only'

export async function OrganizationAccessFrame({
  children,
  placement = organizationAccessPlacement,
  headerEnd,
  sessionsHref,
  sidebarFooter,
}: {
  children: ReactNode
  placement?: OrganizationAccessPlacement
  headerEnd?: ReactNode
  sessionsHref?: string
  sidebarFooter?: ReactNode
}) {
  const value = (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value
  return (
    <ClientMessages
      namespaces={[
        'auth',
        'nav',
        'sessions',
        'account',
        'organizationAccess',
        'ownApiKeys',
        'dashboard',
      ]}
    >
      <AppShell
        homeHref={organizationAccessHrefs(placement).homeHref}
        headerEnd={headerEnd ?? <AccountMenu />}
        sessionsHref={sessionsHref}
        sidebarFooter={sidebarFooter}
        defaultSidebarOpen={value === undefined ? undefined : value === 'true'}
        navigationAfterDashboard={<OrganizationNavigationEntry placement={placement} />}
      >
        {children}
      </AppShell>
    </ClientMessages>
  )
}
