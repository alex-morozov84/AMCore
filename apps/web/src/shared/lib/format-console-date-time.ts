import type { getFormatter } from 'next-intl/server'

type Formatter = Awaited<ReturnType<typeof getFormatter>>

/** Localized, compact date treatment for dense operational tables. */
export function formatConsoleDate(formatter: Formatter, value: Date, timeZone?: string): string {
  return formatter.dateTime(value, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone })
}

/** Localized clock treatment shown below the date in operational tables. */
export function formatConsoleTime(
  formatter: Formatter,
  value: Date,
  options?: { timeZone?: string; seconds?: boolean }
): string {
  return formatter.dateTime(value, {
    timeStyle: options?.seconds ? 'medium' : 'short',
    timeZone: options?.timeZone,
  })
}
