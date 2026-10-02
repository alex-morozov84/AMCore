import { MODEL_FIELDS, type ModelSubject } from './permission-model-fields'

const DATE_MAX = 8_640_000_000_000_000

export const isEpochMilliseconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= DATE_MAX

/** Build an evaluated copy; stored JSON remains untouched. */
export function normalizeDateConditions(
  conditions: Record<string, unknown>,
  subject: ModelSubject
): Record<string, unknown> {
  const dateFields = MODEL_FIELDS[subject]
  const walk = (value: unknown, key?: string): unknown => {
    if (Array.isArray(value)) return value.map((item) => walk(item, key))
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([child, item]) => [
          child,
          walk(
            item,
            child === 'AND' || child === 'OR' || child === 'NOT' ? undefined : (key ?? child)
          ),
        ])
      )
    }
    if (
      key &&
      (dateFields[key] === 'date' || dateFields[key] === 'nullableDate') &&
      isEpochMilliseconds(value)
    )
      return new Date(value)
    return value
  }
  return walk(conditions) as Record<string, unknown>
}
