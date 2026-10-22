import type { ScheduledSchedule } from '@amcore/shared'

export type ScheduleText =
  | { kind: 'daily'; time: string }
  | { kind: 'everySeconds'; seconds: number }
  | { kind: 'everyMinute' }
  | { kind: 'raw'; expression: string }

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * Turns the scheduler's six-field cron expression into a phrase an operator reads at a glance.
 * Only the shapes the catalogue uses are translated; anything else is shown as written rather
 * than guessed, so the screen never states a schedule it did not understand.
 */
export function describeSchedule(schedule: ScheduledSchedule): ScheduleText {
  if (schedule.kind === 'interval')
    return { kind: 'everySeconds', seconds: Math.max(1, Math.round(schedule.everyMs / 1000)) }
  // The scheduler accepts five fields (no seconds) or six; `@nestjs/schedule` names use both.
  const fields = schedule.expression.trim().split(/\s+/)
  const parts = fields.length === 5 ? ['0', ...fields] : fields
  const [second, minute, hour, day, month, weekday] = parts
  if (parts.length !== 6 || day !== '*' || month !== '*' || weekday !== '*')
    return { kind: 'raw', expression: schedule.expression }
  const step = /^\*\/(\d+)$/.exec(second ?? '')
  if (step && minute === '*' && hour === '*')
    return { kind: 'everySeconds', seconds: Number(step[1]) }
  if (second === '0' && (minute === '*' || minute === '*/1') && hour === '*')
    return { kind: 'everyMinute' }
  if (second === '0' && /^\d+$/.test(minute ?? '') && /^\d+$/.test(hour ?? ''))
    return { kind: 'daily', time: `${pad(Number(hour))}:${pad(Number(minute))}` }
  return { kind: 'raw', expression: schedule.expression }
}

/** Seconds below 10 keep one decimal ("1.2 s"); longer runs are whole seconds, then minutes. */
export function durationParts(ms: number): { unit: 'ms' | 'seconds' | 'minutes'; n: number } {
  if (ms < 1000) return { unit: 'ms', n: Math.round(ms) }
  if (ms < 60_000)
    return { unit: 'seconds', n: ms < 10_000 ? Math.round(ms / 100) / 10 : Math.round(ms / 1000) }
  return { unit: 'minutes', n: Math.round(ms / 6000) / 10 }
}
