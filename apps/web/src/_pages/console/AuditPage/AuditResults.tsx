import type { AdminAuditQuery } from '@amcore/shared'

import { fetchConsoleAudit } from '@/shared/api/console/audit'
import { BackendRequestError } from '@/shared/api/server/errors'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import type { AuditCopy } from './audit-copy'
import { auditCursorReset, auditHref } from './audit-url'
import { AuditEventRow } from './AuditEventRow'
import { AuditPaging } from './AuditPaging'
import { AuditResultRegion } from './AuditResultRegion'

interface AuditResultsProps {
  baseHref: string
  query: AdminAuditQuery
  copy: AuditCopy
  locale: string
}

export async function AuditResults({ baseHref, query, copy, locale }: AuditResultsProps) {
  let result: Awaited<ReturnType<typeof fetchConsoleAudit>>
  try {
    result = await fetchConsoleAudit(query)
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 400) {
      return (
        <div role="alert" className="rounded-md border border-border p-4">
          <p>{query.cursor ? copy.invalidCursor : copy.invalidFilters}</p>
          <RouteProgressLink
            prefetch={false}
            href={query.cursor ? auditCursorReset(baseHref, query) : baseHref}
            className="underline underline-offset-2"
          >
            {copy.resetCursor}
          </RouteProgressLink>
        </div>
      )
    }
    throw error
  }
  if (result.status === 'unavailable') return <PrimaryUnavailableFallback reason={result.reason} />
  if (result.status === 'not-found') return <PrimaryUnavailableFallback reason="upstream" />
  const data = result.data
  const fixedQuery = { ...query, from: data.from, to: data.to }
  const nextHref = data.nextCursor
    ? auditHref(baseHref, {
        ...fixedQuery,
        cursor: data.nextCursor,
      })
    : null
  const currentHref = auditHref(baseHref, fixedQuery)
  const filtered = !!(
    query.actorId ||
    query.actorType ||
    query.action ||
    query.targetId ||
    query.targetType ||
    query.organizationId
  )
  const formatTime = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(value))
  return (
    <AuditResultRegion readToken={crypto.randomUUID()} loading={copy.loading}>
      <p className="text-sm text-muted-foreground">
        {copy.from}: {formatTime(data.from)} · {copy.to}: {formatTime(data.to)}
      </p>
      {data.items.length === 0 ? (
        <p role="status" className="rounded-md border border-border p-4">
          {filtered ? copy.noMatches : copy.empty}
        </p>
      ) : (
        <ol className="space-y-3">
          {data.items.map((item, index) => (
            <AuditEventRow
              key={item.id ?? `unsafe-${index}`}
              item={item}
              baseHref={baseHref}
              query={fixedQuery}
              copy={copy}
              locale={locale}
            />
          ))}
        </ol>
      )}
      {!data.hasMore && data.items.length > 0 && (
        <p className="text-sm text-muted-foreground">{copy.end}</p>
      )}
      <AuditPaging
        nextHref={nextHref}
        currentHref={currentHref}
        older={copy.older}
        previous={copy.previous}
        hasCursor={!!query.cursor}
      />
    </AuditResultRegion>
  )
}
