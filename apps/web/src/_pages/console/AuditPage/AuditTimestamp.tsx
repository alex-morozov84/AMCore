'use client'

import { useFormatter } from 'next-intl'

import { formatConsoleDate, formatConsoleTime } from '@/shared/lib/format-console-date-time'

import { useAuditTimeZone } from './AuditTimeZone'

export function AuditTimestamp({ value, inline = false }: { value: string; inline?: boolean }) {
  const { zone } = useAuditTimeZone()
  const format = useFormatter()
  const date = new Date(value)
  return (
    <time
      dateTime={value}
      className={inline ? 'tabular-nums' : 'flex flex-col leading-tight tabular-nums'}
    >
      <span>{formatConsoleDate(format, date, zone)}</span>{' '}
      <span className={inline ? '' : 'mt-1 text-xs text-muted-foreground'}>
        {formatConsoleTime(format, date, { timeZone: zone, seconds: true })}
      </span>
    </time>
  )
}
