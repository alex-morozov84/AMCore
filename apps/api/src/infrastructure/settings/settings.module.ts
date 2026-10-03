import { Global, Module } from '@nestjs/common'

import { SETTING_DEFINITIONS, SettingRegistry } from './setting-registry'
import { SettingRepository } from './setting-repository'
import { SettingWriter } from './setting-writer'
import { SettingsReader } from './settings-reader'
import { StorageSettingDefinition } from './storage-setting.definition'

import { AuditModule } from '@/core/audit'
import { EnvModule } from '@/env/env.module'
import { PrismaModule } from '@/prisma'

@Global()
@Module({
  imports: [PrismaModule, AuditModule, EnvModule],
  providers: [
    StorageSettingDefinition,
    {
      provide: SETTING_DEFINITIONS,
      inject: [StorageSettingDefinition],
      useFactory: (storage: StorageSettingDefinition) => [storage],
    },
    SettingRegistry,
    SettingRepository,
    SettingWriter,
    SettingsReader,
  ],
  exports: [
    StorageSettingDefinition,
    SettingRegistry,
    SettingRepository,
    SettingWriter,
    SettingsReader,
  ],
})
export class SettingsModule {}
