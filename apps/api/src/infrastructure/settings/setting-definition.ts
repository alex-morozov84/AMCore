import type { z } from 'zod'

export interface SettingDefinition<T> {
  readonly key: string
  readonly schemaVersion: number
  readonly schema: z.ZodType<T>
  readonly scope: 'platform'
  readonly storageKind: 'ordinary'
  readonly baseline: () => T
  readonly auditTarget: string
  auditProjection(before: T | undefined, after: T | undefined): Record<string, unknown>
  readonly failurePolicy: 'retain-last-confirmed-or-baseline'
}

export interface SettingSnapshot<T> {
  readonly value: T
  readonly revision: number | null
  readonly source: 'override' | 'baseline' | 'unconfirmed'
  readonly lastConfirmedAt: string | null
  readonly refreshStatus: 'confirmed' | 'unconfirmed' | 'failed' | 'stale'
}

export interface SettingRow {
  key: string
  override: unknown
  schemaVersion: number
  revision: number
}
