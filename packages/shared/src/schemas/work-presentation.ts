import { z } from 'zod'

import { serializedJsonBytes } from './organization-members-budget'

/** Bounded, plain localized operator labels; never payload content or executable UI. */
export const workPresentationSchema = z
  .strictObject({
    name: z
      .record(z.string().min(2).max(16), z.string().min(1).max(80))
      .refine((labels) => !!labels.en && Object.keys(labels).length <= 8),
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
