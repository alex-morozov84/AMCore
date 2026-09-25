import { type AdminAuditResponse, AUDIT_ACTIONS } from '@amcore/shared'
import { Filter } from 'lucide-react'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import type { AuditCopy } from './audit-copy'
import { auditSummary } from './audit-summary'
import { auditRowFilter } from './audit-url'
import { AuditReference } from './AuditReference'
import { AuditTimestamp } from './AuditTimestamp'
import { CopyAuditId } from './CopyAuditId'

type Item = AdminAuditResponse['items'][number]

interface RowProps {
  item: Item
  baseHref: string
  query: Parameters<typeof auditRowFilter>[1]
  copy: AuditCopy
}

export function AuditEventRow({ item, baseHref, query, copy }: RowProps) {
  const known = item.action && AUDIT_ACTIONS.some((code) => code === item.action)
  const actionLabel = known
    ? copy.actions[item.action as keyof AuditCopy['actions']]
    : (item.action ?? copy.unknownAction)
  return (
    <li className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{actionLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <AuditTimestamp value={item.createdAt} inline />
          </p>
        </div>
        {item.action && (
          <RouteProgressLink
            prefetch={false}
            href={auditRowFilter(baseHref, query, 'action', item.action)}
            aria-label={`${copy.filterAction}: ${actionLabel}`}
            title={copy.filterAction}
            className="shrink-0 rounded-md border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2"
          >
            <Filter aria-hidden size={16} />
          </RouteProgressLink>
        )}
      </div>
      {auditSummary(item, copy) && (
        <p className="rounded-md bg-muted px-2 py-1 text-sm">{auditSummary(item, copy)}</p>
      )}
      <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
        <AuditReference
          id={item.actorId}
          type={item.actorType}
          identity={item.actorIdentity}
          filterKey="actorId"
          baseHref={baseHref}
          query={query}
          copy={copy}
        />
        {(item.targetId || item.targetType) && (
          <AuditReference
            id={item.targetId}
            type={item.targetType}
            identity={item.targetIdentity ?? item.targetOrganizationIdentity}
            filterKey="targetId"
            baseHref={baseHref}
            query={query}
            copy={copy}
          />
        )}
        {item.organizationId && (
          <AuditReference
            id={item.organizationId}
            type={null}
            identity={item.organizationIdentity}
            filterKey="organizationId"
            baseHref={baseHref}
            query={query}
            copy={copy}
          />
        )}
      </div>
      {item.id && (
        <p className="flex min-w-0 items-center gap-1 border-t border-border pt-2 text-xs text-muted-foreground">
          <span className="shrink-0">{copy.eventId}:</span>{' '}
          <span className="truncate font-console-mono" title={item.id}>
            {item.id}
          </span>
          <CopyAuditId
            id={item.id}
            label={copy.copyId}
            copied={copy.copied}
            failed={copy.copyFailed}
          />
        </p>
      )}
    </li>
  )
}
