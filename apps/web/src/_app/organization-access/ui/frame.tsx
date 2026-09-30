import type { ReactNode } from 'react'
import { cookies } from 'next/headers'

import { SIDEBAR_COOKIE_NAME } from '@/shared/ui/sidebar-cookie'
import { AppShell } from '@/widgets/app-shell'

import { safeOrganizationAdmission } from '../model/admission.server'
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
  let email: string | undefined
  try {
    email = (await safeOrganizationAdmission()).actor.email
  } catch {
    /* Page below owns the real gate. */
  }
  const value = (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value
  return (
    <AppShell
      email={email}
      homeHref={organizationAccessHrefs(placement).homeHref}
      defaultSidebarOpen={value === undefined ? undefined : value === 'true'}
      navigationAfterDashboard={<OrganizationNavigationEntry placement={placement} />}
    >
      {children}
    </AppShell>
  )
}
