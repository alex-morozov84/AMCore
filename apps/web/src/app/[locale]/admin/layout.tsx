import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { hasCanonicalConsoleHost } from '@/shared/lib/console-host-guard'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!(await hasCanonicalConsoleHost())) notFound()
  return children
}
