'use client'

import { useConsoleTimeZone } from '@/shared/lib/console-time-zone'
import { Timestamp } from '@/shared/ui/timestamp'

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
  const { zone } = useConsoleTimeZone()
  return <Timestamp value={value} variant={variant} seconds={seconds} timeZone={zone} />
}
