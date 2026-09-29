'use client'

import { useFormatter } from 'next-intl'

import { useConsoleTimeZone } from '@/shared/lib/console-time-zone'
import { formatConsoleDate, formatConsoleTime } from '@/shared/lib/format-console-date-time'

/** Serializable presentation props keep server data fetching outside this leaf. */
export function ConsoleTimestamp({
  value,
  variant = 'stacked',
  seconds = false,
}: {
  value: string
  variant?: 'stacked' | 'date' | 'inline'
  seconds?: boolean
}) {
  const format = useFormatter()
  const { zone } = useConsoleTimeZone()
  const date = new Date(value)
  return (
    <time
      dateTime={value}
      className={
        variant === 'stacked' ? 'flex flex-col leading-tight tabular-nums' : 'tabular-nums'
      }
    >
      <span>{formatConsoleDate(format, date, zone)}</span>
      {variant !== 'date' && (
        <>
          {variant === 'inline' ? ' / ' : null}
          <span className={variant === 'stacked' ? 'mt-1 text-xs text-muted-foreground' : ''}>
            {formatConsoleTime(format, date, { timeZone: zone, seconds })}
          </span>
        </>
      )}
    </time>
  )
}
