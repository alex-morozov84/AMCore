import type { ReactNode } from 'react'

import { requireSuperAdmin } from '@/shared/lib/require-super-admin'
import { ConsoleShell } from '@/widgets/console-shell'

export default async function ProtectedConsoleLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin()
  return <ConsoleShell>{children}</ConsoleShell>
}
