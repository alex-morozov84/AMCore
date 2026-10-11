import { z } from 'zod'

import { serializedJsonBytes } from './organization-members-budget'

const workLabels = z
  .record(z.string().min(2).max(16), z.string().min(1).max(80))
  .refine((labels) => !!labels.en && Object.keys(labels).length <= 8)

/** Bounded, plain localized operator labels; never payload content or executable UI. */
export const workPresentationSchema = z
  .strictObject({
    name: z
      .record(z.string().min(2).max(16), z.string().min(1).max(80))
      .refine((labels) => !!labels.en && Object.keys(labels).length <= 8),
    filters: z
      .array(
        z.strictObject({
          key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/),
          label: workLabels,
          options: z
            .array(z.strictObject({ value: z.string().min(1).max(64), label: workLabels }))
            .max(32),
        })
      )
      .max(4)
      .optional(),
    attemptHistory: z.boolean().optional(),
    nativeStates: z.record(z.string().max(64), workLabels).optional(),
    commandSemantics: z
      .strictObject({
        pause: z.enum(['claims', 'broker']),
        retry: z.enum(['scheduled-single-grant', 'ordinary']),
        cleanupMinimumAgeSeconds: z
          .number()
          .int()
          .positive()
          .max(365 * 86400),
      })
      .optional(),
    technicalFields: z.array(z.string().min(1).max(64)).max(8).optional(),
    fields: z
      .record(
        z.string().min(1).max(64),
        z
          .record(z.string().min(2).max(16), z.string().min(1).max(80))
          .refine((labels) => !!labels.en && Object.keys(labels).length <= 8)
      )
      .refine((fields) => Object.keys(fields).length <= 8),
  })
  .refine((value) => serializedJsonBytes(value) <= 4096)
  .refine((value) => value.technicalFields?.every((key) => key in value.fields) ?? true)
export type WorkPresentation = z.infer<typeof workPresentationSchema>
