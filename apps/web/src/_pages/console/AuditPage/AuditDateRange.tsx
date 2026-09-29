'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { useConsoleTimeZone } from '@/shared/lib/console-time-zone'
import { Button } from '@/shared/ui/button'
import { DateTimeRangePicker } from '@/shared/ui/date-time-range-picker'

import { auditCalendarValues } from './audit-calendar-values'
import type { AuditCopy } from './audit-copy'
import { auditRangeError } from './audit-date-window'
import { formatInputInstant } from './AuditTimeZone'
import type { useAuditRangeDraft } from './use-audit-range-draft'

interface Props {
  range: ReturnType<typeof useAuditRangeDraft>
  copy: AuditCopy
  locale: string
}

export function AuditDateRange({ range, copy, locale }: Props) {
  const t = useTranslations('console.audit')
  const { from: fromEndpoint, to: toEndpoint, setFrom, setTo } = range
  const from = fromEndpoint.text,
    to = toEndpoint.text
  const { mode, zone } = useConsoleTimeZone()
  const [preset, setPreset] = useState<'day' | 'week' | null>(null)
  const [current, setCurrent] = useState<Date | null>(null)
  const calendarOpen = current !== null
  useEffect(() => {
    if (!calendarOpen) return
    const timer = window.setInterval(() => setCurrent(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [calendarOpen])
  const start = fromEndpoint.instant
  const end = toEndpoint.instant
  const error = auditRangeError(start, end)
  const errorText =
    error === 'future' ? copy.futureRange : error === 'tooLong' ? copy.longRange : copy.invalidRange

  function chooseHours(hours: number) {
    const now = Math.floor(Date.now() / 1000) * 1000
    range.setInstants(
      new Date(now - hours * 60 * 60_000).toISOString(),
      new Date(now).toISOString()
    )
    setPreset(hours === 24 ? 'day' : 'week')
  }

  function chooseDates(startDate: Date, endDate: Date) {
    const values = auditCalendarValues(startDate, endDate, from, to, mode)
    setFrom(values.from)
    setTo(values.to)
    setPreset(null)
  }

  function changeTime(key: 'from' | 'to', time: string) {
    setPreset(null)
    const value = key === 'from' ? from : to
    ;(key === 'from' ? setFrom : setTo)(`${value.slice(0, 10)}T${time}`)
  }

  return (
    <fieldset className="space-y-3 rounded-lg border border-border bg-surface-elevated p-3 shadow-md">
      <legend className="px-1 text-sm font-medium">{copy.customRange}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={preset === 'day' ? 'secondary' : 'outline'}
          aria-pressed={preset === 'day'}
          onClick={() => chooseHours(24)}
        >
          {copy.recentDay}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={preset === 'week' ? 'secondary' : 'outline'}
          aria-pressed={preset === 'week'}
          onClick={() => chooseHours(7 * 24)}
        >
          {copy.recentWeek}
        </Button>
        {preset && (
          <span role="status" className="text-xs text-muted-foreground">
            {copy.rangePending}
          </span>
        )}
      </div>
      <DateTimeRangePicker
        fromDate={start ? new Date(start) : undefined}
        toDate={end ? new Date(end) : undefined}
        fromTime={from.slice(11, 19)}
        toTime={to.slice(11, 19)}
        latestDate={current ?? undefined}
        latestTime={
          current ? formatInputInstant(current.toISOString(), mode).slice(11, 19) : undefined
        }
        onOpenChange={(open) => setCurrent(open ? new Date() : null)}
        onDatesChange={chooseDates}
        onTimeChange={changeTime}
        timeZone={zone}
        locale={locale}
        labels={{
          chooseDates: copy.chooseDates,
          chooseEndDate: copy.chooseEndDate,
          rangeSeparator: copy.rangeSeparator,
          startTime: copy.startTime,
          endTime: copy.endTime,
        }}
        invalid={!!error}
      />
      {[fromEndpoint, toEndpoint]
        .filter((endpoint) => endpoint.invalid)
        .map((endpoint, index) => (
          <p key={index} role="alert" className="text-sm text-destructive">
            {t('draftTimeZone', {
              zone:
                endpoint.editMode === 'utc'
                  ? 'UTC'
                  : Intl.DateTimeFormat().resolvedOptions().timeZone,
            })}
            <code className="ml-2">{endpoint.text}</code>
          </p>
        ))}
      <p className="text-xs text-muted-foreground">{copy.rangeBounds}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorText}
        </p>
      )}
    </fieldset>
  )
}
