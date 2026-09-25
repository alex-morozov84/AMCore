import { type AdminAuditResponse, AUDIT_ACTIONS } from '@amcore/shared'
import { Filter } from 'lucide-react'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

import type { AuditCopy } from './audit-copy'
import { auditSummary } from './audit-summary'
import { auditRowFilter } from './audit-url'
import { AuditReference } from './AuditReference'
import { AuditTimestamp } from './AuditTimestamp'
import { CopyAuditId } from './CopyAuditId'

type Item = AdminAuditResponse['items'][number]

export function AuditEventTable({
  items,
  baseHref,
  query,
  copy,
}: {
  items: Item[]
  baseHref: string
  query: Parameters<typeof auditRowFilter>[1]
  copy: AuditCopy
}) {
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface-elevated shadow-md lg:block">
      <Table className="min-w-[1100px] table-fixed">
        <TableHeader>
          <TableRow className="border-line-soft hover:bg-transparent">
            <TableHead className="w-44">{copy.time}</TableHead>
            <TableHead className="w-64">{copy.action}</TableHead>
            <TableHead>{copy.actor}</TableHead>
            <TableHead>{copy.target}</TableHead>
            <TableHead>{copy.organization}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => {
            const known = item.action && AUDIT_ACTIONS.some((code) => code === item.action)
            const label = known
              ? copy.actions[item.action as keyof AuditCopy['actions']]
              : (item.action ?? copy.unknownAction)
            return (
              <TableRow key={item.id ?? `unsafe-${index}`} className="border-line-soft align-top">
                <TableCell className="whitespace-normal text-xs">
                  <AuditTimestamp value={item.createdAt} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <p className="flex items-start gap-1 font-medium">
                    {label}
                    {item.action && (
                      <RouteProgressLink
                        prefetch={false}
                        href={auditRowFilter(baseHref, query, 'action', item.action)}
                        aria-label={`${copy.filterAction}: ${label}`}
                        title={copy.filterAction}
                        className="inline-flex shrink-0 items-center gap-1 rounded p-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2"
                      >
                        <Filter aria-hidden size={14} />
                        <span>{copy.filter}</span>
                      </RouteProgressLink>
                    )}
                  </p>
                  {item.action && (
                    <p
                      className="truncate font-console-mono text-xs text-muted-foreground"
                      title={item.action}
                    >
                      {item.action}
                    </p>
                  )}
                  {auditSummary(item, copy) && (
                    <p className="mt-1 text-xs text-muted-foreground">{auditSummary(item, copy)}</p>
                  )}
                  {item.id && (
                    <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
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
                </TableCell>
                <TableCell className="whitespace-normal">
                  <AuditReference
                    compact
                    id={item.actorId}
                    type={item.actorType}
                    identity={item.actorIdentity}
                    filterKey="actorId"
                    baseHref={baseHref}
                    query={query}
                    copy={copy}
                  />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <AuditReference
                    compact
                    id={item.targetId}
                    type={item.targetType}
                    identity={item.targetIdentity ?? item.targetOrganizationIdentity}
                    filterKey="targetId"
                    baseHref={baseHref}
                    query={query}
                    copy={copy}
                  />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <AuditReference
                    compact
                    id={item.organizationId}
                    type={null}
                    identity={item.organizationIdentity}
                    filterKey="organizationId"
                    baseHref={baseHref}
                    query={query}
                    copy={copy}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
