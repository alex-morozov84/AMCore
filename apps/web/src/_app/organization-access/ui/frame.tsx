import type { ReactNode } from 'react'
import { cookies } from 'next/headers'

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
}: {
  children: ReactNode
  placement?: OrganizationAccessPlacement
}) {
  const value = (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value
  return (
    <AppShell
      homeHref={organizationAccessHrefs(placement).homeHref}
      headerEnd={<AccountMenu />}
      defaultSidebarOpen={value === undefined ? undefined : value === 'true'}
      navigationAfterDashboard={<OrganizationNavigationEntry placement={placement} />}
    >
      {children}
    </AppShell>
  )
}
