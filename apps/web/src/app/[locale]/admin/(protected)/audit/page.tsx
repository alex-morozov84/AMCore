import { getMessages } from 'next-intl/server'

import { ConsolePageFrame } from '@/_pages/console'
import {
  AuditPage,
  AuditPageSkeleton,
  parseAuditParams,
  type RawAuditParams,
} from '@/_pages/console/AuditPage'

interface AuditRouteProps {
  searchParams: Promise<RawAuditParams>
}

export default async function AuditRoute({ searchParams }: AuditRouteProps) {
  const query = parseAuditParams(await searchParams)
  const loading = (await getMessages()).console.audit.loading
  return (
    <ConsolePageFrame fallback={<AuditPageSkeleton label={loading} />}>
      <AuditPage query={query} />
    </ConsolePageFrame>
  )
}
