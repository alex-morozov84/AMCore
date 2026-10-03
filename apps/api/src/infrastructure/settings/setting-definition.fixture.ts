import type { z } from 'zod'

import type { SettingDefinition } from './setting-definition'

export function testDefinition<T>(
  key: string,
  schema: z.ZodType<T>,
  baseline: T
): SettingDefinition<T> {
  return {
    key,
    schema,
    schemaVersion: 1,
    baseline: () => baseline,
    scope: 'platform',
    storageKind: 'ordinary',
    failurePolicy: 'retain-last-confirmed-or-baseline',
    auditTarget: 'test_setting',
    auditProjection: () => ({}),
  }
}
