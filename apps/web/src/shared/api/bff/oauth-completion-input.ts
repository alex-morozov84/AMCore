import { SUPPORTED_LOCALES } from '@amcore/shared'
import { z } from 'zod'

export const oauthTicketSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/)
export const oauthCompletionSchema = z.strictObject({
  ticket: oauthTicketSchema,
  locale: z.enum(SUPPORTED_LOCALES),
})

export type OAuthCompletionInput = z.infer<typeof oauthCompletionSchema>

/** Reject arrays/unknown fields before rendering a credential-bearing document. */
export const oauthCompletionQuerySchema = z.strictObject({ ticket: oauthTicketSchema })
