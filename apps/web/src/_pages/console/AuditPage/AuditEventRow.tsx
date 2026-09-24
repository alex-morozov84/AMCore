import { type AdminAuditResponse, AUDIT_ACTIONS } from '@amcore/shared'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import type { AuditCopy } from './audit-copy'
import { auditRowFilter } from './audit-url'
import { AuditReference } from './AuditReference'
import { CopyAuditId } from './CopyAuditId'

type Item = AdminAuditResponse['items'][number]

interface RowProps {
  item: Item
  baseHref: string
  query: Parameters<typeof auditRowFilter>[1]
  copy: AuditCopy
  locale: string
}

function summary(item: Item, copy: AuditCopy): string | null {
  const values = item.summary
  if (values.beforeSystemRole || values.afterSystemRole)
    return [
      values.beforeSystemRole && `${copy.summaryBeforeRole}: ${values.beforeSystemRole}`,
      values.afterSystemRole && `${copy.summaryAfterRole}: ${values.afterSystemRole}`,
    ]
      .filter(Boolean)
      .join(' | ')
  if (values.count !== undefined) return `${copy.summaryCount}: ${values.count}`
  const parts = [
    values.decision && `${copy.summaryDecision}: ${values.decision}`,
    values.reasonCode && `${copy.summaryReasonCode}: ${values.reasonCode}`,
    values.outcome && `${copy.summaryOutcome}: ${values.outcome}`,
  ].filter(Boolean)
  return parts.length ? parts.join(' | ') : null
}

export function AuditEventRow({ item, baseHref, query, copy, locale }: RowProps) {
  const known = item.action && AUDIT_ACTIONS.some((code) => code === item.action)
  const actionLabel = known
    ? copy.actions[item.action as keyof AuditCopy['actions']]
    : (item.action ?? copy.unknownAction)
  const timestamp = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(item.createdAt))
  return (
    <li className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <time dateTime={item.createdAt} className="text-sm font-medium">
            {timestamp}
          </time>
          <p className="font-medium">{actionLabel}</p>
        </div>
        {item.action && (
          <RouteProgressLink
            prefetch={false}
            href={auditRowFilter(baseHref, query, 'action', item.action)}
            className="text-xs underline underline-offset-2"
          >
            {copy.filterAction}
          </RouteProgressLink>
        )}
      </div>
      {summary(item, copy) && (
        <p className="rounded-md bg-muted px-2 py-1 text-sm">{summary(item, copy)}</p>
      )}
      <div className="grid gap-3 md:grid-cols-3">
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
        <p className="flex flex-wrap items-center gap-2 break-all border-t border-border pt-2 font-console-mono text-xs text-muted-foreground">
          <span className="font-sans">{copy.eventId}:</span> {item.id}{' '}
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
