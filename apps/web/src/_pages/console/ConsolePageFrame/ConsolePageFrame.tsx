import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { cookies } from 'next/headers'

import { getConsoleAwareUser } from '@/shared/api/console/access-token'
import { requireSuperAdmin } from '@/shared/lib/require-super-admin'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'
import { SIDEBAR_COOKIE_NAME } from '@/shared/ui/sidebar-cookie'
import { ConsoleShell } from '@/widgets/console-shell'

interface ConsolePageFrameProps {
  children: ReactNode
  fallback: ReactNode
}

/** Revalidates admission before mounting identity-bearing console chrome. */
export async function ConsolePageFrame({ children, fallback }: ConsolePageFrameProps) {
  if ((await requireSuperAdmin()) === 'unavailable') {
    return <PrimaryUnavailableFallback reason="upstream" />
  }
  const sidebarCookie = (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value
  const defaultSidebarOpen = sidebarCookie === undefined ? undefined : sidebarCookie === 'true'
  const user = await getConsoleAwareUser()
  return (
    <ConsoleShell user={user} defaultSidebarOpen={defaultSidebarOpen}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ConsoleShell>
  )
}
