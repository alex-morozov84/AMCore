import { storageProbeSettingResponseSchema, storageProbeSettingUpdateSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class StorageProbeSettingUpdateDto extends createSchemaDto(
  storageProbeSettingUpdateSchema
) {}
export class StorageProbeSettingResponseDto extends createSchemaDto(
  storageProbeSettingResponseSchema
) {}
