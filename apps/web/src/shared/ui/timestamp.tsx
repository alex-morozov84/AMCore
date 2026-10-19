'use client'

import { useFormatter } from 'next-intl'

/** Shared date/clock presentation; callers own the time-zone preference. */
export function Timestamp({
  value,
  variant = 'stacked',
  seconds = false,
  timeZone,
}: {
  value: string
  variant?: 'stacked' | 'date' | 'inline'
  seconds?: boolean
  timeZone?: string
}) {
  const format = useFormatter()
  const date = new Date(value)
  return (
    <time
      dateTime={value}
      className={
        variant === 'stacked' ? 'flex flex-col leading-tight tabular-nums' : 'tabular-nums'
      }
    >
      <span>
        {format.dateTime(date, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone })}
      </span>
      {variant !== 'date' && (
        <>
          {variant === 'inline' ? ', ' : null}
          <span className={variant === 'stacked' ? 'mt-1 text-xs text-muted-foreground' : ''}>
            {format.dateTime(date, { timeStyle: seconds ? 'medium' : 'short', timeZone })}
          </span>
        </>
      )}
    </time>
  )
}
