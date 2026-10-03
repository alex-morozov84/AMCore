import type { z } from 'zod'

import type {
  storageProbeSettingFormSchema,
  storageProbeSettingResponseSchema,
  storageProbeSettingUpdateSchema,
} from '../schemas/storage-probe-setting'

export type StorageProbeSettingUpdate = z.infer<typeof storageProbeSettingUpdateSchema>
export type StorageProbeSettingResponse = z.infer<typeof storageProbeSettingResponseSchema>
export type StorageProbeSettingForm = z.infer<typeof storageProbeSettingFormSchema>
