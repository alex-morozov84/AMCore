import { createZodDto } from 'nestjs-zod'

import { storageProbeSettingResponseSchema, storageProbeSettingUpdateSchema } from '@amcore/shared'

export class StorageProbeSettingUpdateDto extends createZodDto(storageProbeSettingUpdateSchema) {}
export class StorageProbeSettingResponseDto extends createZodDto(
  storageProbeSettingResponseSchema
) {}
