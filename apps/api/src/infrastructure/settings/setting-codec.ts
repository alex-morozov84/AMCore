import { z } from 'zod'

import type { SettingDefinition, SettingRow } from './setting-definition'

const envelopeSchema = z.strictObject({ value: z.json() })
export const SETTING_BYTES_LIMIT = 16_384

export function encodeSetting<T>(definition: SettingDefinition<T>, value: T): { value: T } {
  const envelope = envelopeSchema.parse({ value: definition.schema.parse(value) })
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > SETTING_BYTES_LIMIT) {
    throw new Error('Setting envelope exceeds byte limit')
  }
  return envelope as { value: T }
}

export function decodeSetting<T>(definition: SettingDefinition<T>, row: SettingRow): T | undefined {
  if (
    row.key !== definition.key ||
    row.schemaVersion !== definition.schemaVersion ||
    !Number.isInteger(row.revision) ||
    row.revision < 0 ||
    row.revision > 2_147_483_647
  ) {
    throw new Error('Setting identity or version mismatch')
  }
  if (row.override === null) return undefined
  const envelope = envelopeSchema.parse(row.override)
  return encodeSetting(definition, definition.schema.parse(envelope.value)).value
}

export function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

export function immutable<T>(value: T): T {
  const copy = structuredClone(value)
  function freeze(v: unknown): void {
    if (!v || typeof v !== 'object') return
    for (const child of Object.values(v)) freeze(child)
    Object.freeze(v)
  }
  freeze(copy)
  return copy
}
