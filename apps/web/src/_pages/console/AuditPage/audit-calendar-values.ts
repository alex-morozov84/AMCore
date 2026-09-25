import { formatInputInstant, parseInputInstant } from './AuditTimeZone'

type Mode = 'utc' | 'local'

/** A new calendar choice keeps the hour/minute but starts with whole seconds. */
export function auditCalendarValues(
  startDate: Date,
  endDate: Date,
  previousFrom: string,
  previousTo: string,
  mode: Mode,
  now = new Date()
): { from: string; to: string } {
  const datePart = (date: Date) => formatInputInstant(date.toISOString(), mode).slice(0, 10)
  const from = `${datePart(startDate)}T${previousFrom.slice(11, 16)}:00`
  const to = `${datePart(endDate)}T${previousTo.slice(11, 16)}:00`
  const current = formatInputInstant(now.toISOString(), mode).slice(0, 19)
  return {
    from:
      Date.parse(parseInputInstant(from, mode) ?? '') > now.getTime()
        ? `${datePart(startDate)}T00:00:00`
        : from,
    to: Date.parse(parseInputInstant(to, mode) ?? '') > now.getTime() ? current : to,
  }
}
