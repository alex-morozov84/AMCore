import { Injectable } from '@nestjs/common'

import { storageProbeIntervalSchema } from '@amcore/shared'

import type { SettingDefinition } from './setting-definition'

import { EnvService } from '@/env/env.service'

@Injectable()
export class StorageSettingDefinition implements SettingDefinition<number> {
  readonly key = 'storage.probe.intervalSeconds'
  readonly schemaVersion = 1
  readonly schema = storageProbeIntervalSchema
  readonly scope = 'platform' as const
  readonly storageKind = 'ordinary' as const
  readonly failurePolicy = 'retain-last-confirmed-or-baseline' as const
  readonly auditTarget = 'storage_probe'

  constructor(private readonly env: EnvService) {}

  baseline = (): number => this.schema.parse(this.env.get('STORAGE_PROBE_INTERVAL_SECONDS'))
  auditProjection = (
    before: number | undefined,
    after: number | undefined
  ): Record<string, number | null> => ({
    beforeIntervalSeconds: before ?? null,
    afterIntervalSeconds: after ?? null,
  })
}
