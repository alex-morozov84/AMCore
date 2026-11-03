import { getMessages } from 'next-intl/server'

import { ConsolePageFrame } from '@/_pages/console'
import {
  AuditPage,
  AuditPageSkeleton,
  parseAuditParams,
  type RawAuditParams,
} from '@/_pages/console/AuditPage'
import { requireConsoleEnabled } from '@/shared/lib/console-host-guard'

interface AuditRouteProps {
  searchParams: Promise<RawAuditParams>
}

export default async function AuditRoute({ searchParams }: AuditRouteProps) {
  requireConsoleEnabled()
  const query = parseAuditParams(await searchParams)
  const loading = (await getMessages()).console.audit.loading
  return (
    <ConsolePageFrame fallback={<AuditPageSkeleton label={loading} />}>
      <AuditPage query={query} />
    </ConsolePageFrame>
  )
}
