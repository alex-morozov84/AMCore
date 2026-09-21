import { cache } from 'react'
import { notFound } from 'next/navigation'

import { probeConsoleAccess } from '@/shared/api/console/access-probe'

import 'server-only'

/**
 * React `cache` is request-scoped for a Server Component render. It avoids a
 * duplicate live probe during one render without retaining a role decision for
 * a later request.
 */
export type ConsoleAdmission = 'admitted' | 'unavailable'

export const requireSuperAdmin = cache(async (): Promise<ConsoleAdmission> => {
  const result = await probeConsoleAccess()
  if (result.kind === 'admitted') return 'admitted'
  if (result.kind === 'upstream-unavailable') return 'unavailable'
  notFound()
})
