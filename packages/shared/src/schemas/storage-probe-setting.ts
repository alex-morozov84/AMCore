import { z } from 'zod'

export const settingRevisionSchema = z.number().int().min(0).max(2_147_483_647)
export const storageProbeIntervalSchema = z.number().int().min(30).max(3600)
export const storageProbeSettingUpdateSchema = z.strictObject({
  intervalSeconds: storageProbeIntervalSchema.nullable(),
  expectedRevision: settingRevisionSchema,
})
export const storageProbeSettingFormSchema = z.strictObject({
  intervalSeconds: storageProbeIntervalSchema,
})
export const storageProbeSettingResponseSchema = z.strictObject({
  saved: z.strictObject({
    intervalSeconds: storageProbeIntervalSchema.nullable(),
    revision: settingRevisionSchema,
  }),
  baselineSeconds: storageProbeIntervalSchema,
  applied: z.strictObject({
    intervalSeconds: storageProbeIntervalSchema,
    revision: settingRevisionSchema.nullable(),
    source: z.enum(['override', 'baseline', 'unconfirmed']),
    lastConfirmedAt: z.iso.datetime().nullable(),
    refreshStatus: z.enum(['confirmed', 'unconfirmed', 'failed', 'stale']),
    nextScheduledAt: z.iso.datetime().nullable(),
  }),
})
