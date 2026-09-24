import type { AdminAuditResponse } from '@amcore/shared'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import type { AuditCopy } from './audit-copy'
import { auditRowFilter } from './audit-url'
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
}

export function AuditReference({
  id,
  type,
  identity,
  filterKey,
  baseHref,
  query,
  copy,
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
  const typeLabel = type ? (copy.types[type] ?? type) : null
  const display = name || secondary || typeLabel || id || copy.unknownId
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium">{display}</p>
      {name && secondary && name !== secondary && (
        <p className="break-all text-xs text-muted-foreground">{secondary}</p>
      )}
      {identity?.status === 'current' && (
        <p className="text-xs text-muted-foreground">{copy.currentIdentity}</p>
      )}
      {identity?.status === 'not_found' && (
        <p className="text-xs text-muted-foreground">{copy.noCurrentRecord}</p>
      )}
      {identity?.status === 'current' && !name && !secondary && (
        <p className="text-xs text-muted-foreground">{copy.unavailableIdentity}</p>
      )}
      {typeLabel && display !== typeLabel && (
        <p className="text-xs text-muted-foreground">{typeLabel}</p>
      )}
      {id && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="break-all font-console-mono">{id}</span>
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
