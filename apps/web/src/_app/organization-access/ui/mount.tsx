import { cache, type ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { isOrganizationContextId } from '@amcore/shared'

import { readOrganizationBootstrap } from '@/entities/organization-context/index.server'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { redirectToLogin } from '@/shared/api/bff/dal'
import { SessionNotFoundError } from '@/shared/api/bff/errors'
import { SIDEBAR_COOKIE_NAME } from '@/shared/ui/sidebar-cookie'
import { AppShell } from '@/widgets/app-shell'

import { OrganizationAccessClientMount } from './mount-client'
import { OrganizationNavigationEntry } from './navigation-entry'

import 'server-only'

const safeAdmission = cache(async () => readOrganizationBootstrap(await headers()))

export async function OrganizationAccessFrame({ children }: { children: ReactNode }) {
  let email: string | undefined
  try {
    email = (await safeAdmission()).actor.email
  } catch {
    /* Page below owns the real gate. */
  }
  const value = (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value
  return (
    <AppShell
      email={email}
      defaultSidebarOpen={value === undefined ? undefined : value === 'true'}
      navigationAfterDashboard={<OrganizationNavigationEntry />}
    >
      {children}
    </AppShell>
  )
}

export async function OrganizationAccessMount({
  id,
  searchParams,
}: {
  id?: string
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (id !== undefined && !isOrganizationContextId(id)) notFound()
  let admission
  try {
    admission = await safeAdmission()
  } catch (error) {
    if (
      error instanceof SessionNotFoundError ||
      (error instanceof ContextRequestError && error.status === 401)
    ) {
      return redirectToLogin()
    }
    throw error
  }
  const search = await searchParams
  const requested = typeof search.page === 'string' ? Number(search.page) : 1
  const page =
    Number.isSafeInteger(requested) && requested >= 1 && (requested - 1) * 20 <= 2_147_483_647
      ? requested
      : 1
  return (
    <OrganizationAccessClientMount
      admission={admission}
      id={id}
      page={page}
      explicitList={search.view === 'list'}
    />
  )
}
