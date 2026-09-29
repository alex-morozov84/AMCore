'use client'

import { type FormEvent, useState } from 'react'
import type { AdminAuditQuery } from '@amcore/shared'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button, buttonVariants } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { ConsoleFilterActions } from '@/shared/ui/console-detail/ConsoleFilterActions'
import { ConsoleFilterPanel } from '@/shared/ui/console-detail/ConsoleFilterPanel'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import type { AuditCopy } from './audit-copy'
import { auditRangeError } from './audit-date-window'
import { auditHref } from './audit-url'
import { AuditActionPicker } from './AuditActionPicker'
import { AuditDateRange } from './AuditDateRange'
import { AuditIdentityFilters } from './AuditIdentityFilters'
import { AUDIT_FOCUS_KEY } from './AuditResultRegion'
import { useAuditRangeDraft } from './use-audit-range-draft'

interface Props {
  baseHref: string
  query: AdminAuditQuery
  copy: AuditCopy
  locale: string
}

export function AuditFilters({ baseHref, query, copy, locale }: Props) {
  const router = useRouteProgressRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [actorId, setActorId] = useState(query.actorId ?? '')
  const [targetId, setTargetId] = useState(query.targetId ?? '')
  const [organizationId, setOrganizationId] = useState(query.organizationId ?? '')
  const [actions, setActions] = useState(query.actions ?? (query.action ? [query.action] : []))
  const range = useAuditRangeDraft(query.from!, query.to!)
  const [includeReadEvents, setIncludeReadEvents] = useState(!!query.includeReadEvents)
  const actionFilter =
    actions.length === 1 ? { action: actions[0] } : actions.length > 1 ? { actions } : {}
  const activeCount = [
    query.actorId,
    query.targetId,
    query.organizationId,
    query.action || query.actions?.length,
    query.includeReadEvents,
  ].filter(Boolean).length

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
    const start = range.from.instant
    const end = range.to.instant
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

  return (
    <div className="space-y-3">
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
      <ConsoleFilterPanel className={`${mobileOpen ? 'block' : 'hidden'} md:block`}>
        <form id="audit-filter-panel" onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
            <AuditActionPicker
              selected={actions}
              onChange={setActions}
              copy={copy}
              locale={locale}
            />
            <AuditDateRange range={range} copy={copy} locale={locale} />
          </div>
          <AuditIdentityFilters
            actorId={actorId}
            targetId={targetId}
            organizationId={organizationId}
            copy={copy}
            onSelect={selectIdentity}
            onChange={(key, value) =>
              ({ actorId: setActorId, targetId: setTargetId, organizationId: setOrganizationId })[
                key
              ](value)
            }
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={includeReadEvents} onCheckedChange={setIncludeReadEvents} />
            {copy.includeReadEvents}
          </label>
          <ConsoleFilterActions
            submit={
              <Button type="submit" size="lg">
                {copy.apply}
              </Button>
            }
            reset={
              <RouteProgressLink
                href={baseHref}
                prefetch={false}
                className={buttonVariants({ variant: 'outline', size: 'lg' })}
              >
                {copy.clear}
              </RouteProgressLink>
            }
          />
        </form>
      </ConsoleFilterPanel>
    </div>
  )
}
