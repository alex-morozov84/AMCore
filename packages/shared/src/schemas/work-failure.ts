import { z } from 'zod'

import { serializedJsonBytes } from './organization-members-budget'

export const workFailureCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const labels = (length: number) =>
  z
    .record(z.string().min(2).max(16), z.string().min(1).max(length))
    .refine((value) => Object.hasOwn(value, 'en') && Object.keys(value).length <= 8)
const reasonSchema = z.strictObject({
  title: labels(80),
  nextStep: labels(160).optional(),
})

/** Static, escaped plain text: no exception messages, interpolation or provider responses. */
export const workFailureDiagnosticSchema = reasonSchema
  .extend({ code: workFailureCodeSchema })
  .refine((value) => serializedJsonBytes(value) <= 1024)
export type WorkFailureDiagnostic = z.infer<typeof workFailureDiagnosticSchema>
export const workFailureReasonsSchema = z
  .record(workFailureCodeSchema, reasonSchema)
  .refine((value) => Object.keys(value).length <= 16 && serializedJsonBytes(value) <= 8192)
  .refine((value) =>
    Object.entries(value).every(
      ([code, reason]) => workFailureDiagnosticSchema.safeParse({ code, ...reason }).success
    )
  )
export type WorkFailureReasons = z.infer<typeof workFailureReasonsSchema>
