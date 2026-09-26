import type { getFormatter } from 'next-intl/server'

import { formatConsoleDate, formatConsoleTime } from '@/shared/lib/format-console-date-time'

/**
 * Stacked date/time cell shared by every dense console admin table (Users,
 * Organizations, Sessions) — date on top, muted time below. The caller
 * handles a missing value with its own worded fallback (e.g. "never signed
 * in"), so this always renders a real timestamp.
 */
export function ConsoleTimestamp({
  value,
  format,
}: {
  value: string
  format: Awaited<ReturnType<typeof getFormatter>>
}) {
  const timestamp = new Date(value)
  return (
    <time dateTime={value} className="flex flex-col leading-tight tabular-nums">
      <span>{formatConsoleDate(format, timestamp)}</span>
      <span className="mt-1 text-xs text-foreground-muted">
        {formatConsoleTime(format, timestamp)}
      </span>
    </time>
  )
}
