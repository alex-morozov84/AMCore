'use client'

import { type FormEvent, useState } from 'react'
import { type AdminAuditQuery, AUDIT_ACTIONS } from '@amcore/shared'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { InfoTooltip } from '@/shared/ui/info-tooltip'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import type { AuditCopy } from './audit-copy'
import { auditHref } from './audit-url'
import { AuditDateRange, localTime, utcTime } from './AuditDateRange'
import { AuditLookup } from './AuditLookup'
import { AUDIT_FOCUS_KEY } from './AuditResultRegion'

interface AuditFiltersProps {
  baseHref: string
  query: AdminAuditQuery
  copy: AuditCopy
}

/** Deliberate submit keeps lookup drafts out of URL history; filter changes drop the cursor. */
export function AuditFilters({ baseHref, query, copy }: AuditFiltersProps) {
  const router = useRouteProgressRouter()
  const [actorId, setActorId] = useState(query.actorId ?? '')
  const [organizationId, setOrganizationId] = useState(query.organizationId ?? '')
  const [targetId, setTargetId] = useState(query.targetId ?? '')
  const [action, setAction] = useState(query.action ?? '')
  const [from, setFrom] = useState(localTime(query.from))
  const [to, setTo] = useState(localTime(query.to))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      sessionStorage.setItem(AUDIT_FOCUS_KEY, '1')
    } catch {
      // Navigation still works when storage is unavailable.
    }
    router.push(
      auditHref(baseHref, {
        actorId: actorId.trim() || undefined,
        targetId: targetId.trim() || undefined,
        organizationId: organizationId.trim() || undefined,
        action: action || undefined,
        from: utcTime(from),
        to: utcTime(to),
        limit: query.limit,
      })
    )
  }

  function selectLookup(kind: 'actorId' | 'organizationId', id: string) {
    try {
      sessionStorage.setItem(AUDIT_FOCUS_KEY, '1')
    } catch {
      // Navigation still works when storage is unavailable.
    }
    const selected = {
      actorId: kind === 'actorId' ? id : actorId.trim() || undefined,
      organizationId: kind === 'organizationId' ? id : organizationId.trim() || undefined,
      targetId: targetId.trim() || undefined,
      action: action || undefined,
      from: utcTime(from),
      to: utcTime(to),
      limit: query.limit,
    }
    router.push(auditHref(baseHref, selected))
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-sm">
          {copy.actorId}
          <input
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
            maxLength={128}
            className="block w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          {copy.targetId}
          <input
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            maxLength={128}
            className="block w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          {copy.organizationId}
          <input
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            maxLength={128}
            className="block w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <div className="space-y-1 text-sm">
          <div className="inline-flex items-center gap-1">
            <label htmlFor="audit-action">{copy.action}</label>
            <InfoTooltip label={copy.actionHelp} />
          </div>
          <select
            id="audit-action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className="block w-full rounded-md border border-input bg-background px-3 py-2"
          >
            <option value="">{copy.allActions}</option>
            {action && !AUDIT_ACTIONS.some((code) => code === action) && (
              <option value={action}>{action}</option>
            )}
            {AUDIT_ACTIONS.map((code) => (
              <option key={code} value={code}>
                {copy.actions[code]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <AuditDateRange from={from} to={to} setFrom={setFrom} setTo={setTo} copy={copy} />
      <div className="grid gap-3 md:grid-cols-2">
        <AuditLookup kind="user" copy={copy} onSelect={(id) => selectLookup('actorId', id)} />
        <AuditLookup
          kind="organization"
          copy={copy}
          onSelect={(id) => selectLookup('organizationId', id)}
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {copy.apply}
        </button>
        <RouteProgressLink
          href={baseHref}
          prefetch={false}
          className="rounded-md border border-border px-4 py-2"
        >
          {copy.clear}
        </RouteProgressLink>
      </div>
    </form>
  )
}
