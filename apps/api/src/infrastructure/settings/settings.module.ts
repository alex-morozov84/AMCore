import { Global, Module } from '@nestjs/common'

import { AuditModule } from '../../core/audit/index.js'
import { EnvModule } from '../../env/env.module.js'
import { PrismaModule } from '../../prisma/index.js'

import { SETTING_DEFINITIONS, SettingRegistry } from './setting-registry.js'
import { SettingRepository } from './setting-repository.js'
import { SettingWriter } from './setting-writer.js'
import { SettingsReader } from './settings-reader.js'
import { StorageSettingDefinition } from './storage-setting.definition.js'

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
