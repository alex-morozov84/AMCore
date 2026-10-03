import type { SettingsReader } from '../settings/settings-reader'
import type { StorageSettingDefinition } from '../settings/storage-setting.definition'

import type { EnvService } from '@/env/env.service'

/** Explicit env-only reader for isolated canary I/O tests. */
export function storageProbeSettingsFixture(
  env: EnvService
): [SettingsReader, StorageSettingDefinition] {
  return [
    {
      snapshot: () => ({
        value: env.get('STORAGE_PROBE_INTERVAL_SECONDS'),
        revision: 0,
        source: 'baseline',
        lastConfirmedAt: new Date().toISOString(),
        refreshStatus: 'confirmed',
      }),
      subscribe: () => () => undefined,
      initialize: async () => undefined,
    } as unknown as SettingsReader,
    {} as StorageSettingDefinition,
  ]
}
