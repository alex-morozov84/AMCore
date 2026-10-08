export type ProviderRetryHint =
  | { kind: 'relative'; seconds: number }
  | {
      kind: 'date'
      year: number
      month: number
      day: number
      hour: number
      minute: number
      second: number
      weekday: number
      shortYear: boolean
    }
  | { kind: 'unknown'; reason: 'overflow' | 'unsupported_header' }

const hints = new WeakMap<object, ProviderRetryHint>()
export function retryHint(error: unknown): ProviderRetryHint | undefined {
  return typeof error === 'object' && error !== null ? hints.get(error) : undefined
}
export function attachRetryHint<T extends object>(
  error: T,
  hint: ProviderRetryHint | undefined
): T {
  if (hint) hints.set(error, hint)
  return error
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** RFC 9110 duration / HTTP date, kept separate until the locked PostgreSQL clock is known. */
export function parseProviderRetryHint(raw: string | undefined): ProviderRetryHint | undefined {
  if (raw === undefined) return undefined
  if (raw.length > 8192) return { kind: 'unknown', reason: 'unsupported_header' }
  const value = raw.trim()
  if (/^[0-9]+$/.test(value)) {
    const digits = value.replace(/^0+/, '') || '0'
    if (digits.length > 10 || (digits.length === 10 && digits > '2147483647'))
      return { kind: 'unknown', reason: 'overflow' }
    return { kind: 'relative', seconds: Number(digits) }
  }
  const imf =
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), ([0-9]{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/.exec(
      value
    )
  const obsolete =
    /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), ([0-9]{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/.exec(
      value
    )
  const ansi =
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( [1-9]|[0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([0-9]{4})$/.exec(
      value
    )
  const match = imf ?? obsolete
  if (match)
    return validateDate({
      kind: 'date',
      weekday: (obsolete ? LONG_DAYS : DAYS).indexOf(match[1]!),
      day: Number(match[2]),
      month: MONTHS.indexOf(match[3]!),
      year: Number(match[4]),
      hour: Number(match[5]),
      minute: Number(match[6]),
      second: Number(match[7]),
      shortYear: !!obsolete,
    })
  if (ansi)
    return validateDate({
      kind: 'date',
      weekday: DAYS.indexOf(ansi[1]!),
      month: MONTHS.indexOf(ansi[2]!),
      day: Number(ansi[3]),
      hour: Number(ansi[4]),
      minute: Number(ansi[5]),
      second: Number(ansi[6]),
      year: Number(ansi[7]),
      shortYear: false,
    })
  return undefined
}

function validateDate(
  hint: Extract<ProviderRetryHint, { kind: 'date' }>
): ProviderRetryHint | undefined {
  if (
    hint.hour > 23 ||
    hint.minute > 59 ||
    hint.second > 59 ||
    (hint.year === 0 && !hint.shortYear)
  )
    return undefined
  // RFC850 century interpretation and its weekday check belong to the PG-clock settlement.
  const date = new Date(0)
  date.setUTCFullYear(hint.shortYear ? 2000 + hint.year : hint.year, hint.month, hint.day)
  date.setUTCHours(hint.hour, hint.minute, hint.second, 0)
  if (date.getUTCMonth() !== hint.month || date.getUTCDate() !== hint.day) return undefined
  return !hint.shortYear && date.getUTCDay() !== hint.weekday ? undefined : hint
}

export function retryDateAtPgClock(
  hint: Extract<ProviderRetryHint, { kind: 'date' }>,
  pgNow: Date
): Date | null {
  let year = hint.year
  if (hint.shortYear) {
    year += Math.floor(pgNow.getUTCFullYear() / 100) * 100
  }
  const date = new Date(0)
  date.setUTCFullYear(year, hint.month, hint.day)
  date.setUTCHours(hint.hour, hint.minute, hint.second, 0)
  if (hint.shortYear) {
    const horizon = new Date(pgNow)
    horizon.setUTCFullYear(pgNow.getUTCFullYear() + 50)
    if (date > horizon) {
      year -= 100
      date.setUTCFullYear(year, hint.month, hint.day)
    }
  }
  return year >= 1 &&
    year <= 9999 &&
    date.getUTCMonth() === hint.month &&
    date.getUTCDate() === hint.day &&
    date.getUTCDay() === hint.weekday
    ? date
    : null
}
