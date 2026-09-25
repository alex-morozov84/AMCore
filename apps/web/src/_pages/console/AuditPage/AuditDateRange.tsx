'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/shared/ui/button'
import { DateTimeRangePicker } from '@/shared/ui/date-time-range-picker'

import { auditCalendarValues } from './audit-calendar-values'
import type { AuditCopy } from './audit-copy'
import { auditRangeError } from './audit-date-window'
import { formatInputInstant, parseInputInstant, useAuditTimeZone } from './AuditTimeZone'

interface Props {
  from: string
  to: string
  setFrom: (value: string) => void
  setTo: (value: string) => void
  copy: AuditCopy
  locale: string
}

function selectedDate(value: string, mode: 'utc' | 'local'): Date | undefined {
  const instant = parseInputInstant(value, mode)
  return instant ? new Date(instant) : undefined
}

export function AuditDateRange({ from, to, setFrom, setTo, copy, locale }: Props) {
  const { mode, zone } = useAuditTimeZone()
  const [preset, setPreset] = useState<'day' | 'week' | null>(null)
  const [current, setCurrent] = useState<Date | null>(null)
  const calendarOpen = current !== null
  useEffect(() => {
    if (!calendarOpen) return
    const timer = window.setInterval(() => setCurrent(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [calendarOpen])
  const start = parseInputInstant(from, mode)
  const end = parseInputInstant(to, mode)
  const error = auditRangeError(start, end)
  const errorText =
    error === 'future' ? copy.futureRange : error === 'tooLong' ? copy.longRange : copy.invalidRange

  function chooseHours(hours: number) {
    const now = Math.floor(Date.now() / 1000) * 1000
    setTo(formatInputInstant(new Date(now).toISOString(), mode))
    setFrom(formatInputInstant(new Date(now - hours * 60 * 60_000).toISOString(), mode))
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
        fromDate={selectedDate(from, mode)}
        toDate={selectedDate(to, mode)}
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
      <p className="text-xs text-muted-foreground">{copy.rangeBounds}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorText}
        </p>
      )}
    </fieldset>
  )
}
