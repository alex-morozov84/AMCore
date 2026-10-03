import { Injectable, ServiceUnavailableException } from '@nestjs/common'

import type {
  RequestPrincipal,
  StorageProbeSettingResponse,
  StorageProbeSettingUpdate,
} from '@amcore/shared'

import { decodeSetting } from '@/infrastructure/settings/setting-codec'
import { SettingRepository } from '@/infrastructure/settings/setting-repository'
import { SettingWriter } from '@/infrastructure/settings/setting-writer'
import { StorageSettingDefinition } from '@/infrastructure/settings/storage-setting.definition'
import { StorageProbeService } from '@/infrastructure/storage/storage-probe.service'

@Injectable()
export class AdminStorageSettingService {
  constructor(
    private readonly definition: StorageSettingDefinition,
    private readonly repository: SettingRepository,
    private readonly writer: SettingWriter,
    private readonly probe: StorageProbeService
  ) {}

  async get(): Promise<StorageProbeSettingResponse> {
    try {
      const { row, override } = await this.repository.read(this.definition)
      return this.response(override, row.revision)
    } catch {
      throw new ServiceUnavailableException('Setting read unavailable')
    }
  }

  async update(
    input: StorageProbeSettingUpdate,
    actor: RequestPrincipal
  ): Promise<StorageProbeSettingResponse> {
    const row = await this.writer.write(
      this.definition,
      input.intervalSeconds ?? undefined,
      input.expectedRevision,
      actor
    )
    return this.response(decodeSetting(this.definition, row), row.revision)
  }

  private response(override: number | undefined, revision: number): StorageProbeSettingResponse {
    return {
      saved: { intervalSeconds: override ?? null, revision },
      baselineSeconds: this.definition.baseline(),
      applied: this.probe.settingSnapshot(),
    }
  }
}
