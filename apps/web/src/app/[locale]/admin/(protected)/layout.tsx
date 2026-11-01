import type { ReactNode } from 'react'

import { requireConsoleEnabled } from '@/shared/lib/console-host-guard'

export default async function ProtectedConsoleLayout({ children }: { children: ReactNode }) {
  requireConsoleEnabled()
  return children
}
