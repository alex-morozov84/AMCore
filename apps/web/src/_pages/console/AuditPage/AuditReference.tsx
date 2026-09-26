import type { AdminAuditResponse } from '@amcore/shared'
import { Filter } from 'lucide-react'

import {
  getConsoleOrganizationDetailHref,
  getConsoleUserDetailHref,
} from '@/shared/lib/console-public-href'
import { ConsoleContextLink } from '@/shared/ui/console-detail/ConsoleContextLink'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import type { AuditCopy } from './audit-copy'
import { auditHref, auditRowFilter } from './audit-url'
import { CopyAuditId } from './CopyAuditId'

type Item = AdminAuditResponse['items'][number]

interface AuditReferenceProps {
  id: string | null
  type: string | null
  identity: Item['actorIdentity'] | Item['organizationIdentity']
  filterKey: 'actorId' | 'targetId' | 'organizationId'
  baseHref: string
  query: Parameters<typeof auditRowFilter>[1]
  copy: AuditCopy
  compact?: boolean
}

export function AuditReference({
  id,
  type,
  identity,
  filterKey,
  baseHref,
  query,
  copy,
  compact = false,
}: AuditReferenceProps) {
  const label =
    filterKey === 'actorId'
      ? copy.actor
      : filterKey === 'targetId'
        ? copy.target
        : copy.organization
  const name = identity?.status === 'current' ? identity.name : undefined
  const secondary =
    identity?.status === 'current'
      ? 'email' in identity
        ? identity.email
        : 'slug' in identity
          ? identity.slug
          : undefined
      : undefined
  const typeLabel = type ? (copy.types[type as keyof AuditCopy['types']] ?? type) : null
  const display =
    name ||
    secondary ||
    (identity?.status === 'current' && id) ||
    (id || typeLabel ? '' : copy.emptyReference)
  const source = auditHref(baseHref, query)
  const detailHref =
    identity?.status === 'current' && id
      ? filterKey === 'organizationId' || type === 'ORGANIZATION'
        ? getConsoleOrganizationDetailHref(id, source)
        : type === 'USER'
          ? getConsoleUserDetailHref(id, source)
          : null
      : null
  const detailKey =
    filterKey === 'organizationId' || type === 'ORGANIZATION' ? `organization:${id}` : `user:${id}`
  const displayNode = detailHref ? (
    <ConsoleContextLink
      href={detailHref}
      detailKey={detailKey}
      className="inline-flex min-h-6 items-center underline-offset-2 hover:underline focus-visible:underline"
    >
      {display}
    </ConsoleContextLink>
  ) : (
    display
  )
  const badge = typeLabel ? (
    <span className="inline-flex shrink-0 rounded border border-border px-1 text-[10px] font-normal text-muted-foreground">
      {typeLabel}
    </span>
  ) : null
  if (compact)
    return (
      <div className="min-w-0 text-xs">
        {badge && <p>{badge}</p>}
        {display && (
          <p className="min-w-0 truncate font-medium" title={display}>
            {displayNode}
          </p>
        )}
        {secondary && secondary !== display && (
          <p className="truncate text-muted-foreground" title={secondary}>
            {secondary}
          </p>
        )}
        {identity?.status === 'not_found' && (
          <span className="text-muted-foreground">{copy.noCurrentRecord}</span>
        )}
        {id && (
          <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate font-console-mono text-muted-foreground" title={id}>
              {id}
            </span>
            <CopyAuditId
              id={id}
              label={copy.copyId}
              copied={copy.copied}
              failed={copy.copyFailed}
            />
            <RouteProgressLink
              prefetch={false}
              href={auditRowFilter(baseHref, query, filterKey, id)}
              aria-label={`${filterKey === 'actorId' ? copy.filterActor : filterKey === 'targetId' ? copy.filterTarget : copy.filterOrganization}: ${id}`}
              title={
                filterKey === 'actorId'
                  ? copy.filterActor
                  : filterKey === 'targetId'
                    ? copy.filterTarget
                    : copy.filterOrganization
              }
              className="inline-flex shrink-0 items-center gap-1 rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-2"
            >
              <Filter aria-hidden size={14} />
              <span>{copy.filter}</span>
            </RouteProgressLink>
          </div>
        )}
      </div>
    )
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {badge && <p>{badge}</p>}
      {display && <p className="break-words text-sm font-medium">{displayNode}</p>}
      {name && secondary && name !== secondary && (
        <p className="break-all text-xs text-muted-foreground">{secondary}</p>
      )}
      {identity?.status === 'not_found' && (
        <p className="text-xs text-muted-foreground">{copy.noCurrentRecord}</p>
      )}
      {identity?.status === 'current' && !name && !secondary && (
        <p className="text-xs text-muted-foreground">{copy.unavailableIdentity}</p>
      )}
      {id && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="break-all font-console-mono text-muted-foreground">{id}</span>
          <CopyAuditId id={id} label={copy.copyId} copied={copy.copied} failed={copy.copyFailed} />
          <RouteProgressLink
            prefetch={false}
            href={auditRowFilter(baseHref, query, filterKey, id)}
            className="underline underline-offset-2"
          >
            {filterKey === 'actorId'
              ? copy.filterActor
              : filterKey === 'targetId'
                ? copy.filterTarget
                : copy.filterOrganization}
          </RouteProgressLink>
        </div>
      )}
    </div>
  )
}
