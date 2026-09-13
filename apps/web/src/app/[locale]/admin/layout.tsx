import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { hasCanonicalConsoleHost } from '@/shared/lib/console-host-guard'
import { requireSuperAdmin } from '@/shared/lib/require-super-admin'
import { ConsoleShell } from '@/widgets/console-shell'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!(await hasCanonicalConsoleHost())) notFound()
  await requireSuperAdmin()
  return <ConsoleShell>{children}</ConsoleShell>
}
