'use client'

import { type FormEvent, useState } from 'react'
import type { AdminAuditQuery } from '@amcore/shared'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button, buttonVariants } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import type { AuditCopy } from './audit-copy'
import { auditRangeError } from './audit-date-window'
import { auditHref } from './audit-url'
import { AuditActionPicker } from './AuditActionPicker'
import { AuditDateRange } from './AuditDateRange'
import { AuditLookup } from './AuditLookup'
import { AUDIT_FOCUS_KEY } from './AuditResultRegion'
import {
  formatInputInstant,
  localUtcOffset,
  parseInputInstant,
  useAuditTimeZone,
} from './AuditTimeZone'

interface Props {
  baseHref: string
  query: AdminAuditQuery
  copy: AuditCopy
  locale: string
}
type Destination = 'actorId' | 'targetId'

export function AuditFilters({ baseHref, query, copy, locale }: Props) {
  const router = useRouteProgressRouter()
  const { mode, zone, setMode } = useAuditTimeZone()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(
    !!(query.actorId || query.targetId || query.organizationId)
  )
  const [actorId, setActorId] = useState(query.actorId ?? '')
  const [targetId, setTargetId] = useState(query.targetId ?? '')
  const [organizationId, setOrganizationId] = useState(query.organizationId ?? '')
  const [actions, setActions] = useState(query.actions ?? (query.action ? [query.action] : []))
  const [from, setFrom] = useState(formatInputInstant(query.from!, 'utc'))
  const [to, setTo] = useState(formatInputInstant(query.to!, 'utc'))
  const [includeReadEvents, setIncludeReadEvents] = useState(!!query.includeReadEvents)
  const [destination, setDestination] = useState<Destination>('actorId')
  const actionFilter =
    actions.length === 1 ? { action: actions[0] } : actions.length > 1 ? { actions } : {}
  const activeCount = [
    query.actorId,
    query.targetId,
    query.organizationId,
    query.action || query.actions?.length,
    query.includeReadEvents,
  ].filter(Boolean).length

  function switchMode(next: 'utc' | 'local') {
    const start = parseInputInstant(from, mode)
    const end = parseInputInstant(to, mode)
    if (!start || !end) return
    setMode(next)
    setFrom(formatInputInstant(start, next))
    setTo(formatInputInstant(end, next))
  }

  function navigate(next: AdminAuditQuery) {
    try {
      sessionStorage.setItem(AUDIT_FOCUS_KEY, '1')
    } catch {
      /* Navigation still works. */
    }
    router.push(auditHref(baseHref, next))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const start = parseInputInstant(from, mode)
    const end = parseInputInstant(to, mode)
    if (!start || !end || auditRangeError(start, end)) return
    navigate({
      actorId: actorId.trim() || undefined,
      actorType: query.actorType,
      targetId: targetId.trim() || undefined,
      targetType: query.targetType,
      organizationId: organizationId.trim() || undefined,
      ...actionFilter,
      from: start,
      to: end,
      includeReadEvents: includeReadEvents || undefined,
      limit: query.limit,
    })
  }

  function selectIdentity(key: 'actorId' | 'targetId' | 'organizationId', id: string) {
    const next = { ...query, [key]: id }
    delete next.cursor
    navigate(next)
  }

  const inputClass = 'block w-full rounded-md border border-input bg-background px-3 py-2'
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm shadow-md">
        <p>
          {copy.allTimesIn}{' '}
          <strong>
            {mode === 'local' ? `${zone} (${copy.currentOffset} ${localUtcOffset()})` : zone}
          </strong>
        </p>
        <div className="inline-flex gap-1" role="group" aria-label={copy.timeZone}>
          <Button
            type="button"
            size="sm"
            variant={mode === 'utc' ? 'secondary' : 'ghost'}
            aria-pressed={mode === 'utc'}
            onClick={() => switchMode('utc')}
          >
            UTC
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'local' ? 'secondary' : 'ghost'}
            aria-pressed={mode === 'local'}
            onClick={() => switchMode('local')}
          >
            {copy.browserTime}
          </Button>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full md:hidden"
        aria-expanded={mobileOpen}
        aria-controls="audit-filter-panel"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? copy.hideFilters : copy.showFilters}
        {activeCount > 0 ? ` (${activeCount})` : ''}
      </Button>
      <form
        id="audit-filter-panel"
        onSubmit={submit}
        className={`${mobileOpen ? 'block' : 'hidden'} space-y-4 rounded-lg border border-border bg-surface-elevated p-4 shadow-md md:block`}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
          <AuditActionPicker selected={actions} onChange={setActions} copy={copy} locale={locale} />
          <AuditDateRange
            from={from}
            to={to}
            setFrom={setFrom}
            setTo={setTo}
            copy={copy}
            locale={locale}
          />
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{copy.userDestination}:</span>
            <div className="flex gap-1" role="group" aria-label={copy.userDestination}>
              {(['actorId', 'targetId'] as const).map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={destination === kind ? 'secondary' : 'outline'}
                  aria-pressed={destination === kind}
                  onClick={() => setDestination(kind)}
                >
                  {kind === 'actorId' ? copy.actor : copy.target}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <AuditLookup
              kind="user"
              copy={copy}
              onSelect={(id) => selectIdentity(destination, id)}
            />
            <AuditLookup
              kind="organization"
              copy={copy}
              onSelect={(id) => selectIdentity('organizationId', id)}
            />
          </div>
        </div>
        <details
          className="rounded-md border border-border p-3"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-sm font-medium">{copy.advancedIds}</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {(
              [
                [copy.actorId, actorId, setActorId],
                [copy.targetId, targetId, setTargetId],
                [copy.organizationId, organizationId, setOrganizationId],
              ] as const
            ).map(([label, value, setter]) => (
              <label key={label} className="space-y-1 text-sm">
                {label}
                <input
                  value={value}
                  onChange={(event) => setter(event.target.value)}
                  maxLength={128}
                  className={inputClass}
                />
              </label>
            ))}
          </div>
        </details>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 cursor-pointer accent-primary"
            checked={includeReadEvents}
            onChange={(event) => setIncludeReadEvents(event.target.checked)}
          />
          {copy.includeReadEvents}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{copy.apply}</Button>
          <RouteProgressLink
            href={baseHref}
            prefetch={false}
            className={buttonVariants({ variant: 'outline' })}
          >
            {copy.clear}
          </RouteProgressLink>
        </div>
      </form>
    </div>
  )
}
