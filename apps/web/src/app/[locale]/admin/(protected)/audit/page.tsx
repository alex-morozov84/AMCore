import { ConsolePageFrame } from '@/_pages/console'
import { AuditPage, parseAuditParams, type RawAuditParams } from '@/_pages/console/AuditPage'

interface AuditRouteProps {
  searchParams: Promise<RawAuditParams>
}

export default async function AuditRoute({ searchParams }: AuditRouteProps) {
  const query = parseAuditParams(await searchParams)
  return (
    <ConsolePageFrame
      fallback={<div className="h-64 animate-pulse rounded-md bg-muted" aria-hidden="true" />}
    >
      <AuditPage query={query} />
    </ConsolePageFrame>
  )
}
