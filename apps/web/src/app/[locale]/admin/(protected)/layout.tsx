import type { ReactNode } from 'react'

import { getConsoleAwareUser } from '@/shared/api/console/access-token'
import { requireSuperAdmin } from '@/shared/lib/require-super-admin'
import { ConsoleShell } from '@/widgets/console-shell'

export default async function ProtectedConsoleLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin()
  const user = await getConsoleAwareUser()
  return <ConsoleShell user={user}>{children}</ConsoleShell>
}
